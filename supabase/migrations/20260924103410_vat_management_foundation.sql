create table if not exists public.vat_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  tax_registration_number text,
  registration_status text not null default 'NOT_REGISTERED'
    check (registration_status in ('NOT_REGISTERED', 'REGISTERED', 'PENDING', 'DEREGISTERED')),
  registration_date date,
  filing_frequency text not null default 'QUARTERLY'
    check (filing_frequency in ('MONTHLY', 'QUARTERLY')),
  standard_rate numeric(5,2) not null default 15.00
    check (standard_rate >= 0 and standard_rate <= 100),
  period_start_month smallint not null default 1
    check (period_start_month between 1 and 12),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vat_registration_number_required
    check (registration_status <> 'REGISTERED' or nullif(trim(tax_registration_number), '') is not null)
);

create table if not exists public.vat_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  document_type text not null check (document_type in ('SALES', 'PURCHASE')),
  document_kind text not null default 'INVOICE' check (document_kind in ('INVOICE', 'CREDIT_NOTE')),
  document_number text not null,
  transaction_date date not null,
  counterparty_name text not null,
  counterparty_tax_number text,
  supply_type text not null default 'STANDARD'
    check (supply_type in ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE')),
  net_amount numeric(20,2) not null check (net_amount >= 0),
  tax_rate numeric(5,2) not null default 15.00 check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount numeric(20,2) not null check (tax_amount >= 0),
  recoverable_percent numeric(5,2) not null default 100.00
    check (recoverable_percent >= 0 and recoverable_percent <= 100),
  gross_amount numeric(20,2) not null check (gross_amount >= 0),
  currency text not null default 'SAR' references public.currencies(code),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint vat_document_gross_matches_parts check (gross_amount = net_amount + tax_amount),
  constraint vat_purchase_recovery_only check (document_type = 'PURCHASE' or recoverable_percent = 100),
  constraint vat_document_number_scope unique (organization_id, document_type, document_number)
);

create index if not exists idx_vat_documents_org_date
  on public.vat_documents (organization_id, transaction_date desc);

alter table public.vat_profiles enable row level security;
alter table public.vat_documents enable row level security;

grant select, insert, update, delete on public.vat_profiles to authenticated;
grant select, insert, update, delete on public.vat_documents to authenticated;

drop policy if exists vat_profiles_member_read on public.vat_profiles;
create policy vat_profiles_member_read on public.vat_profiles
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists vat_profiles_admin_write on public.vat_profiles;
create policy vat_profiles_admin_insert on public.vat_profiles
  for insert to authenticated
  with check (public.is_organization_admin(organization_id));
create policy vat_profiles_admin_update on public.vat_profiles
  for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
create policy vat_profiles_admin_delete on public.vat_profiles
  for delete to authenticated
  using (public.is_organization_admin(organization_id));

drop policy if exists vat_documents_member_read on public.vat_documents;
create policy vat_documents_member_read on public.vat_documents
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists vat_documents_admin_write on public.vat_documents;
create policy vat_documents_admin_insert on public.vat_documents
  for insert to authenticated
  with check (public.is_organization_admin(organization_id));
create policy vat_documents_admin_update on public.vat_documents
  for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
create policy vat_documents_admin_delete on public.vat_documents
  for delete to authenticated
  using (public.is_organization_admin(organization_id));
