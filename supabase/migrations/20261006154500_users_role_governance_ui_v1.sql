-- Users role governance UI support V1
create or replace function public.owner_set_organization_approval_policy(p_org uuid,p_policy text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 if p_policy not in ('OWNER_CONTROLLED','ROLE_BASED','STRICT_SEGREGATION') then raise exception 'INVALID_APPROVAL_POLICY'; end if;
 update public.organizations set approval_policy=p_policy where id=p_org;
end $$;
revoke all on function public.owner_set_organization_approval_policy(uuid,text) from public,anon;
grant execute on function public.owner_set_organization_approval_policy(uuid,text) to authenticated;

-- A member-level DENY must override a custom role's self-approval grant.
create or replace function public.financial_event_has_valid_approval(p_event_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.financial_events%rowtype; pol text;
begin
 select * into e from public.financial_events where id=p_event_id;
 if e.id is null then return false; end if;
 select approval_policy into pol from public.organizations where id=e.organization_id;
 if exists(select 1 from public.financial_event_approvals a where a.event_id=e.id and a.organization_id=e.organization_id and a.decision='APPROVED' and a.approver_id<>e.created_by) then return true; end if;
 if pol='OWNER_CONTROLLED' and exists(select 1 from public.financial_event_approvals a join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.approver_id and m.status='ACTIVE' where a.event_id=e.id and a.decision='APPROVED' and a.approver_id=e.created_by and m.role='OWNER') then return true; end if;
 if pol='ROLE_BASED' and exists(
   select 1 from public.financial_event_approvals a
   join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.approver_id and m.status='ACTIVE'
   where a.event_id=e.id and a.decision='APPROVED' and a.approver_id=e.created_by
     and not exists(select 1 from public.organization_member_permission_overrides d where d.organization_id=a.organization_id and d.user_id=a.approver_id and d.permission='financial_core.self_approve' and d.effect='DENY')
     and (
       exists(select 1 from public.organization_member_permission_overrides o where o.organization_id=a.organization_id and o.user_id=a.approver_id and o.permission='financial_core.self_approve' and o.effect='ALLOW')
       or exists(select 1 from public.organization_roles r where r.id=m.custom_role_id and r.organization_id=m.organization_id and 'financial_core.self_approve'=any(r.permissions))
     )
 ) then return true; end if;
 return false;
end $$;