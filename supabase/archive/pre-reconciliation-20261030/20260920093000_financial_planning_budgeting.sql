create table if not exists public.budget_plans (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null,
 fiscal_year integer not null check (fiscal_year between 2000 and 2200),
 currency text not null default 'SAR' references public.currencies(code),
 scenario text not null default 'BASE' check (scenario in ('BASE','DOWNSIDE','UPSIDE')),
 status text not null default 'DRAFT' check (status in ('DRAFT','IN_REVIEW','APPROVED','ARCHIVED')),
 organization_name text not null default '',
 cost_center text not null default 'ALL',
 opening_cash numeric not null default 0,
 minimum_cash_target numeric not null default 0 check (minimum_cash_target >= 0),
 assumptions jsonb not null default '{}'::jsonb,
 notes text not null default '',
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,fiscal_year,scenario,organization_name,cost_center)
);
create table if not exists public.budget_lines (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.budget_plans(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 category text not null check (category in ('REVENUE','COGS','OPEX','CAPEX','FINANCING','ZAKAT')),
 name text not null,
 line_type text not null check (line_type in ('REVENUE','EXPENSE','CASH')),
 sort_order integer not null default 0,
 monthly_budget numeric[] not null default array_fill(0::numeric,array[12]),
 monthly_actual numeric[] not null default array_fill(0::numeric,array[12]),
 monthly_forecast numeric[] not null default array_fill(0::numeric,array[12]),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (array_length(monthly_budget,1)=12),
 check (array_length(monthly_actual,1)=12),
 check (array_length(monthly_forecast,1)=12)
);
create table if not exists public.budget_approval_events (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.budget_plans(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 action text not null check (action in ('DRAFT','IN_REVIEW','APPROVED','REJECTED','REOPENED')),
 actor_id uuid not null references public.profiles(id),
 notes text,
 created_at timestamptz not null default now()
);
alter table public.budget_plans enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_approval_events enable row level security;
drop policy if exists budget_plans_self on public.budget_plans;
create policy budget_plans_self on public.budget_plans for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists budget_lines_self on public.budget_lines;
create policy budget_lines_self on public.budget_lines for all to authenticated
 using ((select auth.uid())=user_id and exists(select 1 from public.budget_plans p where p.id=plan_id and p.user_id=(select auth.uid())))
 with check ((select auth.uid())=user_id and exists(select 1 from public.budget_plans p where p.id=plan_id and p.user_id=(select auth.uid())));
drop policy if exists budget_approval_events_self on public.budget_approval_events;
create policy budget_approval_events_self on public.budget_approval_events for all to authenticated
 using ((select auth.uid())=user_id and exists(select 1 from public.budget_plans p where p.id=plan_id and p.user_id=(select auth.uid())))
 with check ((select auth.uid())=user_id and actor_id=(select auth.uid()));
create index if not exists idx_budget_plans_user_year on public.budget_plans(user_id,fiscal_year desc);
create index if not exists idx_budget_lines_plan_sort on public.budget_lines(plan_id,sort_order);
create index if not exists idx_budget_events_plan_date on public.budget_approval_events(plan_id,created_at desc);
grant select,insert,update,delete on public.budget_plans,public.budget_lines,public.budget_approval_events to authenticated;
