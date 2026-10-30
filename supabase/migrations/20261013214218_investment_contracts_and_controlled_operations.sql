-- Fixed-rate deposit/bond/sukuk contracts. Forecasts and estimates never post cash or zakat.
create table if not exists public.investment_contracts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),organization_id uuid references public.organizations(id),
 asset_account_id uuid unique references public.asset_accounts(id),terms jsonb not null,status text not null default 'DRAFT' check(status in('DRAFT','ACTIVE','CLOSED','CANCELLED')),
 request_id uuid not null,supersedes_id uuid references public.investment_contracts(id),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,request_id)
);
create table if not exists public.investment_operations(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.investment_contracts(id),user_id uuid not null references auth.users(id),organization_id uuid references public.organizations(id),
 kind text not null check(kind in('FUND','INCOME','REDEEM')),operation_date date not null,account_id uuid not null,amount numeric(24,4) not null check(amount>0),exchange_rate numeric(24,10) not null check(exchange_rate>0),notes text not null,withheld_zakat numeric(24,4)not null default 0 check(withheld_zakat>=0),
 status text not null default 'PREPARED' check(status in('PREPARED','APPROVED','POSTED','CANCELLED')),request_id uuid not null,
 recognition_event_id uuid references public.financial_events(id),settlement_event_id uuid unique references public.financial_events(id),flow_id uuid references public.liquidity_flows(id),
 approved_by uuid references auth.users(id),posted_by uuid references auth.users(id),created_at timestamptz not null default now(),posted_at timestamptz,unique(user_id,request_id)
);
create unique index if not exists investment_one_operation_kind on public.investment_operations(contract_id,kind) where status<>'CANCELLED';
alter table public.investment_contracts add column if not exists supersedes_id uuid references public.investment_contracts(id);
alter table public.investment_operations add column if not exists withheld_zakat numeric(24,4)not null default 0 check(withheld_zakat>=0);
create index if not exists investment_org_idx on public.investment_contracts(organization_id);
create index if not exists investment_owner_idx on public.investment_contracts(user_id);
create index if not exists investment_operation_contract_idx on public.investment_operations(contract_id);
alter table public.investment_contracts enable row level security;
alter table public.investment_operations enable row level security;
do $$begin if not exists(select 1 from pg_policies where schemaname='public'and tablename='investment_contracts'and policyname='investment_contract_read')then create policy investment_contract_read on public.investment_contracts for select to authenticated using((organization_id is null and user_id=(select auth.uid())) or(organization_id is not null and public.has_organization_permission(organization_id,'assets.view')));end if;end $$;
do $$begin if not exists(select 1 from pg_policies where schemaname='public'and tablename='investment_operations'and policyname='investment_operation_read')then create policy investment_operation_read on public.investment_operations for select to authenticated using(exists(select 1 from public.investment_contracts c where c.id=contract_id));end if;end $$;
revoke all on public.investment_contracts,public.investment_operations from public,anon,authenticated;
grant select on public.investment_contracts,public.investment_operations to authenticated;


