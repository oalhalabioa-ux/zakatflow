-- OWNER/ADMIN are already full-control in has_organization_permission.
-- Normalize SQL grants so PostgreSQL reaches RLS instead of failing before it.
grant select on public.liquidity_accounts, public.liquidity_flows, public.liquidity_counterparties,
 public.liquidity_flow_categories, public.liquidity_party_types, public.liquidity_transfers,
 public.liquidity_intercompany_transfers to authenticated;

grant insert (organization_id,entity_id,name,account_type,currency,active,notes)
 on public.liquidity_accounts to authenticated;
grant update (entity_id,name,account_type,currency,active,notes,updated_at)
 on public.liquidity_accounts to authenticated;

grant insert (organization_id,code,name_ar,name_en,flow_group,allowed_direction,active,
 financial_classification_type,accounting_group,treatment_code)
 on public.liquidity_flow_categories to authenticated;
grant update (name_ar,name_en,flow_group,allowed_direction,active,
 financial_classification_type,accounting_group,treatment_code,updated_at)
 on public.liquidity_flow_categories to authenticated;

-- Party types are taxonomy configuration; system rows remain protected by RLS/application rules.
grant insert (organization_id,code,name_ar,name_en,active) on public.liquidity_party_types to authenticated;
grant update (name_ar,name_en,active) on public.liquidity_party_types to authenticated;

-- Financially mutable balance/settlement columns intentionally remain outside direct grants.
