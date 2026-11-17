begin;
set local lock_timeout='3s';

alter table private.feasibility_organization_shares add column proposal_baseline jsonb;

update private.feasibility_organization_shares s set proposal_baseline=p.study
from public.feasibility_projects p
where p.id=s.project_id and p.revision=s.source_revision;

create function private.feasibility_capture_share_baseline()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or old.source_revision is distinct from new.source_revision then
  new.proposal_baseline:=new.study_snapshot;
 end if;
 return new;
end
$$;
revoke all on function private.feasibility_capture_share_baseline() from public,anon,authenticated,service_role;

create trigger feasibility_capture_share_baseline
 before insert or update of source_revision on private.feasibility_organization_shares
 for each row execute function private.feasibility_capture_share_baseline();

create table private.feasibility_share_proposals (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.feasibility_projects(id) on delete cascade,
 recipient_id uuid not null references public.organizations(id),
 submitted_by uuid references auth.users(id) on delete set null,
 submitted_at timestamptz not null default now(),
 source_revision integer not null,
 shared_revision integer not null,
 changes jsonb not null,
 state text not null default 'pending' check (state in ('pending','approved','rejected')),
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 reason text,
 resolutions jsonb,
 previous_study jsonb,
 approved_revision integer,
 unique (project_id,recipient_id,shared_revision)
);
create unique index feasibility_one_pending_share_proposal
 on private.feasibility_share_proposals(project_id,recipient_id) where state='pending';
alter table private.feasibility_share_proposals enable row level security;
revoke all on private.feasibility_share_proposals from public,anon,authenticated,service_role;

create function private.feasibility_proposal_fields()
returns table(field text,path text[]) language sql immutable set search_path='' as $$
 select name,array[name] from unnest(array['title','notes','monthlyUnits','unitPrice','variableCost',
  'monthlyFixedCost','workingCapital','discountRatePct']) fields(name)
 union all
 select name,array['water','ops',name] from unnest(array['priceCarton','variableCarton','fixedMonth',
  'bottlesHour','discountRate']) fields(name)
$$;
revoke all on function private.feasibility_proposal_fields() from public,anon,authenticated,service_role;

