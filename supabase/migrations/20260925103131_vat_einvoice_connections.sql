create table if not exists public.vat_einvoice_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  environment text not null check (environment in ('SIMULATION', 'PRODUCTION')),
  status text not null default 'NOT_CONFIGURED'
    check (status in ('NOT_CONFIGURED', 'KEY_READY', 'COMPLIANCE_PENDING', 'COMPLIANCE_PASSED', 'PRODUCTION_PENDING', 'CONNECTED', 'ERROR')),
  taxpayer_vat_number text not null,
  common_name text not null,
  legal_name text not null,
  branch_name text not null,
  branch_location text not null,
  industry text not null,
  egs_serial_number text not null,
  invoice_type text not null check (invoice_type in ('1000', '0100', '1100')),
  kms_key_arn text,
  credentials_secret_arn text,
  last_error_code text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, environment),
  unique (id, organization_id),
  constraint vat_einvoice_key_ready_requires_key
    check (status not in ('KEY_READY', 'COMPLIANCE_PENDING', 'COMPLIANCE_PASSED', 'PRODUCTION_PENDING', 'CONNECTED') or kms_key_arn is not null)
);

create index if not exists idx_vat_einvoice_connections_org
  on public.vat_einvoice_connections (organization_id);

alter table public.vat_einvoice_connections enable row level security;
grant select on public.vat_einvoice_connections to authenticated;

drop policy if exists vat_einvoice_connections_member_read on public.vat_einvoice_connections;
drop policy if exists vat_einvoice_connections_admin_read on public.vat_einvoice_connections;
create policy vat_einvoice_connections_admin_read on public.vat_einvoice_connections
  for select to authenticated
  using (public.is_organization_admin(organization_id));
