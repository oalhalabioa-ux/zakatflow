drop policy if exists fx_org_manage on public.fx_rates;

drop policy if exists fx_org_insert on public.fx_rates;
create policy fx_org_insert
  on public.fx_rates
  for insert to authenticated
  with check (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  );

drop policy if exists fx_org_update on public.fx_rates;
create policy fx_org_update
  on public.fx_rates
  for update to authenticated
  using (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  )
  with check (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  );

drop policy if exists fx_org_delete on public.fx_rates;
create policy fx_org_delete
  on public.fx_rates
  for delete to authenticated
  using (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  );
