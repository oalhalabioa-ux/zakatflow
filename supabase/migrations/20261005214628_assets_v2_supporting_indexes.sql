-- Assets V2 supporting indexes identified by QA database advisor.
create index if not exists idx_asset_accounts_asset_type_code on public.asset_accounts(asset_type_code);
create index if not exists idx_asset_accounts_cost_center_id on public.asset_accounts(cost_center_id);
create index if not exists idx_asset_accounts_entity_id on public.asset_accounts(entity_id);
create index if not exists idx_asset_types_v2_class_code on public.asset_types_v2(class_code);
