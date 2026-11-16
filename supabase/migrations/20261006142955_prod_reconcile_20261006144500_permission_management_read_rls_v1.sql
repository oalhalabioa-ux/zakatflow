-- Read access for the permission-management UI; mutations remain RPC/Owner-controlled.
grant select on public.organization_roles to authenticated;
grant select on public.organization_member_permission_overrides to authenticated;
drop policy if exists organization_roles_member_read on public.organization_roles;
create policy organization_roles_member_read on public.organization_roles for select to authenticated using (
 exists(select 1 from public.organization_members m where m.organization_id=organization_roles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE')
);
drop policy if exists permission_overrides_member_read on public.organization_member_permission_overrides;
create policy permission_overrides_member_read on public.organization_member_permission_overrides for select to authenticated using (
 exists(select 1 from public.organization_members m where m.organization_id=organization_member_permission_overrides.organization_id and m.user_id=auth.uid() and m.status='ACTIVE')
);