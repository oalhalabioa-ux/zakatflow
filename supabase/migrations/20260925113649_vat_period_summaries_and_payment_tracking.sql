create table if not exists public.vat_period_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  sales_standard_base numeric(20,2) not null default 0 check (sales_standard_base >= 0),
  sales_zero_rated_base numeric(20,2) not null default 0 check (sales_zero_rated_base >= 0),
  sales_exempt_base numeric(20,2) not null default 0 check (sales_exempt_base >= 0),
  sales_out_of_scope_base numeric(20,2) not null default 0 check (sales_out_of_scope_base >= 0),
  purchases_standard_base numeric(20,2) not null default 0 check (purchases_standard_base >= 0),
  purchases_zero_rated_base numeric(20,2) not null default 0 check (purchases_zero_rated_base >= 0),
  purchases_exempt_base numeric(20,2) not null default 0 check (purchases_exempt_base >= 0),
  purchases_out_of_scope_base numeric(20,2) not null default 0 check (purchases_out_of_scope_base >= 0),
  imports_goods_base numeric(20,2) not null default 0 check (imports_goods_base >= 0),
  imports_vat_paid numeric(20,2) not null default 0 check (imports_vat_paid >= 0),
  reverse_charge_base numeric(20,2) not null default 0 check (reverse_charge_base >= 0),
  input_tax_recoverable_percent numeric(5,2) not null default 100 check (input_tax_recoverable_percent between 0 and 100),
  filing_status text not null default 'NOT_FILED' check (filing_status in ('NOT_FILED', 'FILED')),
  filed_at date,
  filing_reference text,
  paid_amount numeric(20,2) not null default 0 check (paid_amount >= 0),
  paid_at date,
  payment_reference text,
  cash_reserved_amount numeric(20,2) not null default 0 check (cash_reserved_amount >= 0),
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vat_period_summary_date_range check (period_start <= period_end),
  constraint vat_period_summary_unique unique (organization_id, period_start, period_end),
  constraint vat_period_summary_filed_date check (filing_status <> 'FILED' or filed_at is not null),
  constraint vat_period_summary_paid_date check (paid_amount = 0 or paid_at is not null)
);

create index if not exists idx_vat_period_summaries_org_period
  on public.vat_period_summaries (organization_id, period_start, period_end);

alter table public.vat_period_summaries enable row level security;
grant select, insert, update on public.vat_period_summaries to authenticated;

drop policy if exists vat_period_summaries_member_read on public.vat_period_summaries;
create policy vat_period_summaries_member_read on public.vat_period_summaries
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists vat_period_summaries_admin_insert on public.vat_period_summaries;
create policy vat_period_summaries_admin_insert on public.vat_period_summaries
  for insert to authenticated
  with check (public.is_organization_admin(organization_id));

drop policy if exists vat_period_summaries_admin_update on public.vat_period_summaries;
create policy vat_period_summaries_admin_update on public.vat_period_summaries
  for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
