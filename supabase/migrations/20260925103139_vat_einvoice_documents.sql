create table if not exists public.vat_einvoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid,
  invoice_uuid uuid not null default gen_random_uuid(),
  invoice_number text not null,
  document_type text not null default 'INVOICE'
    check (document_type in ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')),
  invoice_category text not null
    check (invoice_category in ('STANDARD', 'SIMPLIFIED')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ISSUED', 'SUBMITTED', 'CLEARED', 'REPORTED', 'REJECTED', 'VOID')),
  issue_date date not null,
  issue_time time not null,
  currency text not null default 'SAR' references public.currencies(code) check (currency = 'SAR'),
  seller_name text not null,
  seller_vat_number text not null,
  seller_address text not null,
  seller_building_number char(4) not null check (seller_building_number ~ '^[0-9]{4}$'),
  seller_district text not null,
  seller_additional_number char(4) not null check (seller_additional_number ~ '^[0-9]{4}$'),
  seller_city text not null,
  seller_postal_code char(5) not null check (seller_postal_code ~ '^[0-9]{5}$'),
  seller_country_code char(2) not null default 'SA',
  buyer_name text,
  buyer_vat_number text,
  buyer_address text,
  buyer_building_number char(4),
  buyer_district text,
  buyer_additional_number char(4),
  buyer_city text,
  buyer_postal_code char(5),
  buyer_country_code char(2),
  payment_means_code text,
  billing_reference text,
  preceding_invoice_id uuid,
  note_reason text,
  line_extension_amount numeric(20,2) not null default 0 check (line_extension_amount >= 0),
  allowance_total_amount numeric(20,2) not null default 0 check (allowance_total_amount >= 0),
  tax_exclusive_amount numeric(20,2) not null default 0 check (tax_exclusive_amount >= 0),
  tax_total_amount numeric(20,2) not null default 0 check (tax_total_amount >= 0),
  tax_inclusive_amount numeric(20,2) not null default 0 check (tax_inclusive_amount >= 0),
  payable_amount numeric(20,2) not null default 0 check (payable_amount >= 0),
  invoice_hash text,
  previous_invoice_hash text,
  xml_document text,
  qr_code text,
  zatca_submission_id text,
  zatca_response jsonb,
  last_error_code text,
  created_by uuid references auth.users(id),
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_uuid),
  unique (organization_id, invoice_number),
  unique (id, organization_id),
  constraint vat_einvoice_connection_org_fk
    foreign key (connection_id, organization_id)
    references public.vat_einvoice_connections(id, organization_id) on delete set null (connection_id),
  constraint vat_einvoice_preceding_invoice_org_fk
    foreign key (preceding_invoice_id, organization_id)
    references public.vat_einvoices(id, organization_id) deferrable initially deferred,
  constraint vat_einvoice_buyer_required_for_standard
    check (invoice_category <> 'STANDARD' or nullif(trim(buyer_name), '') is not null),
  constraint vat_einvoice_seller_sa_address check (
    seller_country_code = 'SA' and seller_building_number ~ '^[0-9]{4}$'
    and seller_additional_number ~ '^[0-9]{4}$' and seller_postal_code ~ '^[0-9]{5}$'
  ),
  constraint vat_einvoice_standard_buyer_sa_address check (
    invoice_category <> 'STANDARD' or (
      nullif(trim(buyer_address), '') is not null and nullif(trim(buyer_district), '') is not null
      and nullif(trim(buyer_city), '') is not null and buyer_postal_code is not null
      and buyer_postal_code ~ '^[0-9]{5}$' and buyer_country_code = 'SA'
      and buyer_building_number is not null and buyer_building_number ~ '^[0-9]{4}$'
    )
  ),
  constraint vat_einvoice_note_requires_reference
    check (document_type = 'INVOICE' or preceding_invoice_id is not null or nullif(trim(billing_reference), '') is not null)
);

