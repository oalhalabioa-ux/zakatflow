-- Disposable source-shaped fixture, NOT the complete Supabase schema or auth model.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
-- Tests set this subject as a server-session stand-in; no JWT verification is claimed.
create table public.organization_members(organization_id uuid,user_id uuid,role text,status text,primary key(organization_id,user_id));
create table public.vat_einvoice_connections(id uuid primary key,organization_id uuid,environment text,status text,taxpayer_vat_number text,egs_serial_number text,invoice_type text,kms_key_arn text default 'QA_KEY_A',credentials_secret_arn text default 'QA_SECRET_A');
create table public.vat_einvoices(
id uuid primary key,
organization_id uuid,
buyer_contact_id uuid,
connection_id uuid,
invoice_uuid uuid,
invoice_number text,
document_type text,
invoice_category text,
issue_date date,
due_date date,
issue_time time,
currency text,
seller_name text,
seller_vat_number text,
seller_address text,
seller_city text,
seller_building_number text,
seller_district text,
seller_additional_number text,
seller_postal_code text,
seller_country_code text,
buyer_name text,
buyer_vat_number text,
buyer_address text,
buyer_city text,
buyer_building_number text,
buyer_district text,
buyer_additional_number text,
buyer_postal_code text,
buyer_country_code text,
payment_means_code text,
billing_reference text,
note_reason text,
status text,
preceding_invoice_id uuid,
exchange_rate numeric(20,6),
line_extension_amount numeric(20,2),
allowance_total_amount numeric(20,2),
tax_exclusive_amount numeric(20,2),
tax_total_amount numeric(20,2),
tax_inclusive_amount numeric(20,2),
payable_amount numeric(20,2),
updated_at timestamptz not null default clock_timestamp());
create table public.vat_einvoice_lines(
id uuid primary key default gen_random_uuid(), invoice_id uuid references public.vat_einvoices(id), line_number integer,
item_name text, description text, quantity numeric(18,6), unit_code text, unit_price numeric(20,6), discount_amount numeric(20,2),
tax_category text,tax_rate numeric(5,2),tax_exemption_reason_code text,tax_exemption_reason text,
line_extension_amount numeric(20,2),tax_amount numeric(20,2),gross_amount numeric(20,2));

-- Minimal permission fixture only; actual policy/RPC checks run separately on QA.
create function public.has_organization_permission(p_org uuid,p_permission text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
select exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  and role in ('OWNER','ADMIN') and status='ACTIVE')
$$;
