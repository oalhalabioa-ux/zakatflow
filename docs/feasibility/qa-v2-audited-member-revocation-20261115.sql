-- QA V2 ONLY (ubotbpjngtfvolthpfec): recorded in the separate QA migration history.
-- No change to Production, main, Financial Core V1 or customer financial data.
-- Owner revocation requires an active independent feasibility licence, checks project ownership,
-- and inserts exactly one immutable audit event for each real ACTIVE -> REVOKED transition.
create or replace function public.feasibility_revoke_project_member(
 p_project_id uuid, p_user_id uuid
)
returns boolean
language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid := (select auth.uid());
 v_old_role text;
begin
 if v_actor is null or p_user_id is null or p_user_id=v_actor then
  raise exception 'PROJECT_OWNER_REQUIRED';
 end if;
 if not exists (
  select 1 from public.feasibility_access_grants g
  where g.user_id=v_actor
    and g.status in ('TRIAL','ACTIVE')
    and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())
 ) then
  raise exception 'FEASIBILITY_READ_ONLY';
 end if;
 if not exists (
  select 1 from public.feasibility_projects p
  where p.id=p_project_id and p.owner_user_id=v_actor
 ) then
  raise exception 'PROJECT_OWNER_REQUIRED';
 end if;
 update public.feasibility_project_members m
 set status='REVOKED',updated_at=now()
 where m.project_id=p_project_id and m.user_id=p_user_id and m.status='ACTIVE'
 returning m.role into v_old_role;
 if not found then return false; end if;
 insert into public.platform_audit_events(
   actor_user_id,event_type,entity_type,entity_id,details
 ) values (
   v_actor,'feasibility.member_revoked','feasibility_project_member',p_user_id,
   jsonb_build_object('project_id',p_project_id,'member_user_id',p_user_id,'previous_role',v_old_role)
 );
 return true;
end
$fn$;
-- Keep execution limited to authenticated callers. SECURITY DEFINER verifies identity & ownership.
revoke all on function public.feasibility_revoke_project_member(uuid,uuid) from public,anon;
grant execute on function public.feasibility_revoke_project_member(uuid,uuid) to authenticated;
