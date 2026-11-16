-- Break the circular RLS dependency between organizations and organization_members.
-- These helpers read the membership tables as the function owner, so policy checks
-- do not recursively invoke the policy being evaluated.
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

create or replace function public.is_organization_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.owner_user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role in ('OWNER', 'ADMIN')
      and m.status = 'ACTIVE'
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.is_organization_owner(uuid) from public;
revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;

drop policy if exists org_membership_read on public.organizations;
create policy org_membership_read on public.organizations
  for select to authenticated
  using (
    owner_user_id = auth.uid()
    or public.is_organization_member(id)
  );

drop policy if exists org_owner_write on public.organizations;
create policy org_owner_write on public.organizations
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists org_member_read on public.organization_members;
create policy org_member_read on public.organization_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

drop policy if exists org_member_manage on public.organization_members;
create policy org_member_manage on public.organization_members
  for all to authenticated
  using (
    public.is_organization_admin(organization_id)
    or (
      user_id = auth.uid()
      and role = 'OWNER'
      and public.is_organization_owner(organization_id)
    )
  )
  with check (
    public.is_organization_admin(organization_id)
    or (
      user_id = auth.uid()
      and role = 'OWNER'
      and public.is_organization_owner(organization_id)
    )
  );
