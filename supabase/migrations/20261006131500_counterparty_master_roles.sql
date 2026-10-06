-- Counterparty Master V1: one party, multiple operational/financial roles
create table if not exists public.liquidity_counterparty_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counterparty_id uuid not null references public.liquidity_counterparties(id) on delete cascade,
  role_code text not null check (role_code in ('CUSTOMER','SUPPLIER','ASSET_SUPPLIER','INVESTEE','INVESTMENT_MANAGER','LENDER','BORROWER','EMPLOYEE','GOVERNMENT','TAX_AUTHORITY','RELATED_PARTY','OTHER')),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id,counterparty_id,role_code)
);
create index if not exists liquidity_counterparty_roles_org_role_idx on public.liquidity_counterparty_roles(organization_id,role_code) where active;
alter table public.liquidity_counterparty_roles enable row level security;
drop policy if exists liquidity_counterparty_roles_member_read on public.liquidity_counterparty_roles;
create policy liquidity_counterparty_roles_member_read on public.liquidity_counterparty_roles for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id=liquidity_counterparty_roles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE'));
drop policy if exists liquidity_counterparty_roles_member_write on public.liquidity_counterparty_roles;
create policy liquidity_counterparty_roles_member_write on public.liquidity_counterparty_roles for all to authenticated using (exists (select 1 from public.organization_members m where m.organization_id=liquidity_counterparty_roles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE' and m.role in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR'))) with check (exists (select 1 from public.organization_members m where m.organization_id=liquidity_counterparty_roles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE' and m.role in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR')));
insert into public.liquidity_counterparty_roles(organization_id,counterparty_id,role_code,created_by)
select organization_id,id,case party_type when 'CUSTOMER' then 'CUSTOMER' when 'SUPPLIER' then 'SUPPLIER' when 'PERSON' then 'OTHER' else 'OTHER' end,created_by from public.liquidity_counterparties
on conflict (organization_id,counterparty_id,role_code) do nothing;
insert into public.liquidity_counterparty_roles(organization_id,counterparty_id,role_code,created_by)
select organization_id,id,'SUPPLIER',created_by from public.liquidity_counterparties where party_type='BOTH'
on conflict (organization_id,counterparty_id,role_code) do nothing;
insert into public.liquidity_counterparty_roles(organization_id,counterparty_id,role_code,created_by)
select organization_id,id,'CUSTOMER',created_by from public.liquidity_counterparties where party_type='BOTH'
on conflict (organization_id,counterparty_id,role_code) do nothing;
