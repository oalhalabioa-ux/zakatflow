-- Review-only rollout: never apply against a shared/live database without preflight approval.
begin;
do $$begin
 if to_regclass('public.platform_subscriptions') is null or to_regprocedure('public.owner_authorized()') is null then
  raise exception 'PLATFORM_OWNER_FOUNDATION_REQUIRED';
 end if;
end$$;
create schema if not exists subscription_private;
revoke all on schema subscription_private from public,anon,authenticated,service_role;
-- Existing organizations remain explicitly grandfathered. No old subscription rows are changed.
alter table public.organizations add column subscription_mode text not null default 'legacy' check(subscription_mode in ('legacy','managed'));
alter table public.organizations alter column subscription_mode set default 'managed';
alter table public.platform_plans add column features jsonb not null default '["core"]'::jsonb;
alter table public.platform_subscriptions add column trial_started_at timestamptz;
alter table public.platform_subscriptions add column trial_ends_at timestamptz;
alter table public.platform_subscriptions add column trial_duration_days integer check(trial_duration_days between 1 and 365);
alter table public.platform_subscriptions add column max_users integer check(max_users between 1 and 100000);
alter table public.platform_subscriptions add column suspended_from_status text check(suspended_from_status in ('trialing','active','expired','past_due','cancelled'));
alter table public.platform_subscriptions add column converted_at timestamptz;
alter table public.platform_subscriptions add column revision integer not null default 1;
alter table public.platform_subscriptions add column updated_at timestamptz not null default now();
alter table public.platform_subscriptions drop constraint platform_subscriptions_status_check;
alter table public.platform_subscriptions add constraint platform_subscriptions_status_check check(status in ('trialing','active','past_due','cancelled','expired','suspended'));
alter table public.platform_subscriptions add constraint trial_dates_valid check(
 (trial_started_at is null and trial_ends_at is null and trial_duration_days is null) or
 (trial_started_at is not null and trial_ends_at>trial_started_at and trial_duration_days is not null and max_users is not null));
-- Include suspended rows to prevent a second subscription bypassing a suspension.
drop index public.platform_subscriptions_one_open_per_org;
create unique index platform_subscriptions_one_open_per_org on public.platform_subscriptions(organization_id) where status in ('trialing','active','past_due','suspended');
create unique index platform_subscriptions_one_trial_ever on public.platform_subscriptions(organization_id) where trial_started_at is not null;
create index platform_subscriptions_trial_end_idx on public.platform_subscriptions(trial_ends_at) where trial_started_at is not null;
create table subscription_private.settings(id boolean primary key default true check(id),trial_days integer not null check(trial_days between 1 and 365),revision integer not null default 1,launched_at timestamptz not null default now());
insert into subscription_private.settings(id,trial_days) values(true,30);
alter table subscription_private.settings enable row level security;
create table subscription_private.notifications(
 subscription_id uuid not null references public.platform_subscriptions(id) on delete restrict,
 revision integer not null, milestone integer not null check(milestone in (7,3,1,0)),
 due_at timestamptz not null,created_at timestamptz not null default now(),
 primary key(subscription_id,revision,milestone));
alter table subscription_private.notifications enable row level security;
insert into public.platform_plans(code,name_ar,name_en,price_amount,currency,billing_interval,is_active,features)
 values('trial_30d','التجربة المجانية','Free trial',0,'SAR','monthly',false,'["core"]') on conflict(code) do nothing;

