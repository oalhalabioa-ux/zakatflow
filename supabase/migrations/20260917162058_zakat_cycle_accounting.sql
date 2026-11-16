alter table public.zakat_hawl_cycles add column if not exists closed_at timestamptz, add column if not exists final_assessment_id uuid references public.zakat_assessments(id) on delete set null, add column if not exists final_zakat_due numeric(20,8), add column if not exists notes text;
alter table public.zakat_assessments add column if not exists hawl_cycle_id uuid references public.zakat_hawl_cycles(id) on delete set null, add column if not exists assessment_kind text not null default 'RECALCULATION', add column if not exists superseded_by uuid references public.zakat_assessments(id) on delete set null;
alter table public.zakat_payments add column if not exists hawl_cycle_id uuid references public.zakat_hawl_cycles(id) on delete set null;
alter table public.zakat_payment_allocations add column if not exists hawl_cycle_id uuid references public.zakat_hawl_cycles(id) on delete set null;
create index if not exists idx_assessments_hawl_cycle on public.zakat_assessments(user_id,hawl_cycle_id,assessment_date desc);
create index if not exists idx_payments_hawl_cycle on public.zakat_payments(user_id,hawl_cycle_id,payment_date desc);
create index if not exists idx_allocations_hawl_cycle on public.zakat_payment_allocations(user_id,hawl_cycle_id);
create unique index if not exists uq_one_open_zakat_cycle_per_user on public.zakat_hawl_cycles(user_id) where status in ('OPEN','ACTIVE');