create table if not exists public.zakat_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid not null references public.zakat_payments(id) on delete cascade,
  assessment_id uuid not null references public.zakat_assessments(id) on delete cascade,
  assessment_line_id uuid not null references public.zakat_assessment_lines(id) on delete cascade,
  lot_id uuid references public.lots(id) on delete set null,
  asset_account_id uuid references public.asset_accounts(id) on delete set null,
  allocated_amount numeric(20,6) not null check (allocated_amount > 0),
  due_date date,
  created_at timestamptz not null default now(),
  unique(payment_id, assessment_line_id)
);
create index if not exists idx_zpa_user on public.zakat_payment_allocations(user_id);
create index if not exists idx_zpa_payment on public.zakat_payment_allocations(payment_id);
create index if not exists idx_zpa_line on public.zakat_payment_allocations(assessment_line_id);
create index if not exists idx_zpa_asset on public.zakat_payment_allocations(asset_account_id);
alter table public.zakat_payment_allocations enable row level security;
drop policy if exists zpa_select_own on public.zakat_payment_allocations;
create policy zpa_select_own on public.zakat_payment_allocations for select using (auth.uid() = user_id);
drop policy if exists zpa_insert_own on public.zakat_payment_allocations;
create policy zpa_insert_own on public.zakat_payment_allocations for insert with check (auth.uid() = user_id);
drop policy if exists zpa_update_own on public.zakat_payment_allocations;
create policy zpa_update_own on public.zakat_payment_allocations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists zpa_delete_own on public.zakat_payment_allocations;
create policy zpa_delete_own on public.zakat_payment_allocations for delete using (auth.uid() = user_id);