-- Pure state resolution. Always evaluated against database time, never a browser/JWT timestamp.
create function subscription_private.entitlement(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_subscriptions%rowtype;mode text;state text;
begin
 select subscription_mode into mode from public.organizations where id=p_org;
 if mode is null then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='42501'; end if;
 select * into s from public.platform_subscriptions where organization_id=p_org order by created_at desc,id desc limit 1;
 if not found then
  return jsonb_build_object('status',case when mode='legacy' then 'legacy' else 'unconfigured' end,'can_write',mode='legacy','max_users',null,'server_now',statement_timestamp());
 end if;
 state:=s.status;
 if state='trialing' and (s.trial_ends_at is null or s.trial_ends_at<=statement_timestamp()) then state:='expired';end if;
 if state='active' and (s.current_period_end is null or s.current_period_end<=statement_timestamp()) then state:='expired';end if;
 return jsonb_build_object('id',s.id,'started_at',s.started_at,'organization_id',p_org,'status',state,'can_write',state in ('trialing','active'),
  'trial_started_at',s.trial_started_at,'trial_ends_at',s.trial_ends_at,'trial_duration_days',s.trial_duration_days,
  'current_period_end',s.current_period_end,'max_users',s.max_users,'revision',s.revision,'plan_id',s.plan_id,
  'days_remaining',greatest(0,ceil(extract(epoch from (case when state='active' then s.current_period_end else s.trial_ends_at end-statement_timestamp()))/86400)),
  'server_now',statement_timestamp());
end$$;
create function subscription_private.assert_writable(p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((subscription_private.entitlement(p_org)->>'can_write')::boolean,false) then
  raise exception 'SUBSCRIPTION_READ_ONLY' using errcode='42501';
 end if;
end$$;
-- Budget plans historically use a company name. Add a durable identity without rewriting old rows.
do $$begin if to_regclass('public.budget_plans') is not null then
 alter table public.budget_plans add column organization_id uuid references public.organizations(id) on delete restrict;
 create index budget_plans_subscription_org_idx on public.budget_plans(organization_id);
end if;end$$;
create function subscription_private.bind_budget_organization() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[];begin
 if tg_op='UPDATE' and old.organization_id is not null then
  if new.organization_id is distinct from old.organization_id then raise exception 'BUDGET_ORGANIZATION_IMMUTABLE' using errcode='42501';end if;
  return new;
 end if;
 if new.organization_id is null and trim(new.organization_name)<>'' then
  select array_agg(distinct o.id) into ids from public.organizations o join public.organization_members m on m.organization_id=o.id
   where o.name=new.organization_name and m.user_id=new.user_id and m.status='ACTIVE';
  if cardinality(ids)>1 then raise exception 'BUDGET_ORGANIZATION_AMBIGUOUS' using errcode='42501';end if;
  if cardinality(ids)=1 then new.organization_id:=ids[1];end if;
 end if;
 return new;
end$$;
do $$begin if to_regclass('public.budget_plans') is not null then
 create trigger subscription_00_budget_binding before insert or update on public.budget_plans for each row execute function subscription_private.bind_budget_organization();
end if;end$$;
-- Resolve organization scope through real foreign keys, including child rows without organization_id.
-- No client-supplied org identifier can override the scope of an existing row.
create function subscription_private.row_scopes(p_table oid,p_row jsonb,p_seen oid[] default '{}') returns uuid[]
language plpgsql stable security definer set search_path='' as $$
declare result uuid[]:='{}';f record;parent jsonb;condition text;v text;org uuid;
begin
 if p_row is null then return result;end if;
 if p_table='public.organizations'::regclass then return array[(p_row->>'id')::uuid];end if;
 -- Old name-linked budget rows remain protected before their first user-authorized save.
 if p_table=to_regclass('public.budget_plans') and nullif(p_row->>'organization_name','') is not null then
  select coalesce(array_agg(distinct o.id),'{}') into result from public.organizations o join public.organization_members m on m.organization_id=o.id
   where o.name=p_row->>'organization_name' and m.user_id=(p_row->>'user_id')::uuid;
 end if;
 -- Every direct organization identifier, including both sides of a transfer.
 for v in select value from jsonb_each_text(p_row) where key='organization_id' or key like '%\_organization_id' escape '\' loop
  if v is not null then org:=v::uuid;if exists(select 1 from public.organizations where id=org) then result:=array_append(result,org);end if;end if;
 end loop;
 if p_table=any(p_seen) then return result;end if;
 if cardinality(p_seen)>12 then raise exception 'SUBSCRIPTION_SCOPE_DEPTH_EXCEEDED' using errcode='42501';end if;
 for f in select c.confrelid,c.conkey,c.confkey from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid=c.confrelid join pg_catalog.pg_namespace n on n.oid=t.relnamespace
  where c.conrelid=p_table and c.contype='f' and n.nspname='public' and t.relname not in ('profiles','currencies','platform_plans','subscriptions') loop
  select string_agg(format('to_jsonb(t)->>%L = $1->>%L',pa.attname,ca.attname),' and ') into condition
   from unnest(f.conkey,f.confkey) k(child,parent)
   join pg_catalog.pg_attribute ca on ca.attrelid=p_table and ca.attnum=k.child
   join pg_catalog.pg_attribute pa on pa.attrelid=f.confrelid and pa.attnum=k.parent;
  execute format('select to_jsonb(t) from %s t where %s',f.confrelid::regclass,condition) into parent using p_row;
  if parent is not null then result:=result||subscription_private.row_scopes(f.confrelid,parent,p_seen||p_table);end if;
 end loop;
 return array(select distinct x from unnest(result) x where x is not null);
end$$;
create function subscription_private.guard_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare org uuid;scopes uuid[]:='{}';
begin
 if tg_op<>'INSERT' then scopes:=scopes||subscription_private.row_scopes(tg_relid,to_jsonb(old));end if;
 if tg_op<>'DELETE' then scopes:=scopes||subscription_private.row_scopes(tg_relid,to_jsonb(new));end if;
 for org in select distinct x from unnest(scopes) x order by x loop perform subscription_private.assert_writable(org);end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create function subscription_private.guard_organization() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if auth.uid() is null or new.owner_user_id<>auth.uid() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<=now())) then
   raise exception 'VERIFIED_OWNER_REQUIRED' using errcode='42501';end if;
  new.subscription_mode:='managed';new.created_at:=statement_timestamp();
 else
  if new.subscription_mode<>old.subscription_mode then raise exception 'SUBSCRIPTION_MODE_IMMUTABLE' using errcode='42501';end if;
  perform subscription_private.assert_writable(old.id);
 end if;
 return new;
