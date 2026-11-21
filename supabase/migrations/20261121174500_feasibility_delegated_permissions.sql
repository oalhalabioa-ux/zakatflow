begin;
-- Expand role permission catalog while preserving allow-list validation
alter table public.organization_roles drop constraint if exists organization_roles_permissions_check;
alter table public.organization_roles add constraint organization_roles_permissions_check check (permissions <@ array[
'organization.view','organization.edit',
'financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve',
'liquidity.view','liquidity.edit','liquidity.settle',
'vat.view','vat.edit','vat.issue',
'assets.view','assets.edit',
'budget.view','budget.edit','budget.submit','budget.approve',
'zakat.view','zakat.edit','audit.view',
  'feasibility.shared_view',
  'feasibility.study_edit',
  'feasibility.invite','feasibility.invite_edit',
  'feasibility.outgoing_manage',
  'feasibility.inbox_manage',
  'feasibility.shared_edit',
  'feasibility.proposal_review',
  'feasibility.sharing_audit',
  'feasibility.directory_manage'
]::text[]);
-- Align role writes with the permission catalog already enforced by the table.
-- Does not change any role, assignment, override or financial data.
create or replace function public.normalize_role_permission_catalog(p_permissions text[])
returns text[] language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare permissions text[]:=coalesce(p_permissions,array[]::text[]); previous_count int; pair record;
begin
 if exists(select 1 from unnest(permissions) as p where p is null or p not in (
  'organization.view','organization.edit','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve',
  'liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit','audit.view',
  'feasibility.shared_view',
  'feasibility.study_edit',
  'feasibility.invite','feasibility.invite_edit',
  'feasibility.outgoing_manage',
  'feasibility.inbox_manage',
  'feasibility.shared_edit',
  'feasibility.proposal_review',
  'feasibility.sharing_audit',
  'feasibility.directory_manage'
 )) then raise exception 'ROLE_PERMISSION_INVALID'; end if;
 loop
  previous_count:=cardinality(permissions);
  for pair in select * from (values
   ('financial_core.create','financial_core.view'),('financial_core.submit','financial_core.create'),
   ('financial_core.approve','financial_core.view'),('financial_core.post','financial_core.approve'),
   ('financial_core.reverse','financial_core.post'),('financial_core.self_approve','financial_core.approve'),
   ('liquidity.edit','liquidity.view'),('liquidity.settle','liquidity.view'),('assets.edit','assets.view'),
   ('budget.edit','budget.view'),('budget.submit','budget.edit'),('budget.approve','budget.view'),
   ('vat.edit','vat.view'),('vat.issue','vat.edit'),('zakat.edit','zakat.view'),('organization.edit','organization.view'),
   ('feasibility.shared_edit','feasibility.shared_view'),
   ('feasibility.invite_edit','feasibility.invite')
  ) as dependencies(permission,prerequisite) loop
   if pair.permission=any(permissions) and not pair.prerequisite=any(permissions) then permissions:=array_append(permissions,pair.prerequisite); end if;
  end loop;
  exit when previous_count=cardinality(permissions);
 end loop;
 return array(select distinct p from unnest(permissions) as p order by p);
end $$;
revoke all on function public.normalize_role_permission_catalog(text[]) from public,anon,authenticated;

