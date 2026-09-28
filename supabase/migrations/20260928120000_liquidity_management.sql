create table if not exists public.liquidity_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.organization_entities(id) on delete set null,
  name text not null check (nullif(trim(name), '') is not null),
  account_type text not null default 'BANK' check (account_type in ('BANK','CASH','WALLET','INVESTMENT','OTHER')),
  currency text not null default 'SAR' references public.currencies(code),
  current_balance numeric(24,4) not null default 0,
  restricted_balance numeric(24,4) not null default 0 check (restricted_balance >= 0),
  uncleared_balance numeric(24,4) not null default 0 check (uncleared_balance >= 0),
  current_balance_base numeric(24,4) not null default 0,
  restricted_balance_base numeric(24,4) not null default 0 check (restricted_balance_base >= 0),
  uncleared_balance_base numeric(24,4) not null default 0 check (uncleared_balance_base >= 0),
  active boolean not null default true,
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.liquidity_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.organization_entities(id) on delete set null,
  account_id uuid references public.liquidity_accounts(id) on delete set null,
  direction text not null check (direction in ('INFLOW','OUTFLOW')),
  flow_type text not null default 'OPERATING' check (flow_type in ('OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','TRANSFER','OTHER')),
  title text not null check (nullif(trim(title), '') is not null),
  counterparty text not null default '',
  due_date date not null,
  amount numeric(24,4) not null check (amount > 0),
  currency text not null default 'SAR' references public.currencies(code),
  base_amount numeric(24,4) not null check (base_amount > 0),
  status text not null default 'EXPECTED' check (status in ('ACTUAL','CONFIRMED','EXPECTED')),
  source text not null default 'MANUAL' check (source in ('MANUAL','INVOICE','IMPORT','VAT','ACCOUNTING')),
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists liquidity_accounts_org_active_idx on public.liquidity_accounts(organization_id, active, created_at);
create index if not exists liquidity_flows_org_due_idx on public.liquidity_flows(organization_id, due_date, status);
create index if not exists liquidity_flows_account_idx on public.liquidity_flows(account_id) where account_id is not null;

create or replace function public.can_write_liquidity(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.role in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR')
  );
$$;
revoke all on function public.can_write_liquidity(uuid) from public;
grant execute on function public.can_write_liquidity(uuid) to authenticated;

alter table public.liquidity_accounts enable row level security;
alter table public.liquidity_flows enable row level security;
drop policy if exists liquidity_accounts_member_read on public.liquidity_accounts;
create policy liquidity_accounts_member_read on public.liquidity_accounts for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists liquidity_accounts_member_write on public.liquidity_accounts;
create policy liquidity_accounts_member_write on public.liquidity_accounts for all to authenticated
  using (public.can_write_liquidity(organization_id)) with check (public.can_write_liquidity(organization_id));
drop policy if exists liquidity_flows_member_read on public.liquidity_flows;
create policy liquidity_flows_member_read on public.liquidity_flows for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists liquidity_flows_member_write on public.liquidity_flows;
create policy liquidity_flows_member_write on public.liquidity_flows for all to authenticated
  using (public.can_write_liquidity(organization_id)) with check (public.can_write_liquidity(organization_id));
grant select, insert, update, delete on public.liquidity_accounts, public.liquidity_flows to authenticated;
