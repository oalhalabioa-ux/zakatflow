-- Avoid recursive organization_members policies and allow the owner to
-- bootstrap the first membership row when creating a new organization.
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
  );
$$;

revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_admin(uuid) to authenticated;

drop policy if exists org_member_read on public.organization_members;
create policy org_member_read on public.organization_members
  for select to public
  using (
    user_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

drop policy if exists org_member_manage on public.organization_members;
create policy org_member_manage on public.organization_members
  for all to public
  using (
    public.is_organization_admin(organization_id)
    or (
      user_id = auth.uid()
      and role = 'OWNER'
      and exists (
        select 1
        from public.organizations o
        where o.id = organization_members.organization_id
          and o.owner_user_id = auth.uid()
      )
    )
  )
  with check (
    public.is_organization_admin(organization_id)
    or (
      user_id = auth.uid()
      and role = 'OWNER'
      and exists (
        select 1
        from public.organizations o
        where o.id = organization_members.organization_id
          and o.owner_user_id = auth.uid()
      )
    )
  );