create function private.feasibility_member_permission(p_org uuid, p_user uuid, p_key text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists (
  select 1 from public.organization_members m
  join public.organizations o on o.id=m.organization_id and o.status='ACTIVE'
  left join public.organization_roles r on r.organization_id=m.organization_id and r.id=m.custom_role_id
  left join public.organization_member_permission_overrides ov
    on ov.organization_id=m.organization_id and ov.user_id=m.user_id and ov.permission=p_key
  where m.organization_id=p_org and m.user_id=p_user and m.status='ACTIVE'
    and p_key in ('feasibility.shared_view',
  'feasibility.study_edit',
  'feasibility.invite','feasibility.invite_edit',
  'feasibility.outgoing_manage',
  'feasibility.inbox_manage',
  'feasibility.shared_edit',
  'feasibility.proposal_review',
  'feasibility.sharing_audit',
  'feasibility.directory_manage')
    and case when m.role='OWNER' then true when ov.effect='DENY' then false
             when ov.effect='ALLOW' then true else p_key=any(r.permissions) end
 );
$$;
revoke all on function private.feasibility_member_permission(uuid,uuid,text) from public,anon,authenticated;
create or replace function private.feasibility_company_invitations(
 p_action text,p_organization uuid,p_invitation uuid,p_project uuid,p_recipient uuid,
 p_revision integer,p_days integer,p_access text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 policy private.feasibility_sharing_policy%rowtype;
 required_permission text;
 project public.feasibility_projects%rowtype;
 invitation private.feasibility_company_invitations%rowtype;
 share private.feasibility_organization_shares%rowtype;
 now_at timestamptz;
 cutoff timestamptz;
 paid boolean;
 sender_name text;
 next_state text;
begin
 select * into strict policy from private.feasibility_sharing_policy where singleton for share;
 if actor is null or not policy.company_invitations_enabled or not private.feasibility_phase1_org_enabled() then
  raise exception 'FEASIBILITY_COMPANY_INVITATION_DISABLED' using errcode='42501';
 end if;
 required_permission:=case
  when p_action in ('directory_status','directory_enable','directory_disable') then 'feasibility.directory_manage'
  when p_action in ('issue','directory_search') then 'feasibility.invite'
  when p_action in ('inbox','accept','decline') then 'feasibility.inbox_manage'
  when p_action in ('outbox','withdraw') then 'feasibility.outgoing_manage'
 end;
 if p_action is distinct from 'revoke' and not private.feasibility_member_permission(p_organization,actor,required_permission) then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;

 if p_action='directory_status' then
  return to_jsonb(exists(select 1 from private.feasibility_company_directory where organization_id=p_organization));
 end if;
 if p_action in ('directory_enable','directory_disable') then
  if p_action='directory_enable' then
   insert into private.feasibility_company_directory(organization_id) values(p_organization) on conflict do nothing;
  else
   delete from private.feasibility_company_directory where organization_id=p_organization;
  end if;
  return to_jsonb(p_action='directory_enable');
 end if;
 if p_action='directory_search' then
  if not private.feasibility_has_company_plan(p_organization,true) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_access,''))) not between 2 and 100 then
   raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.name,entry.id),'[]'::jsonb)
   from (select o.id,o.name from private.feasibility_company_directory d
    join public.organizations o on o.id=d.organization_id and o.status='ACTIVE'
    where d.organization_id<>p_organization
     and starts_with(lower(o.name),lower(btrim(p_access)))
    order by o.name,o.id limit 20) entry);
 end if;

 if p_action='inbox' then
  return (select coalesce(jsonb_agg(to_jsonb(i) order by i.issued_at desc,i.id),'[]'::jsonb)
   from (select x.id,o.name as source_name,x.access_mode,x.days,x.issued_at,x.expires_at,x.state
    from private.feasibility_company_invitations x join public.organizations o on o.id=x.source_id
    left join private.feasibility_organization_shares s on s.company_invitation_id=x.id
    where x.recipient_id=p_organization and (
     (x.state='pending' and x.expires_at>statement_timestamp())
     or (x.state='accepted' and s.revoked_at is null and s.expires_at>statement_timestamp()
      and (private.feasibility_has_company_plan(p_organization,true)
       or s.first_shared_at+interval '720 hours'>statement_timestamp())))
    order by x.issued_at desc,x.id limit 300) i);
 end if;
 if p_action='outbox' then
  if not exists(select 1 from public.feasibility_projects
    where id=p_project and organization_id=p_organization) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(i) order by i.issued_at desc,i.id),'[]'::jsonb)
   from (select x.id,o.name as recipient_name,x.access_mode,x.days,x.issued_at,x.expires_at,
    case when x.state='pending' and x.expires_at<=statement_timestamp() then 'expired'
     when x.state='accepted' and s.revoked_at is not null then 'revoked' else x.state end as state
    from private.feasibility_company_invitations x join public.organizations o on o.id=x.recipient_id
    left join private.feasibility_organization_shares s on s.company_invitation_id=x.id
    where x.project_id=p_project and x.source_id=p_organization order by x.issued_at desc,x.id limit 300) i);
 end if;

 if p_action='issue' then
  if policy.mode='disabled' or not private.feasibility_has_company_plan(p_organization,true) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  select * into project from public.feasibility_projects
   where id=p_project and organization_id=p_organization and owner_user_id is null for update;
  if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
  if p_revision is distinct from project.revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  if p_days is null or p_days<1 or p_access is null or p_access not in ('read','edit')
    or p_recipient=p_organization or not exists(select 1 from public.organizations
     where id=p_recipient and status='ACTIVE') then
   raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
  end if;
  paid:=private.feasibility_has_company_plan(p_recipient,true);
  if p_access='edit' and (policy.mode<>'edit' or not paid or not private.feasibility_member_permission(p_organization,actor,'feasibility.invite_edit')) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  if not paid and p_days>30 then
   raise exception 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' using errcode='22023';
  end if;
  now_at:=clock_timestamp();
  select * into invitation from private.feasibility_company_invitations
   where project_id=p_project and recipient_id=p_recipient and state='pending' for update;
  if found then
   if invitation.expires_at<=now_at then
    update private.feasibility_company_invitations set state='expired' where id=invitation.id;
    perform private.feasibility_company_invitation_audit(invitation,'expired',actor);
   elsif invitation.source_revision=p_revision and invitation.days=p_days and invitation.access_mode=p_access then
    return jsonb_build_object('id',invitation.id,'state','pending');
   else
    raise exception 'FEASIBILITY_COMPANY_INVITATION_PENDING' using errcode='40001';
   end if;
  end if;
  insert into private.feasibility_company_invitations
   (project_id,source_id,recipient_id,source_revision,access_mode,days,issued_by,issued_at,expires_at)
   values(p_project,p_organization,p_recipient,p_revision,p_access,p_days,actor,now_at,now_at+interval '168 hours')
   returning * into invitation;
  perform private.feasibility_company_invitation_audit(invitation,'issued',actor);
  select name into sender_name from public.organizations where id=p_organization;
  insert into public.notifications(user_id,type,title,body,scheduled_for,metadata)
   select distinct p.id,'feasibility_company_invitation',
    case when p.locale='ar' then 'دعوة مشاركة دراسة جدوى' else 'Feasibility study invitation' end,
    sender_name,now_at,jsonb_build_object('organization',p_recipient,'invitation',invitation.id)
   from public.organization_members m join public.profiles p on p.id=m.user_id
   where m.organization_id=p_recipient and m.status='ACTIVE' and private.feasibility_member_permission(p_recipient,m.user_id,'feasibility.inbox_manage');
  return jsonb_build_object('id',invitation.id,'state',invitation.state);
 end if;

 if p_action is null or p_action not in ('accept','decline','withdraw','revoke') then
  raise exception 'FEASIBILITY_INVALID_SHARE_ACTION' using errcode='22023';
 end if;
 select * into invitation from private.feasibility_company_invitations x where x.id=p_invitation and (
  (p_action in ('accept','decline','revoke') and x.recipient_id=p_organization and private.feasibility_member_permission(p_organization,actor,'feasibility.inbox_manage'))
  or (p_action in ('withdraw','revoke') and x.source_id=p_organization and private.feasibility_member_permission(p_organization,actor,'feasibility.outgoing_manage')));
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;

 -- Use the same project-first lock order as sharing and proposal review.
 select * into project from public.feasibility_projects where id=invitation.project_id for update;
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 select * into strict invitation from private.feasibility_company_invitations where id=p_invitation for update;
 now_at:=clock_timestamp();
 next_state:=case p_action when 'accept' then 'accepted' when 'decline' then 'declined'
  when 'withdraw' then 'withdrawn' when 'revoke' then 'revoked' end;
 if invitation.state=next_state then
  if p_action='accept' and not exists(select 1 from private.feasibility_organization_shares s
    where s.project_id=invitation.project_id and s.recipient_organization_id=invitation.recipient_id
     and s.company_invitation_id=invitation.id and s.revoked_at is null and s.expires_at>now_at
     and (private.feasibility_has_company_plan(invitation.recipient_id,true)
      or s.first_shared_at+interval '720 hours'>now_at)) then
   raise exception 'FEASIBILITY_COMPANY_INVITATION_RESOLVED' using errcode='40001';
  end if;
  return jsonb_build_object('id',invitation.id,'state',invitation.state);
 end if;
 if invitation.state='pending' and invitation.expires_at<=now_at then
  update private.feasibility_company_invitations set state='expired' where id=invitation.id;
  perform private.feasibility_company_invitation_audit(invitation,'expired',actor);
  return jsonb_build_object('id',invitation.id,'state','expired');
 end if;
 if p_action='revoke' and invitation.state='accepted' then
  update private.feasibility_organization_shares set revoked_at=coalesce(revoked_at,now_at)
   where project_id=invitation.project_id and recipient_organization_id=invitation.recipient_id
    and company_invitation_id=invitation.id;
 elsif p_action='revoke' or invitation.state<>'pending' then
  raise exception 'FEASIBILITY_COMPANY_INVITATION_RESOLVED' using errcode='40001';
 elsif p_action='accept' then
  if policy.mode='disabled' or project.organization_id is distinct from invitation.source_id
   or project.owner_user_id is not null or not private.feasibility_has_company_plan(invitation.source_id,true)
   or not private.feasibility_member_permission(invitation.source_id,invitation.issued_by,'feasibility.invite')
   or (invitation.access_mode='edit' and not private.feasibility_member_permission(invitation.source_id,invitation.issued_by,'feasibility.invite_edit')) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  if invitation.source_revision is distinct from project.revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  paid:=private.feasibility_has_company_plan(invitation.recipient_id,true);
  if invitation.access_mode='edit' and (policy.mode<>'edit' or not paid) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  select * into share from private.feasibility_organization_shares
   where project_id=project.id and recipient_organization_id=invitation.recipient_id for update;
  cutoff:=now_at+invitation.days*interval '24 hours';
  if not paid and cutoff>coalesce(share.first_shared_at,now_at)+interval '720 hours' then
   raise exception 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' using errcode='22023';
  end if;

  insert into private.feasibility_organization_shares as existing
   (project_id,recipient_organization_id,source_revision,title,study_snapshot,first_shared_at,expires_at,
    shared_by,access_mode,company_invitation_id)
   values(project.id,invitation.recipient_id,project.revision,project.title,project.study,now_at,cutoff,
    invitation.issued_by,invitation.access_mode,invitation.id)
   on conflict (project_id,recipient_organization_id) do update set
    source_revision=excluded.source_revision,expires_at=excluded.expires_at,shared_by=excluded.shared_by,
    revoked_at=null,access_mode=excluded.access_mode,company_invitation_id=excluded.company_invitation_id,
    title=case when existing.source_revision=excluded.source_revision then existing.title else excluded.title end,
    study_snapshot=case when existing.source_revision=excluded.source_revision then existing.study_snapshot else excluded.study_snapshot end,
    shared_revision=existing.shared_revision+1;
 end if;
 update private.feasibility_company_invitations set state=next_state where id=invitation.id;
 perform private.feasibility_company_invitation_audit(invitation,next_state,actor);
 return jsonb_build_object('id',invitation.id,'state',next_state);
