revoke all on function public.can_write_liquidity(uuid) from public, anon;
grant execute on function public.can_write_liquidity(uuid) to authenticated;
drop policy if exists liquidity_accounts_member_write on public.liquidity_accounts;
create policy liquidity_accounts_insert on public.liquidity_accounts for insert to authenticated
  with check (public.can_write_liquidity(organization_id));
create policy liquidity_accounts_update on public.liquidity_accounts for update to authenticated
  using (public.can_write_liquidity(organization_id)) with check (public.can_write_liquidity(organization_id));
create policy liquidity_accounts_delete on public.liquidity_accounts for delete to authenticated
  using (public.can_write_liquidity(organization_id));
drop policy if exists liquidity_flows_member_write on public.liquidity_flows;
create policy liquidity_flows_insert on public.liquidity_flows for insert to authenticated
  with check (public.can_write_liquidity(organization_id));
create policy liquidity_flows_update on public.liquidity_flows for update to authenticated
  using (public.can_write_liquidity(organization_id)) with check (public.can_write_liquidity(organization_id));
create policy liquidity_flows_delete on public.liquidity_flows for delete to authenticated
  using (public.can_write_liquidity(organization_id));