create table if not exists public.vat_einvoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.vat_einvoices(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  item_name text not null,
  description text,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_code text not null default 'PCE',
  unit_price numeric(20,6) not null check (unit_price >= 0),
  discount_amount numeric(20,2) not null default 0 check (discount_amount >= 0),
  tax_category text not null default 'S' check (tax_category in ('S', 'Z', 'E', 'O')),
  tax_rate numeric(5,2) not null default 15.00 check (tax_rate >= 0 and tax_rate <= 100),
  tax_exemption_reason_code text,
  tax_exemption_reason text,
  line_extension_amount numeric(20,2) not null check (line_extension_amount >= 0),
  tax_amount numeric(20,2) not null check (tax_amount >= 0),
  gross_amount numeric(20,2) not null check (gross_amount >= 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, line_number),
  constraint vat_einvoice_tax_category_rate check (
    (tax_category = 'S' and tax_rate > 0)
    or (tax_category in ('Z', 'E', 'O') and tax_rate = 0)
  )
);

create index if not exists idx_vat_einvoices_org_date
  on public.vat_einvoices (organization_id, issue_date desc, created_at desc);
create index if not exists idx_vat_einvoices_connection_status
  on public.vat_einvoices (connection_id, status, issue_date);
create index if not exists idx_vat_einvoice_lines_invoice
  on public.vat_einvoice_lines (invoice_id, line_number);

alter table public.vat_einvoices enable row level security;
alter table public.vat_einvoice_lines enable row level security;

grant select, insert, update, delete on public.vat_einvoices to authenticated;
grant select, insert, update, delete on public.vat_einvoice_lines to authenticated;

drop policy if exists vat_einvoices_member_read on public.vat_einvoices;
create policy vat_einvoices_member_read on public.vat_einvoices
  for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists vat_einvoices_admin_write on public.vat_einvoices;
create policy vat_einvoices_admin_insert on public.vat_einvoices
  for insert to authenticated
  with check (public.is_organization_admin(organization_id));
create policy vat_einvoices_admin_update on public.vat_einvoices
  for update to authenticated
  using (public.is_organization_admin(organization_id) and status = 'DRAFT')
  with check (public.is_organization_admin(organization_id) and status = 'DRAFT');
create policy vat_einvoices_admin_delete on public.vat_einvoices
  for delete to authenticated
  using (public.is_organization_admin(organization_id) and status = 'DRAFT');

drop policy if exists vat_einvoice_lines_member_read on public.vat_einvoice_lines;
create policy vat_einvoice_lines_member_read on public.vat_einvoice_lines
  for select to authenticated
  using (exists (
    select 1 from public.vat_einvoices i
    where i.id = invoice_id and public.is_organization_member(i.organization_id)
  ));
drop policy if exists vat_einvoice_lines_admin_write on public.vat_einvoice_lines;
create policy vat_einvoice_lines_admin_insert on public.vat_einvoice_lines
  for insert to authenticated
  with check (exists (
    select 1 from public.vat_einvoices i
    where i.id = invoice_id and i.status = 'DRAFT' and public.is_organization_admin(i.organization_id)
  ));
create policy vat_einvoice_lines_admin_update on public.vat_einvoice_lines
  for update to authenticated
  using (exists (
    select 1 from public.vat_einvoices i
    where i.id = invoice_id and i.status = 'DRAFT' and public.is_organization_admin(i.organization_id)
  ))
  with check (exists (
    select 1 from public.vat_einvoices i
    where i.id = invoice_id and i.status = 'DRAFT' and public.is_organization_admin(i.organization_id)
  ));
create policy vat_einvoice_lines_admin_delete on public.vat_einvoice_lines
  for delete to authenticated
  using (exists (
    select 1 from public.vat_einvoices i
    where i.id = invoice_id and i.status = 'DRAFT' and public.is_organization_admin(i.organization_id)
  ));
