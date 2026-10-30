alter table public.vat_profiles
  add column if not exists registered_name text,
  add column if not exists seller_street text,
  add column if not exists seller_building_number char(4),
  add column if not exists seller_district text,
  add column if not exists seller_additional_number char(4),
  add column if not exists seller_city text,
  add column if not exists seller_postal_code char(5);

alter table public.vat_profiles
  drop constraint if exists vat_profile_seller_building_number_format,
  add constraint vat_profile_seller_building_number_format
    check (seller_building_number is null or seller_building_number ~ '^[0-9]{4}$'),
  drop constraint if exists vat_profile_seller_additional_number_format,
  add constraint vat_profile_seller_additional_number_format
    check (seller_additional_number is null or seller_additional_number ~ '^[0-9]{4}$'),
  drop constraint if exists vat_profile_seller_postal_code_format,
  add constraint vat_profile_seller_postal_code_format
    check (seller_postal_code is null or seller_postal_code ~ '^[0-9]{5}$');

create table if not exists public.vat_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_type text not null check (contact_type in ('CUSTOMER', 'SUPPLIER', 'BOTH')),
  name text not null check (nullif(trim(name), '') is not null),
  vat_number text,
  email text,
  phone text,
  street text,
  building_number char(4),
  district text,
  additional_number char(4),
  city text,
  postal_code char(5),
  country_code char(2) not null default 'SA',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vat_contacts_building_number_format check (building_number is null or building_number ~ '^[0-9]{4}$'),
  constraint vat_contacts_additional_number_format check (additional_number is null or additional_number ~ '^[0-9]{4}$'),
  constraint vat_contacts_postal_code_format check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  constraint vat_contacts_id_organization_unique unique (id, organization_id),
  constraint vat_contacts_org_type_name_unique unique (organization_id, contact_type, name)
);

create index if not exists idx_vat_contacts_org_type_name
  on public.vat_contacts (organization_id, contact_type, name);

alter table public.vat_contacts enable row level security;
grant select, insert, update, delete on public.vat_contacts to authenticated;

drop policy if exists vat_contacts_member_read on public.vat_contacts;
create policy vat_contacts_member_read on public.vat_contacts
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists vat_contacts_admin_insert on public.vat_contacts;
create policy vat_contacts_admin_insert on public.vat_contacts
  for insert to authenticated
  with check (public.is_organization_admin(organization_id));

drop policy if exists vat_contacts_admin_update on public.vat_contacts;
create policy vat_contacts_admin_update on public.vat_contacts
  for update to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists vat_contacts_admin_delete on public.vat_contacts;
create policy vat_contacts_admin_delete on public.vat_contacts
  for delete to authenticated
  using (public.is_organization_admin(organization_id));

alter table public.vat_documents
  add column if not exists counterparty_contact_id uuid;
alter table public.vat_documents
  drop constraint if exists vat_documents_counterparty_contact_org_fk,
  add constraint vat_documents_counterparty_contact_org_fk
    foreign key (counterparty_contact_id, organization_id)
    references public.vat_contacts (id, organization_id)
    on delete set null (counterparty_contact_id);

alter table public.vat_einvoices
  add column if not exists buyer_contact_id uuid;
alter table public.vat_einvoices
  drop constraint if exists vat_einvoices_buyer_contact_org_fk,
  add constraint vat_einvoices_buyer_contact_org_fk
    foreign key (buyer_contact_id, organization_id)
    references public.vat_contacts (id, organization_id)
    on delete set null (buyer_contact_id);