end$$;
create trigger subscription_organization_guard before insert or update on public.organizations for each row execute function subscription_private.guard_organization();
create function subscription_private.activate_trial() returns trigger
language plpgsql security definer set search_path='' as $$
declare days integer;plan uuid;t timestamptz:=statement_timestamp();
begin
 select trial_days into days from subscription_private.settings where id;
 select id into plan from public.platform_plans where code='trial_30d';
 insert into public.platform_organizations(id) values(new.id);
 insert into public.platform_subscriptions(organization_id,plan_id,status,started_at,trial_started_at,trial_ends_at,trial_duration_days,max_users)
 values(new.id,plan,'trialing',t,t,t+make_interval(secs=>days*86400.0),days,5);
 insert into public.organization_members(organization_id,user_id,role,status) values(new.id,new.owner_user_id,'OWNER','ACTIVE');
 return new;
end$$;
create trigger subscription_activate_trial after insert on public.organizations for each row execute function subscription_private.activate_trial();
-- Common row lock serializes ALL seat additions/reactivations, not just a particular invitation.
create function subscription_private.guard_seat() returns trigger
language plpgsql security definer set search_path='' as $$
declare lim integer;
begin
 if tg_op='UPDATE' and (new.organization_id<>old.organization_id or new.user_id<>old.user_id) then raise exception 'MEMBERSHIP_IDENTITY_IMMUTABLE' using errcode='42501';end if;
 perform 1 from public.organizations where id=new.organization_id for update;
 perform subscription_private.assert_writable(new.organization_id);
 if new.status='ACTIVE' and (tg_op='INSERT' or old.status is distinct from 'ACTIVE') then
  lim:=(subscription_private.entitlement(new.organization_id)->>'max_users')::integer;
  if lim is not null and (select count(*) from public.organization_members where organization_id=new.organization_id and status='ACTIVE')>=lim then
   raise exception 'SUBSCRIPTION_USER_LIMIT' using errcode='23514';end if;
 end if;
 return new;
end$$;
create trigger subscription_seat_guard before insert or update on public.organization_members for each row execute function subscription_private.guard_seat();

