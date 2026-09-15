create extension if not exists pgcrypto;

do $$ begin create type asset_type as enum ('CASH','BANK','GOLD','SILVER','STOCK','INVENTORY','RECEIVABLE','REAL_ESTATE','OTHER'); exception when duplicate_object then null; end $$;
do $$ begin create type account_status as enum ('ACTIVE','ARCHIVED'); exception when duplicate_object then null; end $$;
do $$ begin create type transaction_type as enum ('OPENING_BALANCE','ADD','PURCHASE','SALE','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN','ZAKAT_PAYMENT','ADJUSTMENT','REVERSAL'); exception when duplicate_object then null; end $$;
do $$ begin create type lot_status as enum ('ACTIVE','PARTIALLY_USED','HAWL_COMPLETED','ZAKAT_DUE','CLOSED'); exception when duplicate_object then null; end $$;
do $$ begin create type allocation_method as enum ('FIFO','MANUAL','PROPORTIONAL','RULE_BASED'); exception when duplicate_object then null; end $$;
do $$ begin create type assessment_status as enum ('DRAFT','CALCULATED','CONFIRMED','PARTIALLY_PAID','PAID','CANCELLED'); exception when duplicate_object then null; end $$;
do $$ begin create type eligibility_status as enum ('ELIGIBLE','NOT_ELIGIBLE','HAWL_NOT_COMPLETED','BELOW_NISAB','EXEMPT'); exception when duplicate_object then null; end $$;

create table if not exists zakat_methods(id uuid primary key default gen_random_uuid(), code text unique not null, name_ar text not null, name_en text not null, description_ar text, description_en text, calendar_type text not null default 'HIJRI', zakat_rate numeric(12,8) not null default 0.025, active boolean not null default true, version text not null default '1.0');