end
$$;
alter table private.feasibility_share_proposals add column submission_reasons jsonb, add column decision_reasons jsonb;

create function private.feasibility_valid_item_reasons(changes jsonb, reasons jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(reasons) is distinct from 'object' then false else
  changes <> '{}'::jsonb and reasons ?& array(select jsonb_object_keys(changes))
  and not exists(select from jsonb_each(reasons) r where not (changes ? r.key)
   or jsonb_typeof(r.value)<>'string' or length(btrim(reasons->>r.key)) not between 1 and 2000)
 end;
$$;
revoke all on function private.feasibility_valid_item_reasons(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.feasibility_share_proposal(
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
 item_reasons jsonb;
begin
 if actor is null or not private.feasibility_phase1_org_enabled() then
  raise exception 'FEASIBILITY_PROPOSAL_FORBIDDEN' using errcode='42501';
 end if;
 if p_action is null or p_action not in ('list','recipient','submit','review','approve','reject') then
  raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
 end if;

 source_side:=p_action in ('list','review','approve','reject');
 if not private.feasibility_has_company_plan(p_org,not source_side)
   or not private.feasibility_member_permission(p_org,actor,case when source_side then 'feasibility.proposal_review' else 'feasibility.shared_view' end)
   or (p_action='submit' and not private.feasibility_member_permission(p_org,actor,'feasibility.shared_edit')) then
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
  can_approve:=private.feasibility_member_permission(p_org,actor,'feasibility.shared_edit') and private.feasibility_has_company_plan(p_org,true) and platform_mode='edit' and shared.access_mode='edit'
   and private.feasibility_has_company_plan(project.organization_id,true)
   and coalesce(difference<>'{}'::jsonb,false)
   and coalesce(proposal.state<>'pending' and proposal.shared_revision<shared.shared_revision,true);
  if p_action='recipient' then
   return jsonb_build_object('can_submit',can_approve,'state',proposal.state,'reason',proposal.reason,
    'fields',array(select jsonb_object_keys(difference)), 'last_changes',proposal.changes, 'decisions',proposal.resolutions,'decision_reasons',proposal.decision_reasons, 'submission_reasons',proposal.submission_reasons,'needs_new_share',shared.proposal_baseline is null);
  end if;
  if p_revision is distinct from shared.shared_revision or not can_approve then
   raise exception 'FEASIBILITY_PROPOSAL_NOT_SUBMITTABLE' using errcode='40001';
  end if;
  if not private.feasibility_valid_item_reasons(difference,p_resolutions) then
   raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
  end if;
  insert into private.feasibility_share_proposals(project_id,recipient_id,submitted_by,source_revision,shared_revision,changes,submission_reasons)
  values(p_project,p_org,actor,shared.source_revision,shared.shared_revision,difference,p_resolutions) returning * into proposal;
  select o.name into recipient_name from public.organizations o where o.id=p_org;
  select nullif(btrim(p.name),'') into submitter_name from public.profiles p where p.id=actor;
  notice:=jsonb_build_object('organization',project.organization_id,'project',p_project,'proposal',proposal.id);
  insert into public.notifications(user_id,type,title,body,scheduled_for,metadata)
  select p.id,'feasibility_share_proposal',case when p.locale='ar' then 'تعديلات دراسة بانتظار المراجعة' else 'Study changes awaiting review' end,
   concat(recipient_name,case when submitter_name is not null then ' · '||submitter_name end,' · ',project.title),now(),notice
  from public.organization_members m join public.profiles p on p.id=m.user_id
  where m.organization_id=project.organization_id and private.feasibility_member_permission(m.organization_id,m.user_id,'feasibility.proposal_review') and m.status='ACTIVE';
 else
  can_approve:=platform_mode='edit' and coalesce(shared.access_mode='edit'
   and shared.source_revision=proposal.source_revision and shared.revoked_at is null
   and shared.expires_at>clock_timestamp(),false)
   and private.feasibility_has_company_plan(p_org,true)
   and private.feasibility_has_company_plan(proposal.recipient_id,true);
  if p_action='approve' and (proposal.state<>'pending' or not can_approve or p_revision is distinct from project.revision) then
   raise exception 'FEASIBILITY_PROPOSAL_STALE' using errcode='40001';
  end if;
  if p_action in ('approve','reject') then
   if p_revision is distinct from project.revision then raise exception 'FEASIBILITY_PROPOSAL_STALE' using errcode='40001'; end if;
   if not private.feasibility_valid_item_reasons(proposal.changes,p_resolutions->'reasons')
    or jsonb_typeof(p_resolutions->'choices') is distinct from 'object' then
    raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
   end if;
   item_reasons:=p_resolutions->'reasons';
   p_resolutions:=p_resolutions->'choices';
   if not (p_resolutions ?& array(select jsonb_object_keys(proposal.changes)))
    or exists(select from jsonb_each_text(p_resolutions) r where not (proposal.changes ? r.key)
    or r.value is null or r.value not in ('current','proposed') or (p_action='reject' and r.value<>'current')) then
    raise exception 'FEASIBILITY_INVALID_PROPOSAL' using errcode='22023';
   end if;
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
    'submission_reason',proposal.submission_reasons->>item.field,'decision_reason',proposal.decision_reasons->>item.field,'conflict',conflict,'can_apply',coalesce(include_change,false),'resolution',choice,'path',to_jsonb(item.path)));
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
   resolutions=p_resolutions,decision_reasons=item_reasons,
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
create or replace function private.feasibility_company_shares_access(
 p_action text,p_organization uuid,p_project uuid,p_recipient uuid,p_revision integer,p_days integer,
 p_access text,p_patch jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 platform_mode text;
 selected_access text:=coalesce(p_access,'read');
 result jsonb;
 shared private.feasibility_organization_shares%rowtype;
 source_org uuid;
 actor uuid:=auth.uid();
 field text;
 value jsonb;
 draft jsonb;
begin
 if actor is null or not private.feasibility_phase1_org_enabled() then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 if p_action in ('inbox','open','edit') and not private.feasibility_member_permission(p_organization,actor,'feasibility.shared_view') then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 if p_action in ('outbox','revoke') and not private.feasibility_member_permission(p_organization,actor,'feasibility.outgoing_manage') then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 if p_action in ('share','edit') then
  select mode into strict platform_mode from private.feasibility_sharing_policy where singleton for share;
 else
  select mode into strict platform_mode from private.feasibility_sharing_policy where singleton;
 end if;
 if platform_mode='disabled' and p_action not in ('outbox','revoke') then
  raise exception 'FEASIBILITY_SHARING_DISABLED' using errcode='42501';
 end if;

 if p_action='edit' then
  if platform_mode<>'edit' or not (private.feasibility_has_company_plan(p_organization,true) and private.feasibility_member_permission(p_organization,actor,'feasibility.shared_edit')) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  select p.organization_id into source_org from public.feasibility_projects p where p.id=p_project;
  select * into shared from private.feasibility_organization_shares s
   where s.project_id=p_project and s.recipient_organization_id=p_organization for update;
  if not found or shared.access_mode<>'edit' or shared.revoked_at is not null
    or shared.expires_at<=clock_timestamp() or not private.feasibility_has_company_plan(source_org,true) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  if p_revision is distinct from shared.shared_revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or pg_column_size(p_patch)>24000 then
   raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
  end if;
  draft:=shared.study_snapshot;
  for field,value in select * from jsonb_each(p_patch) loop
   if field in ('title','notes') then
    if jsonb_typeof(value)<>'string' or (field='title' and length(btrim(value#>>'{}')) not between 1 and 300)
      or (field='notes' and length(value#>>'{}')>5000) then
     raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
    end if;
    if field='title' then value:=to_jsonb(btrim(value#>>'{}')); end if;
    draft:=jsonb_set(draft,array[field],value);
   elsif field in ('monthlyUnits','unitPrice','variableCost','monthlyFixedCost','workingCapital','discountRatePct',
                    'priceCarton','variableCarton','fixedMonth','bottlesHour','discountRate') then
    if jsonb_typeof(value)<>'number' then raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023'; end if;
    if (value#>>'{}')::numeric not between 0 and
      (case field when 'discountRate' then 1000 when 'discountRatePct' then 100000 else 1000000000000 end) then
     raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
    end if;
    if field in ('priceCarton','variableCarton','fixedMonth','bottlesHour','discountRate') then
     if jsonb_typeof(draft#>'{water,ops}') is distinct from 'object' then
      raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
     end if;
     draft:=jsonb_set(draft,array['water','ops',field],value);
    elsif draft ? 'water' then
     raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
    else
     draft:=jsonb_set(draft,array[field],value);
    end if;
   else
    raise exception 'FEASIBILITY_INVALID_SHARE_EDIT' using errcode='22023';
   end if;
  end loop;
  update private.feasibility_organization_shares s
   set study_snapshot=jsonb_set(draft,'{updatedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    title=coalesce(draft->>'title',s.title),shared_revision=s.shared_revision+1
   where s.project_id=p_project and s.recipient_organization_id=p_organization
   returning jsonb_build_object('shared_revision',s.shared_revision,'study',s.study_snapshot) into result;
  insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
   values(actor,'feasibility.organization_share_edit','feasibility_project',p_project,
    jsonb_build_object('source_organization_id',source_org,'recipient_organization_id',p_organization,
      'shared_revision',result->'shared_revision'));
  return result;
 end if;

 if p_action='share' then
  if selected_access not in ('read','edit') then raise exception 'FEASIBILITY_INVALID_SHARE_MODE' using errcode='22023'; end if;
  if selected_access='edit' and (platform_mode<>'edit' or not private.feasibility_has_company_plan(p_recipient,true)) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  if not exists(select 1 from public.organization_members m where m.organization_id=p_organization
    and m.user_id=actor and m.status='ACTIVE' and m.role='OWNER') then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  -- Match the canonical lock order: source project, then recipient copy.
  perform 1 from public.feasibility_projects p where p.id=p_project and p.organization_id=p_organization for update;
  if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
  select * into shared from private.feasibility_organization_shares s
   where s.project_id=p_project and s.recipient_organization_id=p_recipient for update;
 end if;

 result:=private.feasibility_company_shares(p_action,p_organization,p_project,p_recipient,p_revision,p_days);
 if p_action='share' then
  update private.feasibility_organization_shares s set access_mode=selected_access,
   study_snapshot=case when shared.source_revision=p_revision then shared.study_snapshot else s.study_snapshot end,
   title=case when shared.source_revision=p_revision then shared.title else s.title end,
   shared_revision=s.shared_revision+1
   where s.project_id=p_project and s.recipient_organization_id=p_recipient;
  return result||jsonb_build_object('access_mode',selected_access);
 end if;
 if p_action='open' and result is not null then
  select * into shared from private.feasibility_organization_shares s
   where s.project_id=p_project and s.recipient_organization_id=p_organization for share;
  if not found then return null; end if;
  result:=private.feasibility_company_shares('open',p_organization,p_project,null,null,null);
  return result||jsonb_build_object('shared_revision',shared.shared_revision,
   'can_edit',platform_mode='edit' and shared.access_mode='edit' and (private.feasibility_has_company_plan(p_organization,true) and private.feasibility_member_permission(p_organization,actor,'feasibility.shared_edit')));
 end if;
 if p_action='outbox' then
  return (select coalesce(jsonb_agg(item.value||jsonb_build_object('access_mode',s.access_mode) order by item.ordinal),'[]'::jsonb)
   from jsonb_array_elements(result) with ordinality item(value,ordinal)
   join private.feasibility_organization_shares s on s.project_id=p_project
    and s.recipient_organization_id=(item.value->>'recipient_organization_id')::uuid);
 end if;
 return result;
end
$$;
create or replace function private.feasibility_company_share_audit(p_organization uuid,p_project uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
begin
 if actor is null or not private.feasibility_phase1_org_enabled()
  or not coalesce(private.feasibility_company_access(p_organization,false),false)
  or not private.feasibility_member_permission(p_organization,actor,'feasibility.sharing_audit')
  or not exists (
   select 1 from public.feasibility_projects p where p.id=p_project
    and p.organization_id=p_organization and p.owner_user_id is null
  ) then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;

 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',event.id,'kind',event.event_type,'occurred_at',event.created_at,
   'recipient_organization_id',event.details->'recipient_organization_id',
   'proposal_id',event.details->'proposal_id',
   'source_revision',event.details->'source_revision',
   'shared_revision',event.details->'shared_revision',
   'approved_revision',event.details->'approved_revision'
  ) order by event.created_at desc,event.id desc)
  from (
   select a.id,a.event_type,a.created_at,a.details
   from public.platform_audit_events a
   where a.entity_type='feasibility_project' and a.entity_id=p_project
    and a.details->>'source_organization_id'=p_organization::text
    and a.event_type in (
     'feasibility.organization_share_share','feasibility.organization_share_revoke',
     'feasibility.organization_share_edit','feasibility.share_proposal_submit',
     'feasibility.share_proposal_approve','feasibility.share_proposal_reject'
    )
   order by a.created_at desc,a.id desc limit 100
  ) event
 ),'[]'::jsonb);
end
$$;

alter table private.feasibility_company_invitations
 add column document_mode text not null default 'none' check(document_mode in ('none','all','selected')),
 add column document_ids uuid[] not null default '{}';

create function public.feasibility_issue_with_documents(p_organization uuid,p_project uuid,p_recipient uuid,
 p_revision integer,p_days integer,p_access text,p_document_mode text,p_documents uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare captured uuid[]; prior uuid; result jsonb; issued uuid;
begin
 if not private.feasibility_member_permission(p_organization,auth.uid(),'feasibility.invite') then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 perform 1 from public.feasibility_projects where id=p_project and organization_id=p_organization for update;
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 if p_document_mode is null or p_document_mode not in ('none','all','selected') or p_documents is null
  or (p_document_mode='selected') is distinct from (cardinality(p_documents)>0) then
  raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
 end if;
 if p_document_mode<>'none' and not exists(select from private.feasibility_evidence_feature_switch where singleton and enabled) then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 select id into prior from private.feasibility_company_invitations where project_id=p_project and recipient_id=p_recipient and state='pending';
 result:=private.feasibility_company_invitations('issue',p_organization,null,p_project,p_recipient,p_revision,p_days,p_access);
 issued:=(result->>'id')::uuid;
 if issued=prior then
  if exists(select from private.feasibility_company_invitations where id=issued and document_mode=p_document_mode
    and (p_document_mode<>'selected' or (document_ids @> p_documents and document_ids <@ p_documents))) then return result; end if;
  raise exception 'FEASIBILITY_COMPANY_INVITATION_PENDING' using errcode='40001';
 end if;
 select array(select id from private.feasibility_evidence_documents where project_id=p_project
  and (p_document_mode='all' or (p_document_mode='selected' and id=any(p_documents))) order by id) into captured;
 if p_document_mode='selected' and cardinality(captured)<>cardinality(p_documents) then
  raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
 end if;
 update private.feasibility_company_invitations set document_mode=p_document_mode,document_ids=captured where id=issued;
 return result;
end $$;
revoke all on function public.feasibility_issue_with_documents(uuid,uuid,uuid,integer,integer,text,text,uuid[]) from public,anon;
grant execute on function public.feasibility_issue_with_documents(uuid,uuid,uuid,integer,integer,text,text,uuid[]) to authenticated;
create or replace function public.feasibility_evidence(
 p_action text, p_project uuid, p_kind text, p_organization uuid default null,
 p_document uuid default null, p_filename text default null, p_media_type text default null, p_payload text default null, p_requirement text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := auth.uid();
 is_write boolean := p_action in ('upload','remove');
 result jsonb;
begin
 if actor is null or not exists (select 1 from private.feasibility_evidence_feature_switch where singleton and enabled) or
    p_action is null or p_action not in ('list','download','upload','remove') or
    p_kind is null or p_kind not in ('licensing','valuation') then
  raise exception 'FEASIBILITY_EVIDENCE_FORBIDDEN' using errcode='42501';
 end if;
 if not is_write and p_organization is not null and exists(select from public.feasibility_projects where id=p_project and organization_id<>p_organization) then
  if private.feasibility_company_shares_access('open',p_organization,p_project,null,null,null,null,null) is null then
   raise exception 'FEASIBILITY_EVIDENCE_FORBIDDEN' using errcode='42501';
  end if;
  select case when p_action='list' then coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.filename,
   'size',octet_length(d.file_data),'createdAt',d.created_at,'requirementId',d.requirement_id) order by d.created_at,d.id),'[]'::jsonb)
   else (jsonb_agg(jsonb_build_object('name',d.filename,'base64',encode(d.file_data,'base64')))->0) end into result
  from private.feasibility_organization_shares s join private.feasibility_company_invitations i on i.id=s.company_invitation_id
  join private.feasibility_evidence_documents d on d.id=any(i.document_ids) and d.project_id=s.project_id
  where s.project_id=p_project and s.recipient_organization_id=p_organization and i.state='accepted'
   and d.kind=p_kind and (p_action='list' or d.id=p_document);
  return result;
 end if;
 if not exists (
  select 1 from public.feasibility_projects p where p.id = p_project
   and p.organization_id is not distinct from p_organization
   and case when p_organization is null then p.owner_user_id = actor and exists (
     select 1 from public.feasibility_access_grants g where g.user_id=actor and g.starts_at<=now()
      and (not is_write or (g.status in ('ACTIVE','TRIAL') and (g.ends_at is null or now()<g.ends_at)))
    )
    else private.feasibility_phase1_org_enabled() and private.feasibility_company_access(p_organization,is_write)
   end
 ) then
  raise exception 'FEASIBILITY_EVIDENCE_FORBIDDEN' using errcode='42501';
 end if;

 if p_action = 'list' then
  return coalesce((
   select jsonb_agg(jsonb_build_object('id',d.id,'name',d.filename,'size',octet_length(d.file_data),
    'createdAt',d.created_at,'requirementId',d.requirement_id) order by d.created_at desc, d.id)
   from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind
  ),'[]'::jsonb);
 end if;
 if p_action = 'download' then
  select jsonb_build_object('name',d.filename,'base64',encode(d.file_data,'base64')) into result
  from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind and d.id=p_document;
  return result;
 end if;
 if p_action = 'remove' then
  delete from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind and d.id=p_document
  returning jsonb_build_object('id',d.id) into result;
  return result;
 end if;

 if p_payload is null or length(p_payload) > 2796204 then
  raise exception 'FEASIBILITY_EVIDENCE_INVALID_FILE' using errcode='22023';
 end if;
 if p_requirement is not null then
  if p_kind <> 'licensing' or char_length(p_requirement) not between 1 and 100 then
   raise exception 'FEASIBILITY_EVIDENCE_INVALID_REQUIREMENT' using errcode='22023';
  end if;
  -- Hold the study row while verifying that the attachment refers to a saved requirement.
  perform 1 from public.feasibility_projects p where p.id=p_project and exists (
   select 1 from jsonb_array_elements(
    case when jsonb_typeof(p.study->'legal') = 'array' then p.study->'legal' else '[]'::jsonb end
   ) as item where item->>'id'=p_requirement
  ) for share;
  if not found then
   raise exception 'FEASIBILITY_EVIDENCE_INVALID_REQUIREMENT' using errcode='22023';
  end if;
 end if;
 -- Serialize the document cap across simultaneous uploads to the same study.
 perform pg_advisory_xact_lock(hashtextextended('feasibility-evidence:' || p_project::text,0));
 if (select count(*) from private.feasibility_evidence_documents d where d.project_id=p_project) >= 20 then
  raise exception 'FEASIBILITY_EVIDENCE_LIMIT' using errcode='23514';
 end if;
 insert into private.feasibility_evidence_documents (project_id,kind,requirement_id,filename,media_type,file_data)
 values (p_project,p_kind,p_requirement,p_filename,p_media_type,decode(p_payload,'base64'))
 returning jsonb_build_object('id',id,'name',filename,'size',octet_length(file_data),'createdAt',created_at,'requirementId',requirement_id) into result;
 return result;
end;
$$;
commit;
