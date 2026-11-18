begin;
set local lock_timeout='3s';

create table private.feasibility_sharing_policy (
 singleton boolean primary key default true check (singleton),
 mode text not null default 'read' check (mode in ('disabled','read','edit'))
);
alter table private.feasibility_sharing_policy enable row level security;
revoke all on private.feasibility_sharing_policy from public,anon,authenticated,service_role;
insert into private.feasibility_sharing_policy default values;

alter table private.feasibility_organization_shares
 add column access_mode text not null default 'read' check (access_mode in ('read','edit')),
 add column shared_revision integer not null default 1 check (shared_revision>0);

create function private.feasibility_manage_sharing(p_mode text)
returns text language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 previous text;
begin
 if actor is null then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 if p_mode is null then
  return (select mode from private.feasibility_sharing_policy where singleton);
 end if;
 if not exists(select 1 from public.platform_admins where user_id=actor and role='platform_owner') then
  raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
 end if;
 if p_mode not in ('disabled','read','edit') then
  raise exception 'FEASIBILITY_INVALID_SHARE_MODE' using errcode='22023';
 end if;
 select mode into strict previous from private.feasibility_sharing_policy where singleton for update;
 if previous is distinct from p_mode then
  update private.feasibility_sharing_policy set mode=p_mode where singleton;
  insert into public.platform_audit_events(actor_user_id,event_type,entity_type,details)
  values(actor,'feasibility.organization_sharing_policy','feasibility_sharing_policy',
   jsonb_build_object('previous_mode',previous,'mode',p_mode));
 end if;
 return p_mode;
end
$$;
revoke all on function private.feasibility_manage_sharing(text) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_manage_sharing(text) to authenticated;

create function public.feasibility_manage_sharing(p_mode text default null)
returns text language sql security invoker set search_path='' as $$
 select private.feasibility_manage_sharing(p_mode)
$$;
revoke all on function public.feasibility_manage_sharing(text) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_manage_sharing(text) to authenticated;

-- Each editable share is a revisioned working copy. The source and other
-- recipients' copies remain separate.
create function private.feasibility_company_shares_access(
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
 if p_action in ('share','edit') then
  select mode into strict platform_mode from private.feasibility_sharing_policy where singleton for share;
 else
  select mode into strict platform_mode from private.feasibility_sharing_policy where singleton;
 end if;
 if platform_mode='disabled' and p_action not in ('outbox','revoke') then
  raise exception 'FEASIBILITY_SHARING_DISABLED' using errcode='42501';
 end if;

 if p_action='edit' then
  if platform_mode<>'edit' or not private.feasibility_company_access(p_organization,true) then
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
   'can_edit',platform_mode='edit' and shared.access_mode='edit' and private.feasibility_company_access(p_organization,true));
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
revoke all on function private.feasibility_company_shares_access(text,uuid,uuid,uuid,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_company_shares_access(text,uuid,uuid,uuid,integer,integer,text,jsonb) to authenticated;
revoke execute on function private.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer) from authenticated;

create function public.feasibility_company_shares_access(
 p_action text,p_organization uuid,p_project uuid default null,p_recipient uuid default null,
 p_revision integer default null,p_days integer default null,p_access text default null,p_patch jsonb default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.feasibility_company_shares_access(p_action,p_organization,p_project,p_recipient,p_revision,p_days,p_access,p_patch)
$$;
revoke all on function public.feasibility_company_shares_access(text,uuid,uuid,uuid,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.feasibility_company_shares_access(text,uuid,uuid,uuid,integer,integer,text,jsonb) to authenticated;

-- The original RPC remains compatible for older web sessions and cannot bypass policy.
create or replace function public.feasibility_company_shares(
 p_action text,p_organization uuid,p_project uuid default null,p_recipient uuid default null,
 p_revision integer default null,p_days integer default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select public.feasibility_company_shares_access(p_action,p_organization,p_project,p_recipient,p_revision,p_days)
$$;

commit;
