-- REVIEW ONLY. No remote execution is authorized.
-- Standalone transactional bundle; NOT in supabase/migrations.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $pre$
declare item record;
begin
 if current_setting('yaqeen.platform_owner_ddl_approval',true) is distinct from 'APPROVED_PLATFORM_OWNER_SCHEMA' then raise exception 'independent schema approval required'; end if;
 if to_regclass('auth.users') is null or to_regclass('auth.sessions') is null
 or to_regclass('public.organizations') is null or to_regclass('public.organization_members') is null
 or to_regclass('public.subscriptions') is null then raise exception 'required Production source relations missing'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'owner_%')
 then raise exception 'owner function name collision: manual review required'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in
 ('platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events'))
 then raise exception 'platform relation collision: refuse overwrite'; end if;
 for item in select * from (values
 ('auth.users','id','uuid'),('auth.users','email','character varying'),('auth.users','email_confirmed_at','timestamp with time zone'),
 ('auth.users','created_at','timestamp with time zone'),('auth.users','last_sign_in_at','timestamp with time zone'),
 ('auth.users','deleted_at','timestamp with time zone'),('auth.users','banned_until','timestamp with time zone'),
 ('auth.sessions','id','uuid'),('auth.sessions','user_id','uuid'),('auth.sessions','not_after','timestamp with time zone'),
 ('public.organizations','id','uuid'),('public.organizations','owner_user_id','uuid'),('public.organizations','name','text'),
 ('public.organizations','legal_name','text'),('public.organizations','base_currency','text'),('public.organizations','entity_type','text'),
 ('public.organizations','status','text'),('public.organizations','created_at','timestamp with time zone'),
 ('public.organization_members','organization_id','uuid'),('public.organization_members','status','text')) expected(relation,column_name,column_type)
 loop
 if not exists(select 1 from pg_attribute where attrelid=to_regclass(item.relation) and attname=item.column_name and not attisdropped and format_type(atttypid,atttypmod)=item.column_type)
 then raise exception 'source column drift: %.%',item.relation,item.column_name; end if;
 end loop;
 if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then raise exception 'Supabase auth helpers missing'; end if;
