alter table public.asset_classes enable row level security;
alter table public.asset_types_v2 enable row level security;
create policy asset_classes_authenticated_read on public.asset_classes for select to authenticated using (true);
create policy asset_types_v2_authenticated_read on public.asset_types_v2 for select to authenticated using (true);