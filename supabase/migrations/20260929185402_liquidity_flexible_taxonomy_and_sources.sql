create table if not exists public.liquidity_flow_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name_ar text not null check (nullif(trim(name_ar), '') is not null),
  name_en text not null check (nullif(trim(name_en), '') is not null),
  flow_group text not null check (flow_group in ('OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','OTHER')),
  allowed_direction text not null default 'BOTH' check (allowed_direction in ('INFLOW','OUTFLOW','BOTH')),
  active boolean not null default true,
  is_system boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table if not exists public.liquidity_party_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null default ('CUSTOM_' || replace(gen_random_uuid()::text, '-', '')),
  name_ar text not null check (nullif(trim(name_ar), '') is not null),
  name_en text not null check (nullif(trim(name_en), '') is not null),
  is_system boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

insert into public.liquidity_flow_categories (organization_id, code, name_ar, name_en, flow_group, allowed_direction, is_system)
select o.id, d.code, d.name_ar, d.name_en, d.flow_group, d.allowed_direction, true
from public.organizations o
cross join (values
  ('OPERATING','تشغيلي','Operating','OPERATING','BOTH'),
  ('PAYROLL','رواتب وأجور','Payroll & wages','PAYROLL','OUTFLOW'),
  ('TAX','ضرائب ورسوم','Taxes & fees','TAX','BOTH'),
  ('FINANCING','تمويل وقروض','Financing & loans','FINANCING','BOTH'),
  ('INVESTMENT','استثمار وأصول','Investment & assets','INVESTMENT','BOTH'),
  ('OTHER','أخرى','Other','OTHER','BOTH')
) as d(code,name_ar,name_en,flow_group,allowed_direction)
on conflict (organization_id, code) do nothing;

insert into public.liquidity_party_types (organization_id, code, name_ar, name_en, is_system)
select o.id, d.code, d.name_ar, d.name_en, true
from public.organizations o
cross join (values
  ('CUSTOMER','عميل','Customer'),
  ('SUPPLIER','مورد','Supplier'),
  ('BOTH','عميل ومورد','Customer & supplier'),
  ('PERSON','فرد','Individual'),
  ('EMPLOYEE','موظف','Employee'),
  ('OTHER','أخرى','Other')
) as d(code,name_ar,name_en)
on conflict (organization_id, code) do nothing;

alter table public.liquidity_flows add column if not exists category_id uuid;
alter table public.liquidity_flows add column if not exists source_module text;
alter table public.liquidity_flows add column if not exists source_record_id uuid;
alter table public.liquidity_flows add column if not exists source_event_key text;
alter table public.liquidity_flows add column if not exists budget_line_id uuid references public.budget_lines(id) on delete set null;
alter table public.liquidity_flows add column if not exists settled_amount numeric(24,4) not null default 0 check (settled_amount >= 0);
alter table public.liquidity_flows add column if not exists settlement_status text not null default 'UNSETTLED' check (settlement_status in ('UNSETTLED','PARTIAL','SETTLED'));

update public.liquidity_flows
set settled_amount = amount, settlement_status = 'SETTLED'
where status = 'ACTUAL' and settled_amount = 0;

alter table public.liquidity_counterparties add column if not exists party_type_id uuid;

alter table public.liquidity_flows drop constraint if exists liquidity_flows_category_org_fkey;
alter table public.liquidity_flows add constraint liquidity_flows_category_org_fkey
  foreign key (category_id, organization_id)
  references public.liquidity_flow_categories(id, organization_id)
  on delete set null (category_id);

alter table public.liquidity_counterparties drop constraint if exists liquidity_counterparties_type_org_fkey;
alter table public.liquidity_counterparties add constraint liquidity_counterparties_type_org_fkey
  foreign key (party_type_id, organization_id)
  references public.liquidity_party_types(id, organization_id)
  on delete set null (party_type_id);

update public.liquidity_flows f
set category_id = c.id
from public.liquidity_flow_categories c
where f.category_id is null and c.organization_id = f.organization_id and c.code = f.flow_type;

update public.liquidity_counterparties p
set party_type_id = t.id
from public.liquidity_party_types t
where p.party_type_id is null and t.organization_id = p.organization_id and t.code = p.party_type;

