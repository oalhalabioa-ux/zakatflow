alter table public.currencies
  add column if not exists created_by uuid references auth.users(id);

alter table public.currencies
  add constraint currencies_code_format_check
  check (code ~ '^[A-Z]{3}$');

grant select, insert on public.currencies to authenticated;

drop policy if exists currencies_insert_org_admin on public.currencies;
create policy currencies_insert_org_admin
  on public.currencies
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.status = 'ACTIVE'
        and m.role in ('OWNER', 'ADMIN')
    )
  );

alter table public.fx_rates
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

alter table public.fx_rates
  drop constraint if exists fx_rates_from_currency_to_currency_valuation_date_source_key;

alter table public.fx_rates
  add constraint fx_rates_org_pair_date_source_key
  unique (organization_id, from_currency, to_currency, valuation_date, source);

create index if not exists idx_fx_rates_org_pair_date
  on public.fx_rates (organization_id, from_currency, to_currency, valuation_date desc);

grant select, insert, update, delete on public.fx_rates to authenticated;

drop policy if exists fx_read on public.fx_rates;
create policy fx_read
  on public.fx_rates
  for select to authenticated
  using (
    organization_id is null
    or public.is_organization_member(organization_id)
  );

drop policy if exists fx_insert_restricted on public.fx_rates;
drop policy if exists fx_org_manage on public.fx_rates;
create policy fx_org_manage
  on public.fx_rates
  for all to authenticated
  using (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  )
  with check (
    organization_id is not null
    and public.is_organization_admin(organization_id)
  );
