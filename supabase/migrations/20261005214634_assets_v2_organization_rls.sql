-- Assets V2 organization-aware RLS.
-- PERSONAL keeps legacy self ownership. ORGANIZATION reads are membership based;
-- writes require the dedicated assets.edit permission.
drop policy if exists assets_self on public.asset_accounts;

create policy assets_personal_self on public.asset_accounts
for all to authenticated
using (ownership_scope='PERSONAL' and user_id=auth.uid())
with check (ownership_scope='PERSONAL' and user_id=auth.uid());

create policy assets_org_read on public.asset_accounts
for select to authenticated
using (
  ownership_scope='ORGANIZATION'
  and organization_id is not null
  and public.is_organization_member(organization_id)
);

create policy assets_org_insert on public.asset_accounts
for insert to authenticated
with check (
  ownership_scope='ORGANIZATION'
  and organization_id is not null
  and user_id=auth.uid()
  and public.has_organization_permission(organization_id,'assets.edit')
);

create policy assets_org_update on public.asset_accounts
for update to authenticated
using (
  ownership_scope='ORGANIZATION'
  and organization_id is not null
  and public.has_organization_permission(organization_id,'assets.edit')
)
with check (
  ownership_scope='ORGANIZATION'
  and organization_id is not null
  and public.has_organization_permission(organization_id,'assets.edit')
);

create policy assets_org_delete on public.asset_accounts
for delete to authenticated
using (
  ownership_scope='ORGANIZATION'
  and organization_id is not null
  and public.has_organization_permission(organization_id,'assets.edit')
);
