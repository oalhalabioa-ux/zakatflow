begin;
set local lock_timeout='3s';

create function private.feasibility_has_company_plan(p_organization uuid, p_writable boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
   select e->'capabilities' ? 'module:feasibility' and (not p_writable or e->>'status'='active')
   from public.organizations o cross join lateral subscription_private.entitlement(o.id) e
   where o.id=p_organization and o.status='ACTIVE'
 ),false)
$$;
revoke all on function private.feasibility_has_company_plan(uuid,boolean) from public,anon,authenticated,service_role;

create function private.feasibility_company_access(p_organization uuid,p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m
   where m.organization_id=p_organization and m.user_id=(select auth.uid()) and m.status='ACTIVE'
   and (not p_write or m.role in ('OWNER','ADMIN')))
   and private.feasibility_has_company_plan(p_organization,p_write)
$$;
revoke all on function private.feasibility_company_access(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_company_access(uuid,boolean) to authenticated;

create function public.feasibility_company_workspace(p_organization uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('canRead',private.feasibility_phase1_org_enabled() and private.feasibility_company_access(p_organization,false),
   'canWrite',private.feasibility_phase1_org_enabled() and private.feasibility_company_access(p_organization,true),
   'canShare',private.feasibility_phase1_org_enabled() and exists(select 1 from public.organization_members m
     where m.organization_id=p_organization and m.user_id=(select auth.uid()) and m.status='ACTIVE' and m.role='OWNER'))
$$;
revoke all on function public.feasibility_company_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_company_workspace(uuid) to authenticated;

alter policy feasibility_org_read on public.feasibility_projects
 using (organization_id is not null and (select private.feasibility_phase1_org_enabled())
   and private.feasibility_company_access(organization_id,false));
alter policy feasibility_org_insert on public.feasibility_projects
 with check (organization_id is not null and (select private.feasibility_phase1_org_enabled())
   and created_by_user_id=(select auth.uid()) and private.feasibility_company_access(organization_id,true));
alter policy feasibility_org_update on public.feasibility_projects
 using (organization_id is not null and (select private.feasibility_phase1_org_enabled())
   and private.feasibility_company_access(organization_id,true))
 with check (organization_id is not null and (select private.feasibility_phase1_org_enabled())
   and private.feasibility_company_access(organization_id,true));

create table private.feasibility_organization_shares (
 project_id uuid not null references public.feasibility_projects(id) on delete cascade,
 recipient_organization_id uuid not null references public.organizations(id) on delete cascade,
 source_revision integer not null check(source_revision > 0),
 title text not null,
 study_snapshot jsonb not null,
 first_shared_at timestamptz not null,
 expires_at timestamptz not null check(expires_at > first_shared_at and isfinite(expires_at)),
 shared_by uuid references auth.users(id) on delete set null,
 revoked_at timestamptz,
 primary key (project_id,recipient_organization_id)
);
alter table private.feasibility_organization_shares enable row level security;
revoke all on private.feasibility_organization_shares from public,anon,authenticated,service_role;
create index feasibility_shares_recipient on private.feasibility_organization_shares(recipient_organization_id,expires_at);

create function private.feasibility_company_shares(
 p_action text,p_organization uuid,p_project uuid,p_recipient uuid,p_revision integer,p_days integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 now_at timestamptz:=statement_timestamp();
 study_row public.feasibility_projects%rowtype;
 share private.feasibility_organization_shares%rowtype;
 cutoff timestamptz;
 response jsonb;
 paid_recipient boolean;
begin
 if actor is null or not private.feasibility_phase1_org_enabled() or not exists(
   select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
   where m.organization_id=p_organization and m.user_id=actor and m.status='ACTIVE' and o.status='ACTIVE'
 ) then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;

 if p_action in ('inbox','open') then
  paid_recipient:=private.feasibility_has_company_plan(p_organization,true);
  select coalesce(jsonb_agg(r), '[]'::jsonb) into response from (
   select s.project_id,s.title,s.source_revision,src.name as source_name,
    case when paid_recipient then s.expires_at else least(s.expires_at,s.first_shared_at+interval '720 hours') end as expires_at,
    case when p_action='open' then s.study_snapshot end as study
   from private.feasibility_organization_shares s
   join public.feasibility_projects p on p.id=s.project_id
   join public.organizations src on src.id=p.organization_id
   where s.recipient_organization_id=p_organization and s.revoked_at is null and s.expires_at>now_at
     and (paid_recipient or s.first_shared_at+interval '720 hours'>now_at)
     and (p_action='inbox' or s.project_id=p_project)
     and private.feasibility_has_company_plan(src.id,true)
   order by s.expires_at,s.project_id limit 300
  ) r;
  if p_action='open' then return response->0; end if;
  return response;
 end if;

 if not exists(select 1 from public.organization_members m where m.organization_id=p_organization
   and m.user_id=actor and m.status='ACTIVE' and m.role='OWNER')
 then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 select * into study_row from public.feasibility_projects p
 where p.id=p_project and p.organization_id=p_organization for update;
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;

 if p_action='outbox' then
  return (select coalesce(jsonb_agg(jsonb_build_object('recipient_organization_id',s.recipient_organization_id,
    'source_revision',s.source_revision,'expires_at',
    case when private.feasibility_has_company_plan(s.recipient_organization_id,true) then s.expires_at
      else least(s.expires_at,s.first_shared_at+interval '720 hours') end,'revoked_at',s.revoked_at)
    order by s.expires_at desc),'[]'::jsonb) from private.feasibility_organization_shares s where s.project_id=p_project);
 elsif p_action='revoke' then
  update private.feasibility_organization_shares s set revoked_at=now_at
  where s.project_id=p_project and s.recipient_organization_id=p_recipient and s.revoked_at is null;
  if not found then return null; end if;
 elsif p_action='share' then
  if not private.feasibility_company_access(p_organization,true) then
   raise exception 'FEASIBILITY_SOURCE_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  if p_revision is distinct from study_row.revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  if p_recipient is null or p_recipient=p_organization or not exists(
    select 1 from public.organizations o where o.id=p_recipient and o.status='ACTIVE')
   or p_days is null or p_days<1
  then raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023'; end if;

  select * into share from private.feasibility_organization_shares s
  where s.project_id=p_project and s.recipient_organization_id=p_recipient;
  cutoff:=now_at+p_days*interval '24 hours';
  if not private.feasibility_has_company_plan(p_recipient,true) and
     cutoff>coalesce(share.first_shared_at,now_at)+interval '720 hours'
   then raise exception 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' using errcode='22023'; end if;

  insert into private.feasibility_organization_shares
   (project_id,recipient_organization_id,source_revision,title,study_snapshot,first_shared_at,expires_at,shared_by)
  values (p_project,p_recipient,study_row.revision,study_row.title,study_row.study,now_at,cutoff,actor)
  on conflict (project_id,recipient_organization_id) do update
  set source_revision=excluded.source_revision,title=excluded.title,study_snapshot=excluded.study_snapshot,
      expires_at=excluded.expires_at,shared_by=excluded.shared_by,revoked_at=null;
 else
  raise exception 'FEASIBILITY_INVALID_SHARE_ACTION' using errcode='22023';
 end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(actor,'feasibility.organization_share_'||p_action,'feasibility_project',p_project,
   jsonb_build_object('source_organization_id',p_organization,'recipient_organization_id',p_recipient,
     'source_revision',study_row.revision,'expires_at',cutoff));
 return jsonb_build_object('ok',true,'expires_at',cutoff);
end
$$;
revoke all on function private.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer) to authenticated;

create function public.feasibility_company_shares(
 p_action text,p_organization uuid,p_project uuid default null,
 p_recipient uuid default null,p_revision integer default null,p_days integer default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.feasibility_company_shares(p_action,p_organization,p_project,p_recipient,p_revision,p_days)
$$;
revoke all on function public.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer) to authenticated;

commit;
