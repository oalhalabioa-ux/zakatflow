create table if not exists public.liquidity_counterparties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (nullif(trim(name), '') is not null),
  party_type text not null default 'OTHER' check (party_type in ('CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER')),
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index if not exists liquidity_counterparties_org_active_name_idx
  on public.liquidity_counterparties (organization_id, active, name);

alter table public.liquidity_counterparties enable row level security;
drop policy if exists liquidity_counterparties_member_read on public.liquidity_counterparties;
create policy liquidity_counterparties_member_read
  on public.liquidity_counterparties for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists liquidity_counterparties_insert on public.liquidity_counterparties;
create policy liquidity_counterparties_insert
  on public.liquidity_counterparties for insert to authenticated
  with check (private.can_write_liquidity(organization_id) and created_by = (select auth.uid()));
drop policy if exists liquidity_counterparties_update on public.liquidity_counterparties;
create policy liquidity_counterparties_update
  on public.liquidity_counterparties for update to authenticated
  using (private.can_write_liquidity(organization_id))
  with check (private.can_write_liquidity(organization_id));
drop policy if exists liquidity_counterparties_delete on public.liquidity_counterparties;
create policy liquidity_counterparties_delete
  on public.liquidity_counterparties for delete to authenticated
  using (private.can_write_liquidity(organization_id));

grant select, delete on public.liquidity_counterparties to authenticated;
revoke insert, update on public.liquidity_counterparties from authenticated;
grant insert (organization_id, name, party_type, contact_name, phone, email, notes, active)
  on public.liquidity_counterparties to authenticated;
grant update (name, party_type, contact_name, phone, email, notes, active, updated_at)
  on public.liquidity_counterparties to authenticated;

alter table public.liquidity_flows
  add column if not exists counterparty_id uuid;
alter table public.liquidity_flows
  drop constraint if exists liquidity_flows_counterparty_org_fkey;
alter table public.liquidity_flows
  add constraint liquidity_flows_counterparty_org_fkey
  foreign key (counterparty_id, organization_id)
  references public.liquidity_counterparties (id, organization_id)
  on delete set null (counterparty_id);
create index if not exists liquidity_flows_counterparty_idx
  on public.liquidity_flows (counterparty_id) where counterparty_id is not null;

revoke insert, update on public.liquidity_flows from authenticated;
grant insert (organization_id, entity_id, account_id, direction, flow_type, title, counterparty, counterparty_id, due_date, amount, currency, base_amount, status, source, reference, notes)
  on public.liquidity_flows to authenticated;
grant update (entity_id, account_id, direction, flow_type, title, counterparty, counterparty_id, due_date, amount, currency, base_amount, status, source, reference, notes, updated_at)
  on public.liquidity_flows to authenticated;