-- Application profile linked to Supabase Auth. auth.users remains the identity source of truth.
create table if not exists profiles(id uuid primary key references auth.users(id) on delete cascade, name text not null default '', phone text, base_currency text not null default 'SAR', calendar_type text not null default 'HIJRI', zakat_method_id uuid references zakat_methods(id), nisab_standard text not null default 'SILVER', timezone text not null default 'Asia/Riyadh', locale text not null default 'ar', role text not null default 'INDIVIDUAL', created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists currencies(code text primary key, name_ar text not null, name_en text not null, symbol text, decimals smallint not null default 2, active boolean not null default true);
create table if not exists user_settings(user_id uuid primary key references profiles(id) on delete cascade, allocation_method allocation_method not null default 'FIFO', notifications_enabled boolean not null default true, assessment_reminders boolean not null default true, theme text not null default 'system', updated_at timestamptz not null default now());

create table if not exists asset_accounts(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, asset_type asset_type not null, name text not null, currency text not null references currencies(code), unit text not null default 'unit', is_zakatable boolean not null default true, status account_status not null default 'ACTIVE', metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists transactions(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, asset_account_id uuid not null references asset_accounts(id), transaction_type transaction_type not null, transaction_date date not null, quantity numeric(24,8) not null default 0 check(quantity >= 0), unit_price numeric(24,8), currency text not null references currencies(code), gross_value numeric(24,8) not null default 0 check(gross_value >= 0), base_currency text not null references currencies(code), base_value numeric(24,8) not null default 0 check(base_value >= 0), reference text, notes text, transfer_id uuid, reversal_of_transaction_id uuid references transactions(id), metadata jsonb not null default '{}', created_at timestamptz not null default now(), created_by uuid references profiles(id));
create table if not exists lots(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, asset_account_id uuid not null references asset_accounts(id), source_transaction_id uuid not null references transactions(id), acquisition_date date not null, hawl_start_date date not null, hawl_due_date date not null, original_quantity numeric(24,8) not null check(original_quantity >= 0), remaining_quantity numeric(24,8) not null check(remaining_quantity >= 0), original_value_base numeric(24,8) not null default 0, remaining_value_base numeric(24,8) not null default 0, status lot_status not null default 'ACTIVE', metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists transaction_allocations(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, transaction_id uuid not null references transactions(id), lot_id uuid not null references lots(id), quantity numeric(24,8) not null check(quantity > 0), value_base numeric(24,8) not null default 0, allocation_method allocation_method not null, created_at timestamptz not null default now(), unique(transaction_id,lot_id));
create table if not exists transfers(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, transfer_date date not null, source_transaction_id uuid not null references transactions(id), destination_transaction_id uuid not null references transactions(id), source_asset_account_id uuid not null references asset_accounts(id), destination_asset_account_id uuid not null references asset_accounts(id), quantity numeric(24,8) not null, source_value numeric(24,8) not null, destination_value numeric(24,8) not null, currency text not null references currencies(code), linked_lot_id uuid references lots(id), notes text);
create table if not exists market_prices(id uuid primary key default gen_random_uuid(), asset_type asset_type not null, instrument_code text, karat numeric(5,2), price_per_unit numeric(24,8) not null, currency text not null references currencies(code), valuation_date date not null, source text not null, created_at timestamptz not null default now());
create table if not exists fx_rates(id uuid primary key default gen_random_uuid(), from_currency text not null references currencies(code), to_currency text not null references currencies(code), rate numeric(24,12) not null, valuation_date date not null, source text not null, created_at timestamptz not null default now(), unique(from_currency,to_currency,valuation_date,source));
create table if not exists zakat_rules(id uuid primary key default gen_random_uuid(), method_id uuid not null references zakat_methods(id), asset_type asset_type, rule_code text not null, rule_value numeric(24,8), rule_json jsonb not null default '{}', effective_from date not null, effective_to date, review_status text not null default 'PENDING', review_notes text);
create table if not exists zakat_assessments(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, assessment_date date not null, valuation_date date not null, method_id uuid not null references zakat_methods(id), nisab_standard text not null, nisab_quantity numeric(24,8) not null, nisab_value_base numeric(24,8) not null, total_zakatable_value numeric(24,8) not null default 0, zakat_rate numeric(12,8) not null, zakat_due numeric(24,8) not null default 0, currency text not null references currencies(code), status assessment_status not null default 'DRAFT', method_version text, calculation_snapshot jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists zakat_assessment_lines(id uuid primary key default gen_random_uuid(), assessment_id uuid not null references zakat_assessments(id) on delete cascade, lot_id uuid references lots(id), quantity numeric(24,8) not null default 0, valuation_price numeric(24,8), valuation_currency text, fx_rate numeric(24,12), market_value numeric(24,8) not null default 0, eligible_value numeric(24,8) not null default 0, zakat_amount numeric(24,8) not null default 0, eligibility_status eligibility_status not null, reason_code text, explanation text not null);
create table if not exists zakat_payments(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, assessment_id uuid not null references zakat_assessments(id), payment_date date not null, amount numeric(24,8) not null check(amount > 0), currency text not null references currencies(code), base_amount numeric(24,8) not null, beneficiary text, reference text, notes text, attachment_url text, created_at timestamptz not null default now());
create table if not exists notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, type text not null, title text not null, body text not null, scheduled_for timestamptz, sent_at timestamptz, read_at timestamptz, metadata jsonb not null default '{}');
create table if not exists audit_logs(id uuid primary key default gen_random_uuid(), user_id uuid, entity_type text not null, entity_id uuid, action text not null, old_data jsonb, new_data jsonb, created_at timestamptz not null default now(), ip_address inet);

insert into currencies(code,name_ar,name_en,symbol,decimals) values
('SAR','ريال سعودي','Saudi Riyal','﷼',2),('USD','دولار أمريكي','US Dollar','$',2),('EUR','يورو','Euro','€',2),('GBP','جنيه إسترليني','British Pound','£',2),('AED','درهم إماراتي','UAE Dirham','د.إ',2),('KWD','دينار كويتي','Kuwaiti Dinar','د.ك',3),('QAR','ريال قطري','Qatari Riyal','ر.ق',2),('EGP','جنيه مصري','Egyptian Pound','ج.م',2),('TRY','ليرة تركية','Turkish Lira','₺',2),('SYP','ليرة سورية','Syrian Pound','ل.س',2)
on conflict(code) do nothing;

create index if not exists idx_assets_user on asset_accounts(user_id);
create index if not exists idx_tx_user_date on transactions(user_id,transaction_date);
create index if not exists idx_lots_user_account on lots(user_id,asset_account_id);
create index if not exists idx_assess_user_date on zakat_assessments(user_id,assessment_date);
create index if not exists idx_prices_date on market_prices(asset_type,valuation_date);
create index if not exists idx_fx_date on fx_rates(from_currency,to_currency,valuation_date);

-- RLS: users can only access their own application data. Public reference tables remain readable.
alter table profiles enable row level security; alter table user_settings enable row level security; alter table asset_accounts enable row level security; alter table transactions enable row level security; alter table lots enable row level security; alter table transaction_allocations enable row level security; alter table transfers enable row level security; alter table zakat_assessments enable row level security; alter table zakat_assessment_lines enable row level security; alter table zakat_payments enable row level security; alter table notifications enable row level security; alter table audit_logs enable row level security;

create policy profiles_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy settings_self on user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assets_self on asset_accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy transactions_self on transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy lots_self on lots for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy allocations_self on transaction_allocations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy transfers_self on transfers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assessments_self on zakat_assessments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assessment_lines_self on zakat_assessment_lines for all using (exists(select 1 from zakat_assessments a where a.id=assessment_id and a.user_id=auth.uid())) with check (exists(select 1 from zakat_assessments a where a.id=assessment_id and a.user_id=auth.uid()));
create policy payments_self on zakat_payments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_self on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_self on audit_logs for select using (user_id = auth.uid());
create policy methods_read on zakat_methods for select using (active=true);
create policy currencies_read on currencies for select using (active=true);
create policy prices_read on market_prices for select using (true);
create policy fx_read on fx_rates for select using (true);
create policy rules_read on zakat_rules for select using (review_status='APPROVED');

-- Atomic internal transfer: paired ledger entries, never counted as new wealth.
create or replace function create_internal_transfer(p_user_id uuid,p_source_account uuid,p_destination_account uuid,p_date date,p_quantity numeric,p_value numeric,p_currency text,p_notes text default null)
returns uuid language plpgsql security invoker as $$
declare v_transfer uuid; v_out uuid; v_in uuid;
begin
  if not exists(select 1 from asset_accounts where id=p_source_account and user_id=p_user_id) then raise exception 'SOURCE_ACCOUNT_NOT_FOUND'; end if;
  if not exists(select 1 from asset_accounts where id=p_destination_account and user_id=p_user_id) then raise exception 'DESTINATION_ACCOUNT_NOT_FOUND'; end if;
  v_transfer:=gen_random_uuid(); v_out:=gen_random_uuid(); v_in:=gen_random_uuid();
  insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,notes,created_by) values(v_out,p_user_id,p_source_account,'TRANSFER_OUT',p_date,p_quantity,p_currency,p_value,p_currency,p_value,v_transfer,p_notes,p_user_id);
  insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,notes,created_by) values(v_in,p_user_id,p_destination_account,'TRANSFER_IN',p_date,p_quantity,p_currency,p_value,p_currency,p_value,v_transfer,p_notes,p_user_id);
  insert into transfers(id,user_id,transfer_date,source_transaction_id,destination_transaction_id,source_asset_account_id,destination_asset_account_id,quantity,source_value,destination_value,currency,notes) values(v_transfer,p_user_id,p_date,v_out,v_in,p_source_account,p_destination_account,p_quantity,p_value,p_value,p_currency,p_notes);
  return v_transfer;
end; $$;
