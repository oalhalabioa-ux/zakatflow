create table if not exists public.zakat_lot_hawl_snapshots (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 lot_id uuid not null references public.lots(id),
 hawl_cycle integer not null check (hawl_cycle >= 1),
 hawl_start_date date not null,
 hawl_due_date date not null,
 valuation_date date not null,
 quantity numeric not null default 0,
 purity_factor numeric not null default 1,
 market_price numeric not null default 0,
 price_currency text not null references public.currencies(code),
 price_source text,
 fx_rate numeric not null default 1,
 market_value_base numeric not null default 0,
 nisab_value_base numeric not null default 0,
 zakat_rate numeric not null default 0.025,
 zakat_due numeric not null default 0,
 assessment_id uuid references public.zakat_assessments(id),
 snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(lot_id, hawl_cycle)
);
alter table public.zakat_lot_hawl_snapshots enable row level security;
drop policy if exists lot_hawl_snapshots_self on public.zakat_lot_hawl_snapshots;
create policy lot_hawl_snapshots_self on public.zakat_lot_hawl_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_lot_hawl_snapshots_user_due on public.zakat_lot_hawl_snapshots(user_id, hawl_due_date);
alter table public.lots add column if not exists origin_hawl_start_date date;
alter table public.lots add column if not exists hawl_continuity_source_lot_id uuid references public.lots(id);
alter table public.lots add column if not exists zakatable_pool_entered_date date;
alter table public.user_settings add column if not exists new_funds_hawl_policy text not null default 'INDEPENDENT_AFTER_NISAB' check (new_funds_hawl_policy in ('INDEPENDENT_AFTER_NISAB','JOIN_EXISTING_POOL'));
alter table public.user_settings add column if not exists zakatable_conversion_continuity boolean not null default true;
alter table public.user_settings add column if not exists non_zakatable_conversion_exits_pool boolean not null default true;
