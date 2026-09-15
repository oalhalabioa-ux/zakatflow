-- ZakatFlow V7 commercial layer
create table if not exists subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 plan_code text not null default 'FREE' check (plan_code in ('FREE','FAMILY','PROFESSIONAL','BUSINESS','ENTERPRISE')),
 status text not null default 'ACTIVE' check (status in ('TRIALING','ACTIVE','PAST_DUE','CANCELLED')),
 provider text, provider_customer_id text, provider_subscription_id text,
 current_period_start timestamptz, current_period_end timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), unique(user_id)
);
create table if not exists billing_events (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 provider text, event_type text not null, provider_event_id text, payload jsonb not null default '{}', created_at timestamptz default now(), unique(provider,provider_event_id)
);
alter table subscriptions enable row level security;
alter table billing_events enable row level security;
drop policy if exists subscriptions_owner on subscriptions;
create policy subscriptions_owner on subscriptions for select using (auth.uid()=user_id);
drop policy if exists billing_events_owner on billing_events;
create policy billing_events_owner on billing_events for select using (auth.uid()=user_id);
insert into subscriptions(user_id,plan_code,status) select id,'FREE','ACTIVE' from profiles on conflict(user_id) do nothing;