create function private.feasibility_share_proposal(
 p_action text,p_org uuid,p_project uuid,p_proposal uuid,p_revision integer,p_resolutions jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 project public.feasibility_projects%rowtype;
 shared private.feasibility_organization_shares%rowtype;
 proposal private.feasibility_share_proposals%rowtype;
 platform_mode text;
 difference jsonb;
 current_value jsonb;
 choice text;
 conflict boolean;
 include_change boolean;
 review_rows jsonb:='[]'::jsonb;
 proposed_study jsonb;
 original_study jsonb;
 next_baseline jsonb;
 item record;
 source_side boolean;
 can_approve boolean;
 recipient_name text;
 submitter_name text;
 notice jsonb;
begin
 if actor is null or not private.feasibility_phase1_org_enabled() then
  raise exception 'FEASIBILITY_PROPOSAL_FORBIDDEN' using errcode='42501';
 end if;
 if p_action is null or p_action not in ('list','recipient','submit','review','approve','reject') then
  raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
 end if;

 source_side:=p_action in ('list','review','approve','reject');
 if not private.feasibility_company_access(p_org,not source_side)
   or (source_side and not exists(select 1 from public.organization_members m where m.organization_id=p_org
     and m.user_id=actor and m.role='OWNER' and m.status='ACTIVE')) then
  raise exception 'FEASIBILITY_PROPOSAL_FORBIDDEN' using errcode='42501';
 end if;

 -- Use the same lock order as sharing, then lock a proposal before deciding it.
 select mode into strict platform_mode from private.feasibility_sharing_policy where singleton for share;
 select * into project from public.feasibility_projects where id=p_project and organization_id is not null for update;
 if not found or (source_side and project.organization_id is distinct from p_org) then
  raise exception 'FEASIBILITY_PROPOSAL_FORBIDDEN' using errcode='42501';
 end if;

 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.submitted_at desc) from (
   select q.id,q.state,q.submitted_at,o.name as recipient_name
   from private.feasibility_share_proposals q join public.organizations o on o.id=q.recipient_id
   where q.project_id=p_project order by (q.state='pending') desc,q.submitted_at desc limit 100
  ) rows),'[]'::jsonb);
 end if;

 if source_side then
  select * into proposal from private.feasibility_share_proposals q where q.project_id=p_project and q.id=p_proposal for update;
  if not found then return null; end if;
 end if;
 select * into shared from private.feasibility_organization_shares s
 where s.project_id=p_project and s.recipient_organization_id=case when source_side then proposal.recipient_id else p_org end
 for update;

 if not source_side then
  if not found or shared.revoked_at is not null or platform_mode='disabled' or shared.expires_at<=clock_timestamp()
    or not private.feasibility_has_company_plan(project.organization_id,false) then
   raise exception 'FEASIBILITY_PROPOSAL_FORBIDDEN' using errcode='42501';
  end if;
  select * into proposal from private.feasibility_share_proposals q where q.project_id=p_project and q.recipient_id=p_org
   order by q.submitted_at desc,q.id desc limit 1;
  if shared.proposal_baseline is not null then
   select coalesce(jsonb_object_agg(f.field,jsonb_build_object('before',shared.proposal_baseline#>f.path,
    'after',shared.study_snapshot#>f.path)),'{}'::jsonb) into difference
   from private.feasibility_proposal_fields() f
   where shared.study_snapshot#>f.path is not null and shared.study_snapshot#>f.path is distinct from shared.proposal_baseline#>f.path;
  end if;
  can_approve:=platform_mode='edit' and shared.access_mode='edit'
   and private.feasibility_has_company_plan(project.organization_id,true)
   and coalesce(difference<>'{}'::jsonb,false)
   and coalesce(proposal.state<>'pending' and proposal.shared_revision<shared.shared_revision,true);
  if p_action='recipient' then
   return jsonb_build_object('can_submit',can_approve,'state',proposal.state,'reason',proposal.reason,
    'needs_new_share',shared.proposal_baseline is null);
  end if;
  if p_revision is distinct from shared.shared_revision or not can_approve then
   raise exception 'FEASIBILITY_PROPOSAL_NOT_SUBMITTABLE' using errcode='40001';
  end if;
  insert into private.feasibility_share_proposals(project_id,recipient_id,submitted_by,source_revision,shared_revision,changes)
  values(p_project,p_org,actor,shared.source_revision,shared.shared_revision,difference) returning * into proposal;
  select o.name into recipient_name from public.organizations o where o.id=p_org;
  select nullif(btrim(p.name),'') into submitter_name from public.profiles p where p.id=actor;
  notice:=jsonb_build_object('organization',project.organization_id,'project',p_project,'proposal',proposal.id);
  insert into public.notifications(user_id,type,title,body,scheduled_for,metadata)
  select p.id,'feasibility_share_proposal',case when p.locale='ar' then 'تعديلات دراسة بانتظار المراجعة' else 'Study changes awaiting review' end,
   concat(recipient_name,case when submitter_name is not null then ' · '||submitter_name end,' · ',project.title),now(),notice
  from public.organization_members m join public.profiles p on p.id=m.user_id
  where m.organization_id=project.organization_id and m.role='OWNER' and m.status='ACTIVE';
 else
  can_approve:=platform_mode='edit' and coalesce(shared.access_mode='edit'
   and shared.source_revision=proposal.source_revision and shared.revoked_at is null
   and shared.expires_at>clock_timestamp(),false)
   and private.feasibility_has_company_plan(p_org,true)
   and private.feasibility_has_company_plan(proposal.recipient_id,true);
  if p_action='approve' and (proposal.state<>'pending' or not can_approve or p_revision is distinct from project.revision) then
   raise exception 'FEASIBILITY_PROPOSAL_STALE' using errcode='40001';
  end if;
  if p_action='approve' and (jsonb_typeof(p_resolutions) is distinct from 'object'
   or exists(select 1 from jsonb_each_text(p_resolutions) r
    where not (proposal.changes ? r.key) or r.value is null or r.value not in ('current','proposed'))) then
   raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
  end if;

  original_study:=coalesce(proposal.previous_study,project.study);
  proposed_study:=original_study;
  next_baseline:=shared.proposal_baseline;
  for item in select f.field,f.path,q.value from jsonb_each(proposal.changes) q join private.feasibility_proposal_fields() f on f.field=q.key loop
   current_value:=original_study#>item.path;
   difference:=item.value;
   conflict:=coalesce(current_value,'null'::jsonb) is distinct from difference->'before'
    and current_value is distinct from difference->'after';
   include_change:=cardinality(item.path)=1 or jsonb_typeof(original_study#>'{water,ops}')='object';
   if not coalesce(include_change,false) then
    conflict:=true;
   end if;
   choice:=coalesce(proposal.resolutions,p_resolutions)->>item.field;
   if p_action='approve' and conflict and (choice is null or (choice='proposed' and not coalesce(include_change,false))) then
    raise exception 'FEASIBILITY_PROPOSAL_CONFLICT' using errcode='40001';
   end if;
   review_rows:=review_rows||jsonb_build_array(difference||jsonb_build_object('field',item.field,'current',current_value,
    'conflict',conflict,'can_apply',coalesce(include_change,false),'resolution',choice,'path',to_jsonb(item.path)));
   if include_change and coalesce(choice,'proposed')='proposed' then
    proposed_study:=jsonb_set(proposed_study,item.path,difference->'after');
   end if;
   next_baseline:=jsonb_set(next_baseline,item.path,difference->'after');
  end loop;
  if p_action='review' then
   select o.name into recipient_name from public.organizations o where o.id=proposal.recipient_id;
   select nullif(btrim(p.name),'') into submitter_name from public.profiles p where p.id=proposal.submitted_by;
   return jsonb_build_object('state',proposal.state,'reason',proposal.reason,'recipient_name',recipient_name,
    'submitter_name',submitter_name,'submitted_at',proposal.submitted_at,'changes',review_rows,
    'can_approve',can_approve,'revision',project.revision,'current',original_study,
    'source_title',project.title);
  end if;
  if proposal.state<>'pending' then raise exception 'FEASIBILITY_PROPOSAL_STALE' using errcode='40001'; end if;
  if p_action='approve' then
   if proposed_study=project.study then raise exception 'FEASIBILITY_PROPOSAL_NO_CHANGES' using errcode='22023'; end if;
   update public.feasibility_projects set study=jsonb_set(proposed_study,'{updatedAt}',
    to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    title=proposed_study->>'title',revision=project.revision+1 where id=p_project;
  elsif length(coalesce(p_reason,''))>2000 then
   raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
  end if;
  update private.feasibility_share_proposals set state=case when p_action='approve' then 'approved' else 'rejected' end,
   reason=case when p_action='reject' then nullif(btrim(p_reason),'') end,decided_by=actor,decided_at=clock_timestamp(),
   resolutions=case when p_action='approve' then p_resolutions end,
   previous_study=case when p_action='approve' then project.study end,
   approved_revision=case when p_action='approve' then project.revision+1 end
  where id=proposal.id returning * into proposal;
  -- Treat every reviewed field as dealt with in this recipient's draft. Edits made
  -- after submission stay in the working copy and can form the next proposal.
  update private.feasibility_organization_shares set proposal_baseline=next_baseline
  where project_id=p_project and recipient_organization_id=proposal.recipient_id
   and source_revision=proposal.source_revision;
  insert into public.notifications(user_id,type,title,body,scheduled_for,metadata)
  select p.id,'feasibility_share_decision',case
   when p.locale='ar' and proposal.state='approved' then 'قُبلت تعديلات دراسة الجدوى'
   when p.locale='ar' then 'رُفضت تعديلات دراسة الجدوى'
   when proposal.state='approved' then 'Feasibility study changes approved'
   else 'Feasibility study changes declined' end,
   concat(project.title,case when proposal.reason is not null then ' · '||proposal.reason end),now(),
   jsonb_build_object('organization',proposal.recipient_id,'project',p_project)
  from public.profiles p where p.id=proposal.submitted_by
   and exists(select 1 from public.organization_members m where m.organization_id=proposal.recipient_id
   and m.user_id=p.id and m.status='ACTIVE');
 end if;

 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(actor,'feasibility.share_proposal_'||p_action,'feasibility_project',p_project,
  jsonb_build_object('proposal_id',proposal.id,'source_organization_id',project.organization_id,
   'recipient_organization_id',proposal.recipient_id,'state',proposal.state,'approved_revision',proposal.approved_revision));
 return jsonb_build_object('id',proposal.id,'state',proposal.state);
end
$$;
revoke all on function private.feasibility_share_proposal(text,uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_share_proposal(text,uuid,uuid,uuid,integer,jsonb,text) to authenticated;

create function public.feasibility_share_proposal(
 p_action text,p_org uuid,p_project uuid,p_proposal uuid default null,p_revision integer default null,
 p_resolutions jsonb default null,p_reason text default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.feasibility_share_proposal(p_action,p_org,p_project,p_proposal,p_revision,p_resolutions,p_reason)
$$;
revoke all on function public.feasibility_share_proposal(text,uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_share_proposal(text,uuid,uuid,uuid,integer,jsonb,text) to authenticated;
commit;
