create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.can_write_liquidity(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.role in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR')
  );
$$;
revoke all on function private.can_write_liquidity(uuid) from public, anon;
grant execute on function private.can_write_liquidity(uuid) to authenticated;
drop policy if exists liquidity_accounts_insert on public.liquidity_accounts;
drop policy if exists liquidity_accounts_update on public.liquidity_accounts;
drop policy if exists liquidity_accounts_delete on public.liquidity_accounts;
drop policy if exists liquidity_flows_insert on public.liquidity_flows;
drop policy if exists liquidity_flows_update on public.liquidity_flows;
drop policy if exists liquidity_flows_delete on public.liquidity_flows;
create policy liquidity_accounts_insert on public.liquidity_accounts for insert to authenticated
  with check (private.can_write_liquidity(organization_id) and created_by = (select auth.uid()));
create policy liquidity_accounts_update on public.liquidity_accounts for update to authenticated
  using (private.can_write_liquidity(organization_id)) with check (private.can_write_liquidity(organization_id));
create policy liquidity_accounts_delete on public.liquidity_accounts for delete to authenticated
  using (private.can_write_liquidity(organization_id));
create policy liquidity_flows_insert on public.liquidity_flows for insert to authenticated
  with check (private.can_write_liquidity(organization_id) and created_by = (select auth.uid()));
create policy liquidity_flows_update on public.liquidity_flows for update to authenticated
  using (private.can_write_liquidity(organization_id)) with check (private.can_write_liquidity(organization_id));
create policy liquidity_flows_delete on public.liquidity_flows for delete to authenticated
  using (private.can_write_liquidity(organization_id));
create unique index if not exists organization_entities_id_org_liquidity_unique
  on public.organization_entities(id, organization_id);
create unique index if not exists liquidity_accounts_id_org_unique
  on public.liquidity_accounts(id, organization_id);
alter table public.liquidity_accounts drop constraint if exists liquidity_accounts_entity_id_fkey;
alter table public.liquidity_accounts add constraint liquidity_accounts_entity_org_fkey
  foreign key (entity_id, organization_id) references public.organization_entities(id, organization_id) on delete set null (entity_id);
alter table public.liquidity_flows drop constraint if exists liquidity_flows_entity_id_fkey;
alter table public.liquidity_flows add constraint liquidity_flows_entity_org_fkey
  foreign key (entity_id, organization_id) references public.organization_entities(id, organization_id) on delete set null (entity_id);
alter table public.liquidity_flows drop constraint if exists liquidity_flows_account_id_fkey;
alter table public.liquidity_flows add constraint liquidity_flows_account_org_fkey
  foreign key (account_id, organization_id) references public.liquidity_accounts(id, organization_id) on delete set null (account_id);
alter table public.liquidity_accounts alter column created_by set default auth.uid();
alter table public.liquidity_flows alter column created_by set default auth.uid();
revoke insert, update on public.liquidity_accounts from authenticated;
revoke insert, update on public.liquidity_flows from authenticated;
grant insert (organization_id,entity_id,name,account_type,currency,current_balance,restricted_balance,uncleared_balance,current_balance_base,restricted_balance_base,uncleared_balance_base,active,notes)
  on public.liquidity_accounts to authenticated;
grant update (entity_id,name,account_type,currency,current_balance,restricted_balance,uncleared_balance,current_balance_base,restricted_balance_base,uncleared_balance_base,active,notes,updated_at)
  on public.liquidity_accounts to authenticated;
grant insert (organization_id,entity_id,account_id,direction,flow_type,title,counterparty,due_date,amount,currency,base_amount,status,source,reference,notes)
  on public.liquidity_flows to authenticated;
grant update (entity_id,account_id,direction,flow_type,title,counterparty,due_date,amount,currency,base_amount,status,source,reference,notes,updated_at)
  on public.liquidity_flows to authenticated;
drop function if exists public.can_write_liquidity(uuid);
