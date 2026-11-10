-- Historical documentation only; migration applied once to Yaqeen Financial Core QA V2, not Production.
-- Supabase version 20261109105303: feasibility_independent_access_grants_qa_v2
create table public.feasibility_access_grants (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null check(status in ('TRIAL','ACTIVE','READ_ONLY','SUSPENDED','CANCELLED')),
 starts_at timestamptz not null default now(),
 ends_at timestamptz,
 source text not null default 'QA_MANUAL' check(source in ('QA_MANUAL','PLATFORM_ADMIN','PAID_PLAN','TRIAL')),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 constraint feasibility_access_positive_window check(ends_at is null or ends_at>starts_at)
);
comment on table public.feasibility_access_grants is 'QA V2 independent per-user entitlement for feasibility studies; no organization, financial ledger, or accounting subscription access implied.';
alter table public.feasibility_access_grants enable row level security;
create policy feasibility_access_owner_read on public.feasibility_access_grants for select to authenticated using(user_id=(select auth.uid()));
revoke all on table public.feasibility_access_grants from public,anon,authenticated;
grant select on table public.feasibility_access_grants to authenticated;