-- Preserve existing permissions and RLS. A separate trigger remains effective inside SECURITY DEFINER RPCs.
-- Exempt identity/preferences, billing control plane and system reference catalogs only.
-- The coverage manifest is reviewed/tested before deployment; new business tables require this installer.
create table subscription_private.guard_coverage(table_name text primary key,has_direct_scope boolean not null,foreign_keys integer not null);
alter table subscription_private.guard_coverage enable row level security;
do $$declare t record;begin
 for t in select c.oid,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not like 'platform\_%' escape '\'
 and c.relname not in ('organizations','profiles','user_settings','currencies','zakat_methods','reference_prices','subscriptions','billing_events','notifications','nisab_prices','price_sources') loop
  execute format('create trigger subscription_write_guard before insert or update or delete on public.%I for each row execute function subscription_private.guard_write()',t.relname);
  insert into subscription_private.guard_coverage select t.relname,exists(select 1 from pg_catalog.pg_attribute where attrelid=t.oid and not attisdropped and attname='organization_id'),(select count(*) from pg_catalog.pg_constraint where conrelid=t.oid and contype='f');
 end loop;
end$$;
create trigger subscription_organization_delete_guard before delete on public.organizations for each row execute function subscription_private.guard_write();

create function public.organization_subscription(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;messages jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE') then raise exception 'ORGANIZATION_ACCESS_REQUIRED' using errcode='42501';end if;
 e:=subscription_private.entitlement(p_organization_id);
 -- Durable in-app delivery once per milestone/revision. Polls and concurrent requests cannot duplicate it.
 if e->>'status' in ('trialing','expired') and e->>'trial_ends_at' is not null then
  insert into subscription_private.notifications(subscription_id,revision,milestone,due_at)
  select (e->>'id')::uuid,(e->>'revision')::integer,m,(e->>'trial_ends_at')::timestamptz-make_interval(secs=>m*86400.0)
  from unnest(array[7,3,1,0]) m where (e->>'trial_ends_at')::timestamptz-make_interval(secs=>m*86400.0)<=statement_timestamp()
  on conflict do nothing;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('milestone',milestone,'due_at',due_at) order by milestone),'[]') into messages from subscription_private.notifications
 where subscription_id=(e->>'id')::uuid and revision=(e->>'revision')::integer;
 return e||jsonb_build_object('active_users',(select count(*) from public.organization_members where organization_id=p_organization_id and status='ACTIVE'),
 'organization_name',(select name from public.organizations where id=p_organization_id),'plan',(select jsonb_build_object('name_ar',name_ar,'name_en',name_en,'features',features) from public.platform_plans where id=(e->>'plan_id')::uuid),
 'notifications',messages,'timezone',(select coalesce(p.timezone,'UTC') from public.profiles p where p.id=auth.uid()));
end$$;
create function public.owner_trial_register(p_search text default '',p_status text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;metrics jsonb;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 with rows as (select o.id,o.name,u.email owner_email,e.value as entitlement,(select count(*) from public.organization_members m where m.organization_id=o.id and m.status='ACTIVE') active_users
 from public.organizations o left join auth.users u on u.id=o.owner_user_id cross join lateral (select subscription_private.entitlement(o.id) value) e
 where (coalesce(p_search,'')='' or o.name ilike '%'||p_search||'%' or u.email ilike '%'||p_search||'%') and (coalesce(p_status,'')='' or e.value->>'status'=p_status)
 order by o.created_at desc,o.id limit 50 offset greatest(0,coalesce(p_offset,0)))
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from rows;
 select jsonb_build_object('trial_total',count(*) filter(where s.trial_started_at is not null),
 'trialing',count(*) filter(where e.value->>'status'='trialing'),'expired',count(*) filter(where e.value->>'status'='expired' and s.trial_started_at is not null),
 'converted',count(*) filter(where s.converted_at is not null),
 'ending_7',count(*) filter(where e.value->>'status'='trialing' and s.trial_ends_at<=statement_timestamp()+interval '7 days')) into metrics
 from public.platform_subscriptions s cross join lateral(select subscription_private.entitlement(s.organization_id) value) e where s.id=(e.value->>'id')::uuid;
 return jsonb_build_object('rows',result,'metrics',metrics,'plans',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.platform_plans p),'settings',(select to_jsonb(s)-'id' from subscription_private.settings s where id),'server_now',statement_timestamp());
