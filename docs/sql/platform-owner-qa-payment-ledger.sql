-- Dedicated Platform Admin QA only: weucywfwbdnomtlkjurl
-- Read-only financial ledger schema; provider ingestion and reconciliation are deliberately NOT enabled.
create table if not exists public.platform_payment_transactions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.platform_organizations(id) on delete restrict,
 subscription_id uuid references public.platform_subscriptions(id) on delete restrict,
 provider text not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
 provider_transaction_id text not null check(length(provider_transaction_id) between 1 and 180),
 event_kind text not null check(event_kind in ('payment','refund')),
 status text not null check(status in ('pending','succeeded','failed')),
 amount numeric(18,2) not null check(amount>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 unique(provider,provider_transaction_id)
);
create index if not exists platform_payment_transactions_org_time_idx on public.platform_payment_transactions(organization_id,occurred_at desc);
create index if not exists platform_payment_transactions_subscription_idx on public.platform_payment_transactions(subscription_id);
alter table public.platform_payment_transactions enable row level security;
revoke all on public.platform_payment_transactions from public,anon,authenticated;
create or replace function public.owner_list_payment_transactions(p_limit integer default 100)
returns table(id uuid,organization_name text,provider text,provider_transaction_id text,event_kind text,status text,amount numeric,currency text,occurred_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select t.id,o.name,t.provider,t.provider_transaction_id,t.event_kind,t.status,t.amount,t.currency,t.occurred_at
 from public.platform_payment_transactions t join public.platform_organizations o on o.id=t.organization_id
 order by t.occurred_at desc,t.id desc limit least(greatest(coalesce(p_limit,100),1),200);
end $$;
revoke all on function public.owner_list_payment_transactions(integer) from public,anon;
grant execute on function public.owner_list_payment_transactions(integer) to authenticated;
