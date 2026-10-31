-- Additive customer-facing plan copy. No pricing, entitlement, Auth or RLS changes.
-- Run only after explicit Production database approval.
begin;
set local lock_timeout='3s';
alter table public.platform_plans add column customer_notice_ar text not null default '' check(length(customer_notice_ar)<=160);
alter table public.platform_plans add column customer_notice_en text not null default '' check(length(customer_notice_en)<=160);
create or replace function public.subscription_plan_catalog() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501';end if;
 return jsonb_build_object('trial_days',(select trial_days from subscription_private.settings where id),
 'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'family',family,'name_ar',name_ar,'name_en',name_en,'description_ar',description_ar,'description_en',description_en,'price_amount',price_amount,'currency',currency,'billing_interval',billing_interval,'max_users',max_users,'features',features,'is_proposed',is_proposed,'customer_notice_ar',customer_notice_ar,'customer_notice_en',customer_notice_en) order by sort_order,code),'[]') from public.platform_plans where is_published and is_active));
end$$;
create or replace function public.owner_save_subscription_plan(p_details jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if (p_details ? 'customer_notice_ar' and jsonb_typeof(p_details->'customer_notice_ar') not in ('string','null')) or (p_details ? 'customer_notice_en' and jsonb_typeof(p_details->'customer_notice_en') not in ('string','null')) or length(coalesce(p_details->>'customer_notice_ar',''))>160 or length(coalesce(p_details->>'customer_notice_en',''))>160 then raise exception 'PLAN_DETAILS_INVALID';end if;
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
 customer_notice_ar=case when p_details ? 'customer_notice_ar' then trim(coalesce(p_details->>'customer_notice_ar','')) else coalesce(old_plan.customer_notice_ar,'') end,
 customer_notice_en=case when p_details ? 'customer_notice_en' then trim(coalesce(p_details->>'customer_notice_en','')) else coalesce(old_plan.customer_notice_en,'') end,
 revision=case when old_plan.id is null then 1 else revision+1 end where id=pid returning * into result;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'subscription.plan_saved','subscription_plan',pid,jsonb_build_object('reason',trim(p_reason),'before',to_jsonb(old_plan),'after',to_jsonb(result)));
 return to_jsonb(result);
end$$;

commit;