end$$;
create function public.owner_manage_trial(p_action text,p_reason text,p_organization_id uuid default null,p_revision integer default null,p_days integer default null,p_until timestamptz default null,p_plan_id uuid default null,p_max_users integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.platform_subscriptions%rowtype;before_value jsonb;after_value jsonb;settings_revision integer;days integer;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 if p_action='defaults' then
  select revision,trial_days into settings_revision,days from subscription_private.settings where id for update;
  if p_revision is distinct from settings_revision then raise exception 'SUBSCRIPTION_CONFLICT' using errcode='40001';end if;
  if p_days is null or p_days not between 1 and 365 then raise exception 'TRIAL_DAYS_INVALID';end if;
  before_value:=jsonb_build_object('trial_days',days,'revision',settings_revision);
  update subscription_private.settings set trial_days=p_days,revision=revision+1 where id;
  after_value:=jsonb_build_object('trial_days',p_days,'revision',settings_revision+1);
 else
  perform 1 from public.organizations where id=p_organization_id for update;
  select * into s from public.platform_subscriptions where organization_id=p_organization_id order by created_at desc,id desc limit 1 for update;
  if not found then
   -- Explicit owner activation is the only path that changes an existing legacy organization.
   if p_action<>'activate' then raise exception 'SUBSCRIPTION_NOT_FOUND';end if;
   if p_revision is distinct from 0 then raise exception 'SUBSCRIPTION_CONFLICT' using errcode='40001';end if;
   if p_plan_id is null or not exists(select 1 from public.platform_plans where id=p_plan_id and is_active and code<>'trial_30d') then raise exception 'ACTIVE_PLAN_REQUIRED';end if;
   insert into public.platform_organizations(id) values(p_organization_id) on conflict do nothing;
   insert into public.platform_subscriptions(organization_id,plan_id,status,revision)
    values(p_organization_id,p_plan_id,'expired',0) returning * into s;
   before_value:=jsonb_build_object('status','legacy','organization_id',p_organization_id);
  else before_value:=to_jsonb(s);end if;
  if p_revision is distinct from s.revision then raise exception 'SUBSCRIPTION_CONFLICT' using errcode='40001';end if;
  if p_action='extend' then
   if s.status not in ('trialing','expired') or s.trial_started_at is null or p_days is null or p_days not between 1 and 365 then raise exception 'TRIAL_EXTENSION_INVALID';end if;
   update public.platform_subscriptions set trial_ends_at=greatest(trial_ends_at,statement_timestamp())+make_interval(secs=>p_days*86400.0),status='trialing',revision=revision+1,updated_at=now() where id=s.id;
  elsif p_action='activate' then
   if p_until is null or p_until<=statement_timestamp() or p_plan_id is null or p_max_users is null or p_max_users not between 1 and 100000 then raise exception 'PAID_SUBSCRIPTION_DETAILS_REQUIRED';end if;
   if not exists(select 1 from public.platform_plans where id=p_plan_id and is_active and code<>'trial_30d') then raise exception 'ACTIVE_PLAN_REQUIRED';end if;
   if p_max_users<(select count(*) from public.organization_members where organization_id=p_organization_id and status='ACTIVE') then raise exception 'SUBSCRIPTION_USER_LIMIT';end if;
   update public.platform_subscriptions set status='active',started_at=statement_timestamp(),suspended_from_status=null,converted_at=coalesce(converted_at,statement_timestamp()),plan_id=p_plan_id,current_period_end=p_until,max_users=p_max_users,revision=revision+1,updated_at=now() where id=s.id;
  elsif p_action='suspend' then
   if s.status='suspended' then raise exception 'SUBSCRIPTION_ALREADY_SUSPENDED';end if;
   update public.platform_subscriptions set suspended_from_status=status,status='suspended',revision=revision+1,updated_at=now() where id=s.id;
  elsif p_action='resume' then
   if s.status<>'suspended' or s.suspended_from_status is null then raise exception 'SUBSCRIPTION_NOT_SUSPENDED';end if;
   update public.platform_subscriptions set status=suspended_from_status,suspended_from_status=null,revision=revision+1,updated_at=now() where id=s.id;
  else raise exception 'ADMIN_ACTION_INVALID';end if;
  select to_jsonb(t) into after_value from public.platform_subscriptions t where id=s.id;
 end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(auth.uid(),'subscription.'||p_action,'organization_subscription',p_organization_id,jsonb_build_object('reason',trim(p_reason),'before',before_value,'after',after_value));
 return after_value;
end$$;
create function public.owner_trial_audit(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(a)) from (select * from public.platform_audit_events where entity_type='organization_subscription' and entity_id is not distinct from p_organization_id order by created_at desc limit 100) a),'[]');
end$$;
-- Explicit API grants; private helpers cannot be invoked from PostgREST.
revoke all on all functions in schema subscription_private from public,anon,authenticated,service_role;
revoke all on function public.organization_subscription(uuid),public.owner_trial_register(text,text,integer),public.owner_manage_trial(text,text,uuid,integer,integer,timestamptz,uuid,integer),public.owner_trial_audit(uuid) from public,anon,authenticated,service_role;
grant execute on function public.organization_subscription(uuid),public.owner_trial_register(text,text,integer),public.owner_manage_trial(text,text,uuid,integer,integer,timestamptz,uuid,integer),public.owner_trial_audit(uuid) to authenticated;