create index if not exists liquidity_flow_categories_org_active_idx on public.liquidity_flow_categories(organization_id, active, name_ar);
create index if not exists liquidity_party_types_org_active_idx on public.liquidity_party_types(organization_id, active, name_ar);
create index if not exists liquidity_flows_category_idx on public.liquidity_flows(category_id) where category_id is not null;
create index if not exists liquidity_flows_source_record_idx on public.liquidity_flows(organization_id, source_module, source_record_id) where source_module is not null;
create unique index if not exists liquidity_flows_source_event_unique on public.liquidity_flows(organization_id, source_module, source_event_key) where source_event_key is not null;

alter table public.liquidity_flow_categories enable row level security;
alter table public.liquidity_party_types enable row level security;

drop policy if exists liquidity_flow_categories_read on public.liquidity_flow_categories;
create policy liquidity_flow_categories_read on public.liquidity_flow_categories for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists liquidity_flow_categories_insert on public.liquidity_flow_categories;
create policy liquidity_flow_categories_insert on public.liquidity_flow_categories for insert to authenticated
  with check (private.can_write_liquidity(organization_id) and created_by = (select auth.uid()));
drop policy if exists liquidity_flow_categories_update on public.liquidity_flow_categories;
create policy liquidity_flow_categories_update on public.liquidity_flow_categories for update to authenticated
  using (private.can_write_liquidity(organization_id) and not is_system)
  with check (private.can_write_liquidity(organization_id) and not is_system);
drop policy if exists liquidity_flow_categories_delete on public.liquidity_flow_categories;
create policy liquidity_flow_categories_delete on public.liquidity_flow_categories for delete to authenticated
  using (private.can_write_liquidity(organization_id) and not is_system);

drop policy if exists liquidity_party_types_read on public.liquidity_party_types;
create policy liquidity_party_types_read on public.liquidity_party_types for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists liquidity_party_types_insert on public.liquidity_party_types;
create policy liquidity_party_types_insert on public.liquidity_party_types for insert to authenticated
  with check (private.can_write_liquidity(organization_id) and created_by = (select auth.uid()));
drop policy if exists liquidity_party_types_update on public.liquidity_party_types;
create policy liquidity_party_types_update on public.liquidity_party_types for update to authenticated
  using (private.can_write_liquidity(organization_id) and not is_system)
  with check (private.can_write_liquidity(organization_id) and not is_system);
drop policy if exists liquidity_party_types_delete on public.liquidity_party_types;
create policy liquidity_party_types_delete on public.liquidity_party_types for delete to authenticated
  using (private.can_write_liquidity(organization_id) and not is_system);

grant select, delete on public.liquidity_flow_categories, public.liquidity_party_types to authenticated;
revoke insert, update on public.liquidity_flow_categories, public.liquidity_party_types from authenticated;
grant insert (organization_id, code, name_ar, name_en, flow_group, allowed_direction, active)
  on public.liquidity_flow_categories to authenticated;
grant update (name_ar, name_en, flow_group, allowed_direction, active, updated_at)
  on public.liquidity_flow_categories to authenticated;
grant insert (organization_id, code, name_ar, name_en, active)
  on public.liquidity_party_types to authenticated;
grant update (name_ar, name_en, active)
  on public.liquidity_party_types to authenticated;

revoke insert, update on public.liquidity_flows from authenticated;
grant insert (organization_id, entity_id, account_id, direction, flow_type, category_id, title, counterparty, counterparty_id, due_date, amount, currency, base_amount, status, source, reference, notes)
  on public.liquidity_flows to authenticated;
grant update (entity_id, account_id, direction, flow_type, category_id, title, counterparty, counterparty_id, due_date, amount, currency, base_amount, status, source, reference, notes, updated_at)
  on public.liquidity_flows to authenticated;

revoke insert, update on public.liquidity_counterparties from authenticated;
grant insert (organization_id, name, party_type, party_type_id, contact_name, phone, email, notes, active)
  on public.liquidity_counterparties to authenticated;
grant update (name, party_type, party_type_id, contact_name, phone, email, notes, active, updated_at)
  on public.liquidity_counterparties to authenticated;

comment on column public.liquidity_flows.source_module is 'Source module for an automatically linked schedule (VAT, invoice, payroll, asset, budget).';
comment on column public.liquidity_flows.source_record_id is 'Source record UUID. Unique event keys prevent duplicate schedule or settlement events.';
