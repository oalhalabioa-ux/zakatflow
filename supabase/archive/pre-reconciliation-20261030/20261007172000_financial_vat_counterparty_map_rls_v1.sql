alter table public.financial_vat_counterparty_map enable row level security;

drop policy if exists financial_vat_counterparty_map_member_read on public.financial_vat_counterparty_map;
create policy financial_vat_counterparty_map_member_read
on public.financial_vat_counterparty_map for select to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists financial_vat_counterparty_map_insert on public.financial_vat_counterparty_map;
create policy financial_vat_counterparty_map_insert
on public.financial_vat_counterparty_map for insert to authenticated
with check (
  private.can_write_liquidity(organization_id)
  and created_by = (select auth.uid())
  and exists (select 1 from public.vat_contacts vc where vc.id=vat_contact_id and vc.organization_id=organization_id)
  and exists (select 1 from public.liquidity_counterparties lc where lc.id=counterparty_id and lc.organization_id=organization_id)
);

grant select, insert on public.financial_vat_counterparty_map to authenticated;
