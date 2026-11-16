begin;
set local lock_timeout='3s';
alter table public.platform_plans add column family text not null default 'custom';
alter table public.platform_plans add column description_ar text not null default '';
alter table public.platform_plans add column description_en text not null default '';
alter table public.platform_plans add column max_users integer check(max_users between 1 and 100000);
alter table public.platform_plans add column is_published boolean not null default false;
alter table public.platform_plans add column is_proposed boolean not null default true;
alter table public.platform_plans add column revision integer not null default 1;
alter table public.platform_plans add column sort_order integer not null default 100;
alter table public.platform_subscriptions add column entitlements jsonb;
alter table public.platform_subscriptions add column plan_snapshot jsonb;
create unique index platform_plan_public_variant on public.platform_plans(family,currency,billing_interval) where is_published and is_active;

create function subscription_private.valid_capabilities(p_caps jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_caps)='array' and jsonb_array_length(p_caps) between 2 and 8
 and p_caps @> '["module:assets","module:liquidity"]'::jsonb
 and not exists(select 1 from jsonb_array_elements_text(p_caps) v where v not in ('module:assets','module:liquidity','module:zakat','module:vat','module:debts','module:budgets','module:investments','feature:custom_roles'))
 and (select count(*)=count(distinct v) from jsonb_array_elements_text(p_caps) v),false)
