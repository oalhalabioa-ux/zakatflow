-- Assets V2 organization reads must respect the explicit assets.view permission.
-- QA-first hardening: keeps personal self-access separate and leaves write policies unchanged.
drop policy if exists assets_org_read on public.asset_accounts;

create policy assets_org_read
on public.asset_accounts
for select
to authenticated
using (
  ownership_scope = 'ORGANIZATION'
  and organization_id is not null
  and public.has_organization_permission(organization_id, 'assets.view')
);