-- No automatic mutation of existing organizations; this read gates onboarding only for new accounts.
create function public.organization_onboarding_required() returns boolean
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501';end if;
 return exists(select 1 from auth.users u,subscription_private.settings s where u.id=auth.uid() and u.created_at>=s.launched_at and u.email_confirmed_at is not null)
 and not exists(select 1 from public.organization_members where user_id=auth.uid());
end$$;
revoke all on function public.organization_onboarding_required() from public,anon,authenticated,service_role;
grant execute on function public.organization_onboarding_required() to authenticated;
-- Optional internal maintenance job. Access enforcement does not depend on it running.
-- Schedule only on the isolated preview now; scheduling in Production requires release approval.
create function subscription_private.sweep_trials() returns integer
language plpgsql security definer set search_path='' as $$
declare s record;n integer:=0;begin
 for s in select * from public.platform_subscriptions where trial_started_at is not null and status in ('trialing','expired') loop
  insert into subscription_private.notifications(subscription_id,revision,milestone,due_at)
  select s.id,s.revision,m,s.trial_ends_at-make_interval(secs=>m*86400.0) from unnest(array[7,3,1,0]) m
  where s.trial_ends_at-make_interval(secs=>m*86400.0)<=statement_timestamp() on conflict do nothing;
  update public.platform_subscriptions set status='expired',updated_at=now() where id=s.id and status='trialing' and trial_ends_at<=statement_timestamp();
  n:=n+1;
 end loop;return n;
end$$;
revoke all on function subscription_private.sweep_trials() from public,anon,authenticated,service_role;

create function public.owner_create_subscription_plan(p_code text,p_name_ar text,p_name_en text,p_price numeric,p_currency text,p_interval text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$declare result uuid;begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or p_name_en is null or length(trim(p_name_en)) not between 2 and 120 then raise exception 'PLAN_DETAILS_REQUIRED';end if;
 insert into public.platform_plans(code,name_ar,name_en,price_amount,currency,billing_interval,is_active,features)
 values(p_code,trim(p_name_ar),trim(p_name_en),p_price,p_currency,p_interval,true,'["core"]') returning id into result;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(auth.uid(),'subscription.plan_created','subscription_plan',result,jsonb_build_object('reason',trim(p_reason),'after',(select to_jsonb(p) from public.platform_plans p where p.id=result)));
 return result;
end$$;
revoke all on function public.owner_create_subscription_plan(text,text,text,numeric,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_create_subscription_plan(text,text,text,numeric,text,text,text) to authenticated;

commit;