$$;
create function subscription_private.plan_snapshot(p_plan uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'code',code,'name_ar',name_ar,'name_en',name_en,'price_amount',price_amount,'currency',currency,'billing_interval',billing_interval,'max_users',max_users,'features',features,'revision',revision) from public.platform_plans where id=p_plan
$$;
alter function subscription_private.entitlement(uuid) rename to entitlement_state;
create function subscription_private.entitlement(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e jsonb;caps jsonb;s public.platform_subscriptions%rowtype;
begin
 e:=subscription_private.entitlement_state(p_org);
 select * into s from public.platform_subscriptions where organization_id=p_org order by created_at desc,id desc limit 1;
 if e->>'status'='legacy' or s.trial_started_at is not null and s.converted_at is null then caps:='["core"]';
 else caps:=coalesce(s.entitlements,'["core"]'::jsonb);end if;
 return e||jsonb_build_object('capabilities',caps,'plan_snapshot',s.plan_snapshot);
end$$;
create function subscription_private.table_capability(p_table oid) returns text language sql stable set search_path='' as $$
 select case
 when c.relname in ('budget_plans','budget_lines','budget_dimensions','financial_budget_mappings','financial_budget_scope_grants','financial_budget_plan_ownership','financial_budget_commands','financial_budget_retirements','budget_approval_events') then 'module:budgets'
 when c.relname like 'investment\_%' escape '\' or c.relname in ('participation_contracts','participation_movements') then 'module:investments'
 when c.relname in ('vat_contacts','vat_profiles','vat_documents','vat_einvoices','vat_einvoice_lines','vat_einvoice_connections') then 'module:vat'
 when c.relname in ('zakat_assessments','zakat_assessment_lines','zakat_payments','zakat_payment_allocations','manual_zakat_assessments','corporate_zakat_finalizations','corporate_zakat_sources') then 'module:zakat'
 when c.relname in ('debt_contracts','debt_operation_requests','debt_collection_followups','debt_payroll_requests','debt_payroll_items','financing_contract_terms') then 'module:debts'
 when c.relname in ('organization_roles','organization_member_permission_overrides') then 'feature:custom_roles'
 else null end from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.oid=p_table and n.nspname='public'
$$;
create or replace function subscription_private.guard_write() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;scopes uuid[]:='{}';cap text;caps jsonb;internal_actual boolean:=false;
begin
 if tg_op<>'INSERT' then scopes:=scopes||subscription_private.row_scopes(tg_relid,to_jsonb(old));end if;
 if tg_op<>'DELETE' then scopes:=scopes||subscription_private.row_scopes(tg_relid,to_jsonb(new));end if;
 cap:=subscription_private.table_capability(tg_relid);
 -- Nested bookkeeping may maintain actuals; this does not waive expiry or permit manual budget edits.
 if tg_table_name='budget_lines' and tg_op='UPDATE' and pg_trigger_depth()>1 then
  internal_actual:=(to_jsonb(old)-'monthly_actual'-'updated_at')=(to_jsonb(new)-'monthly_actual'-'updated_at');
 end if;
 for org in select distinct x from unnest(scopes) x order by x loop
  perform subscription_private.assert_writable(org);
  if cap is not null and not internal_actual then
   caps:=subscription_private.entitlement(org)->'capabilities';
   if not coalesce(caps ? 'core' or caps ? cap,false) then raise exception 'SUBSCRIPTION_CAPABILITY_REQUIRED' using errcode='42501',detail=cap;end if;
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;

create function public.subscription_plan_catalog() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501';end if;
 return jsonb_build_object('trial_days',(select trial_days from subscription_private.settings where id),
 'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'family',family,'name_ar',name_ar,'name_en',name_en,'description_ar',description_ar,'description_en',description_en,'price_amount',price_amount,'currency',currency,'billing_interval',billing_interval,'max_users',max_users,'features',features,'is_proposed',is_proposed) order by sort_order,code),'[]') from public.platform_plans where is_published and is_active));
end$$;
create function public.owner_save_subscription_plan(p_details jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_plan public.platform_plans%rowtype;result public.platform_plans%rowtype;pid uuid;caps jsonb;price numeric;seats integer;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 pid:=nullif(p_details->>'id','')::uuid;caps:=p_details->'features';price:=(p_details->>'price')::numeric;seats:=(p_details->>'max_users')::integer;
 if not subscription_private.valid_capabilities(caps) or price is null or price<0 or price>100000000 or price<>round(price,2) or seats is null or seats not between 1 and 100000
 or coalesce(p_details->>'code','') !~ '^[a-z0-9_-]{2,40}$' or coalesce(p_details->>'family','') !~ '^[a-z0-9_-]{2,40}$'
 or length(trim(coalesce(p_details->>'name_ar',''))) not between 2 and 120 or length(trim(coalesce(p_details->>'name_en',''))) not between 2 and 120
 or coalesce(p_details->>'currency','') !~ '^[A-Z]{3}$' or coalesce(p_details->>'interval','') not in ('monthly','yearly')
 or length(coalesce(p_details->>'description_ar',''))>500 or length(coalesce(p_details->>'description_en',''))>500 then raise exception 'PLAN_DETAILS_INVALID';end if;
 if pid is not null then
  select * into old_plan from public.platform_plans where id=pid for update;
  if not found or old_plan.code='trial_30d' then raise exception 'PLAN_NOT_EDITABLE';end if;
  if (p_details->>'revision')::integer is distinct from old_plan.revision then raise exception 'PLAN_CONFLICT' using errcode='40001';end if;
  if old_plan.code<>p_details->>'code' then raise exception 'PLAN_CODE_IMMUTABLE';end if;
  -- Existing agreements retain their permissions and quote before any catalog change.
  update public.platform_subscriptions set entitlements=coalesce(entitlements,'["core"]'::jsonb),plan_snapshot=coalesce(plan_snapshot,subscription_private.plan_snapshot(pid)) where plan_id=pid and (entitlements is null or plan_snapshot is null);
 else
  insert into public.platform_plans(code,name_ar,name_en,price_amount,currency,billing_interval,features) values(p_details->>'code',trim(p_details->>'name_ar'),trim(p_details->>'name_en'),price,p_details->>'currency',p_details->>'interval',caps) returning id into pid;
 end if;
 update public.platform_plans set name_ar=trim(p_details->>'name_ar'),name_en=trim(p_details->>'name_en'),price_amount=price,currency=p_details->>'currency',billing_interval=p_details->>'interval',features=caps,
 family=p_details->>'family',description_ar=coalesce(p_details->>'description_ar',''),description_en=coalesce(p_details->>'description_en',''),max_users=seats,
 is_active=coalesce((p_details->>'is_active')::boolean,true),is_published=coalesce((p_details->>'is_published')::boolean,false),is_proposed=coalesce((p_details->>'is_proposed')::boolean,true),
 revision=case when old_plan.id is null then 1 else revision+1 end where id=pid returning * into result;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'subscription.plan_saved','subscription_plan',pid,jsonb_build_object('reason',trim(p_reason),'before',to_jsonb(old_plan),'after',to_jsonb(result)));
 return to_jsonb(result);
end$$;

create or replace function public.owner_manage_trial(p_action text,p_reason text,p_organization_id uuid default null,p_revision integer default null,p_days integer default null,p_until timestamptz default null,p_plan_id uuid default null,p_max_users integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.platform_subscriptions%rowtype;before_value jsonb;after_value jsonb;settings_revision integer;days integer;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 if p_action='activate' then perform 1 from public.platform_plans where id=p_plan_id for share;end if;
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
   if exists(select 1 from public.platform_plans where id=p_plan_id and max_users is not null and p_max_users>max_users) then raise exception 'PLAN_SEAT_LIMIT';end if;
   if p_max_users<(select count(*) from public.organization_members where organization_id=p_organization_id and status='ACTIVE') then raise exception 'SUBSCRIPTION_USER_LIMIT';end if;
   update public.platform_subscriptions set status='active',started_at=statement_timestamp(),suspended_from_status=null,converted_at=coalesce(converted_at,statement_timestamp()),plan_id=p_plan_id,entitlements=(select features from public.platform_plans where id=p_plan_id),plan_snapshot=subscription_private.plan_snapshot(p_plan_id),current_period_end=p_until,max_users=p_max_users,revision=revision+1,updated_at=now() where id=s.id;
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

create or replace function public.organization_subscription(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;messages jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE') then raise exception 'ORGANIZATION_ACCESS_REQUIRED' using errcode='42501';end if;
 e:=subscription_private.entitlement(p_organization_id);
 -- Durable in-app delivery once per milestone/deadline. Polls and concurrent requests cannot duplicate it.
 if e->>'status' in ('trialing','expired') and e->>'trial_ends_at' is not null then
  insert into subscription_private.notifications(subscription_id,revision,trial_ends_at,milestone,due_at)
  select (e->>'id')::uuid,(e->>'revision')::integer,(e->>'trial_ends_at')::timestamptz,m,(e->>'trial_ends_at')::timestamptz-make_interval(secs=>m*86400.0)
  from unnest(array[7,3,1,0]) m where (e->>'trial_ends_at')::timestamptz-make_interval(secs=>m*86400.0)<=statement_timestamp()
  on conflict do nothing;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('milestone',milestone,'due_at',due_at) order by milestone),'[]') into messages from subscription_private.notifications
 where subscription_id=(e->>'id')::uuid and trial_ends_at=(e->>'trial_ends_at')::timestamptz;
 return e||jsonb_build_object('active_users',(select count(*) from public.organization_members where organization_id=p_organization_id and status='ACTIVE'),
 'organization_name',(select name from public.organizations where id=p_organization_id),'plan',coalesce(nullif(e->'plan_snapshot','null'::jsonb),(select jsonb_build_object('name_ar',name_ar,'name_en',name_en,'features',features) from public.platform_plans where id=(e->>'plan_id')::uuid)),
 'notifications',messages,'timezone',(select coalesce(p.timezone,'UTC') from public.profiles p where p.id=auth.uid()));
end$$;

-- Proposed launch prices, editable by the platform owner. No charge or payment is created.
insert into public.platform_plans(code,family,name_ar,name_en,description_ar,description_en,price_amount,currency,billing_interval,max_users,features,is_active,is_published,is_proposed,sort_order)
select tier||'_'||cadence,tier,case when tier='professional' then 'المهنية' else 'المتقدمة' end,case when tier='professional' then 'Professional' else 'Advanced' end,
case when tier='professional' then 'للمنشآت التي تدير أعمالها المالية اليومية.' else 'للمنشآت التي تحتاج التخطيط والاستثمارات وتخصيص الأدوار.' end,
case when tier='professional' then 'For daily business finance management.' else 'For planning, investments and role customization.' end,
(case when tier='professional' then 199 else 399 end)*(case when cadence='yearly' then 10 else 1 end),'SAR',cadence,case when tier='professional' then 5 else 15 end,
case when tier='professional' then '["module:assets","module:liquidity","module:zakat","module:vat","module:debts"]'::jsonb else '["module:assets","module:liquidity","module:zakat","module:vat","module:debts","module:budgets","module:investments","feature:custom_roles"]'::jsonb end,true,true,true,case when tier='professional' then 10 else 20 end
from unnest(array['professional','advanced']) tier cross join unnest(array['monthly','yearly']) cadence on conflict(code) do nothing;
revoke all on all functions in schema subscription_private from public,anon,authenticated,service_role;
revoke all on function public.subscription_plan_catalog(),public.owner_save_subscription_plan(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.subscription_plan_catalog(),public.owner_save_subscription_plan(jsonb,text) to authenticated;
commit;
