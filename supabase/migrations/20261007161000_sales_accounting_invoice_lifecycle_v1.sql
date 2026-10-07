-- Accounting sales invoice is the financial source of truth.
create table if not exists public.sales_accounting_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid null references public.organization_entities(id),
  invoice_number text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','PARTIALLY_PAID','PAID','CREDITED','CANCELLED')),
  invoice_date date not null,
  due_date date not null,
  currency text not null,
  exchange_rate numeric not null default 1 check (exchange_rate > 0),
  customer_contact_id uuid null references public.vat_contacts(id),
  customer_name text not null,
  net_amount numeric not null check (net_amount >= 0),
  tax_amount numeric not null check (tax_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  financial_event_id uuid null references public.financial_events(id),
  liquidity_flow_id uuid null references public.liquidity_flows(id),
  zatca_invoice_id uuid null unique references public.vat_einvoices(id),
  source_zatca_invoice_id uuid null unique references public.vat_einvoices(id),
  credited_invoice_id uuid null references public.sales_accounting_invoices(id),
  document_type text not null default 'INVOICE' check (document_type in ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')),
  notes text null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, invoice_number, document_type)
);
create index if not exists sales_accounting_invoices_org_due_idx on public.sales_accounting_invoices(organization_id,due_date);
create index if not exists sales_accounting_invoices_event_idx on public.sales_accounting_invoices(financial_event_id);
alter table public.sales_accounting_invoices enable row level security;
drop policy if exists sales_accounting_invoices_member_read on public.sales_accounting_invoices;
create policy sales_accounting_invoices_member_read on public.sales_accounting_invoices for select to authenticated using (
  exists(select 1 from public.organization_members om where om.organization_id=sales_accounting_invoices.organization_id and om.user_id=auth.uid())
);
drop policy if exists sales_accounting_invoices_admin_write on public.sales_accounting_invoices;
create policy sales_accounting_invoices_admin_write on public.sales_accounting_invoices for all to authenticated using (
  exists(select 1 from public.organization_members om where om.organization_id=sales_accounting_invoices.organization_id and om.user_id=auth.uid() and om.role in ('OWNER','ADMIN'))
) with check (
  exists(select 1 from public.organization_members om where om.organization_id=sales_accounting_invoices.organization_id and om.user_id=auth.uid() and om.role in ('OWNER','ADMIN'))
);
comment on table public.sales_accounting_invoices is 'Financial source of truth for sales invoices; ZATCA documents are compliance projections linked 1:1.';