end $pre$;
-- Compatible with the earlier repository migration, but never adopt a populated or foreign table.
create table if not exists public.platform_admins(
 user_id uuid primary key references auth.users(id) on delete restrict,
 role text not null check(role='platform_owner'), created_at timestamptz not null default now()
);
do $admins$
begin
 if exists(select 1 from public.platform_admins) then raise exception 'existing memberships require separate review'; end if;
 if exists(select 1 from pg_policy where polrelid='public.platform_admins'::regclass and polname<>'platform admins read own membership') then raise exception 'unexpected existing membership policy'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='platform_admins')<>3
 or not exists(select 1 from pg_constraint where conrelid='public.platform_admins'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (user_id)')
 then raise exception 'platform_admins shape mismatch'; end if;
end $admins$;
-- Extension only: no copied name, email, member count or organization identity.
create table public.platform_organizations(
 id uuid primary key references public.organizations(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.platform_plans(
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[a-z0-9_-]{2,40}$'),
 name_ar text not null check(length(trim(name_ar)) between 2 and 120),
 name_en text, price_amount numeric(18,2) not null default 0 check(price_amount>=0 and price_amount<=100000000 and price_amount<>'NaN'::numeric),
 currency text not null default 'SAR' check(currency ~ '^[A-Z]{3}$'),
 billing_interval text not null default 'monthly' check(billing_interval in ('monthly','yearly')),
 is_active boolean not null default false, created_at timestamptz not null default now()
);
create table public.platform_subscriptions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.platform_organizations(id) on delete restrict,
 plan_id uuid not null references public.platform_plans(id) on delete restrict,
 status text not null default 'trialing' check(status in ('trialing','active','past_due','cancelled','expired')),
 started_at timestamptz not null default now(), current_period_end timestamptz,
 created_at timestamptz not null default now(),
 check(current_period_end is null or current_period_end>=started_at),
 unique(id,organization_id)
);
create unique index platform_subscriptions_one_open_per_org on public.platform_subscriptions(organization_id)
 where status in ('trialing','active','past_due');
create index platform_subscriptions_plan_idx on public.platform_subscriptions(plan_id);
create table public.platform_payment_transactions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.platform_organizations(id) on delete restrict,
 subscription_id uuid,
 provider text not null check(provider ~ '^[a-z0-9_-]{2,40}$'),
 provider_transaction_id text not null check(length(provider_transaction_id) between 1 and 180),
 event_kind text not null check(event_kind in ('payment','refund')),
 status text not null check(status in ('pending','succeeded','failed')),
 amount numeric(18,2) not null check(amount>0 and amount<>'NaN'::numeric),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 occurred_at timestamptz not null, recorded_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 unique(provider,provider_transaction_id),
 foreign key(subscription_id,organization_id) references public.platform_subscriptions(id,organization_id) on delete restrict
);
create index platform_payment_transactions_org_time_idx on public.platform_payment_transactions(organization_id,occurred_at desc);
create index platform_payment_transactions_subscription_idx on public.platform_payment_transactions(subscription_id);
create table public.platform_audit_events(
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 event_type text not null check(length(event_type) between 1 and 120),
 entity_type text not null check(length(entity_type) between 1 and 80),
 entity_id uuid, details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index platform_audit_events_time_idx on public.platform_audit_events(created_at desc,id desc);
create index platform_audit_events_actor_idx on public.platform_audit_events(actor_user_id);
create index platform_subscriptions_created_idx on public.platform_subscriptions(created_at desc,id desc);
create index platform_plans_created_idx on public.platform_plans(created_at desc,id desc);
do $secure$
declare t text;
begin
 foreach t in array array['platform_admins','platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $secure$;
-- Authenticated clients can discover only their own role membership for SSR page checks.
grant select on public.platform_admins to authenticated;
drop policy if exists "platform admins read own membership" on public.platform_admins;
create policy "platform admins read own membership" on public.platform_admins for select to authenticated using(user_id=(select auth.uid()));
create function public.owner_authorized() returns boolean
language sql stable security definer set search_path='' as $guard$
 select exists(
 select 1 from public.platform_admins a join auth.users u on u.id=a.user_id
 join auth.sessions s on s.user_id=u.id
 where a.user_id=auth.uid() and a.role='platform_owner'
 and s.id::text=auth.jwt()->>'session_id'
 and (s.not_after is null or s.not_after>now())
 and u.email_confirmed_at is not null and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now())
 );
$guard$;
CREATE FUNCTION public.owner_list_audit_events(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, actor_user_id uuid, event_type text, entity_type text, entity_id uuid, details jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select a.id,a.actor_user_id,a.event_type,a.entity_type,a.entity_id,a.details,a.created_at from public.platform_audit_events a order by a.created_at desc limit least(greatest(coalesce(p_limit,50),1),100);
end $function$;

CREATE FUNCTION public.owner_list_payment_transactions(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, organization_name text, provider text, provider_transaction_id text, event_kind text, status text, amount numeric, currency text, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select t.id,o.name,t.provider,t.provider_transaction_id,t.event_kind,t.status,t.amount,t.currency,t.occurred_at
 from public.platform_payment_transactions t join public.organizations o on o.id=t.organization_id
 order by t.occurred_at desc,t.id desc limit least(greatest(coalesce(p_limit,100),1),200);
end $function$;

CREATE FUNCTION public.owner_list_plans()
 RETURNS TABLE(id uuid, code text, name_ar text, name_en text, price_amount numeric, currency text, billing_interval text, is_active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select p.id,p.code,p.name_ar,p.name_en,p.price_amount,p.currency,p.billing_interval,p.is_active,p.created_at from public.platform_plans p order by p.created_at desc limit 200;
end $function$;

CREATE FUNCTION public.owner_list_subscriptions()
 RETURNS TABLE(id uuid, organization_name text, plan_name text, status text, started_at timestamp with time zone, current_period_end timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select s.id,o.name,p.name_ar,s.status,s.started_at,s.current_period_end,s.created_at from public.platform_subscriptions s join public.organizations o on o.id=s.organization_id join public.platform_plans p on p.id=s.plan_id order by s.created_at desc limit 200;
end $function$;

CREATE FUNCTION public.owner_list_users(p_page integer DEFAULT 1, p_per_page integer DEFAULT 50)
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if; return query select u.id,u.email::text,u.created_at,u.last_sign_in_at,u.email_confirmed_at from auth.users u order by u.created_at desc limit least(greatest(p_per_page,1),50) offset (least(greatest(p_page,1),10000)-1)*least(greatest(p_per_page,1),50); end $function$;

CREATE FUNCTION public.owner_subscription_summary()
 RETURNS TABLE(plans bigint, active_plans bigint, subscriptions bigint, active_subscriptions bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if; return query select (select count(*) from public.platform_plans),(select count(*) from public.platform_plans where is_active),(select count(*) from public.platform_subscriptions),(select count(*) from public.platform_subscriptions where status='active'); end $function$;

CREATE FUNCTION public.owner_user_count()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if; return (select count(*) from auth.users); end $function$;


create function public.owner_organization_count() returns bigint language plpgsql security definer set search_path='' as $f$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return(select count(*) from public.organizations);
end $f$;
create function public.owner_list_organizations(p_page integer default 1,p_per_page integer default 30)
returns table(id uuid,name text,legal_name text,base_currency text,entity_type text,status text,created_at timestamptz,owner_email text,member_count bigint)
language plpgsql security definer set search_path='' as $f$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select o.id,o.name,o.legal_name,o.base_currency,o.entity_type,o.status,o.created_at,u.email::text,
 (select count(*) from public.organization_members m where m.organization_id=o.id and m.status='ACTIVE')
 from public.organizations o left join auth.users u on u.id=o.owner_user_id
 order by o.created_at desc,o.id desc
 limit least(greatest(coalesce(p_per_page,30),1),30)
 offset (least(greatest(coalesce(p_page,1),1),10000)-1)*least(greatest(coalesce(p_per_page,30),1),30);
end $f$;
-- Signatures are present for UI compatibility; operational writes require separate approval.
create function public.owner_upsert_plan(p_code text,p_name_ar text,p_price numeric,p_currency text,p_interval text,p_active boolean default true,p_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $f$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 raise exception 'platform plan writes are disabled for initial rollout' using errcode='0A000';
end $f$;
create function public.owner_change_subscription_status(p_subscription_id uuid,p_expected_status text,p_new_status text)
returns boolean language plpgsql security definer set search_path='' as $f$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 raise exception 'platform subscription writes are disabled for initial rollout' using errcode='0A000';
end $f$;
revoke all on function public.owner_authorized() from public,anon,authenticated,service_role;
grant execute on function public.owner_authorized() to authenticated;
revoke all on function public.owner_change_subscription_status(p_subscription_id uuid, p_expected_status text, p_new_status text) from public,anon,authenticated,service_role;
grant execute on function public.owner_change_subscription_status(p_subscription_id uuid, p_expected_status text, p_new_status text) to authenticated;
revoke all on function public.owner_list_audit_events(p_limit integer) from public,anon,authenticated,service_role;
grant execute on function public.owner_list_audit_events(p_limit integer) to authenticated;
revoke all on function public.owner_list_organizations(p_page integer, p_per_page integer) from public,anon,authenticated,service_role;
grant execute on function public.owner_list_organizations(p_page integer, p_per_page integer) to authenticated;
revoke all on function public.owner_list_payment_transactions(p_limit integer) from public,anon,authenticated,service_role;
grant execute on function public.owner_list_payment_transactions(p_limit integer) to authenticated;
revoke all on function public.owner_list_plans() from public,anon,authenticated,service_role;
grant execute on function public.owner_list_plans() to authenticated;
revoke all on function public.owner_list_subscriptions() from public,anon,authenticated,service_role;
grant execute on function public.owner_list_subscriptions() to authenticated;
revoke all on function public.owner_list_users(p_page integer, p_per_page integer) from public,anon,authenticated,service_role;
grant execute on function public.owner_list_users(p_page integer, p_per_page integer) to authenticated;
revoke all on function public.owner_organization_count() from public,anon,authenticated,service_role;
grant execute on function public.owner_organization_count() to authenticated;
revoke all on function public.owner_subscription_summary() from public,anon,authenticated,service_role;
grant execute on function public.owner_subscription_summary() to authenticated;
revoke all on function public.owner_upsert_plan(p_code text, p_name_ar text, p_price numeric, p_currency text, p_interval text, p_active boolean, p_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_upsert_plan(p_code text, p_name_ar text, p_price numeric, p_currency text, p_interval text, p_active boolean, p_id uuid) to authenticated;
revoke all on function public.owner_user_count() from public,anon,authenticated,service_role;
grant execute on function public.owner_user_count() to authenticated;
notify pgrst,'reload schema';
commit;

