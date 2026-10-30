alter table public.lots alter column hawl_start_date drop not null;
alter table public.lots alter column hawl_due_date drop not null;
alter table public.lots add column if not exists nisab_reached_date date;
alter table public.lots add column if not exists hawl_cycle integer not null default 0 check (hawl_cycle >= 0);
alter table public.lots add column if not exists hawl_basis text not null default 'NISAB_POOL' check (hawl_basis in ('NISAB_POOL','ACQUISITION_DATE','MANUAL'));

alter table public.user_settings add column if not exists price_mode text not null default 'MANUAL' check (price_mode in ('MANUAL','REFERENCE'));
alter table public.user_settings add column if not exists price_source text;
alter table public.user_settings add column if not exists hawl_nisab_policy text not null default 'CONTINUOUS' check (hawl_nisab_policy in ('CONTINUOUS','START_END'));

create table if not exists public.zakat_hawl_cycles (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 cycle_no integer not null check (cycle_no > 0),
 nisab_standard text not null,
 nisab_value_base numeric not null default 0,
 nisab_reached_date date not null,
 hawl_start_date date not null,
 hawl_due_date date not null,
 assessment_id uuid references public.zakat_assessments(id) on delete set null,
 valuation_date date,
 price_mode text not null default 'MANUAL' check (price_mode in ('MANUAL','REFERENCE')),
 price_source text,
 gold_price numeric,
 silver_price numeric,
 status text not null default 'RUNNING' check (status in ('RUNNING','DUE','ASSESSED','PAID','RESET')),
 snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(user_id,cycle_no)
);
alter table public.zakat_hawl_cycles enable row level security;
drop policy if exists "hawl_cycles_select_own" on public.zakat_hawl_cycles;
create policy "hawl_cycles_select_own" on public.zakat_hawl_cycles for select using (auth.uid()=user_id);
drop policy if exists "hawl_cycles_insert_own" on public.zakat_hawl_cycles;
create policy "hawl_cycles_insert_own" on public.zakat_hawl_cycles for insert with check (auth.uid()=user_id);
drop policy if exists "hawl_cycles_update_own" on public.zakat_hawl_cycles;
create policy "hawl_cycles_update_own" on public.zakat_hawl_cycles for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "hawl_cycles_delete_own" on public.zakat_hawl_cycles;
create policy "hawl_cycles_delete_own" on public.zakat_hawl_cycles for delete using (auth.uid()=user_id);
create index if not exists zakat_hawl_cycles_user_due_idx on public.zakat_hawl_cycles(user_id,hawl_due_date desc);