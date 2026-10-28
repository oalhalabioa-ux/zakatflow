-- QA only: hardened owner plan edits. Never run on Production without review.
create or replace function public.owner_upsert_plan(p_code text,p_name_ar text,p_price numeric,p_currency text,p_interval text,p_active boolean default true,p_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_code text;
begin
 if auth.uid() is null or not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_code is null or p_name_ar is null or p_price is null or p_currency is null or p_interval is null or p_active is null then raise exception 'missing plan parameters' using errcode='22023'; end if;
 v_code:=lower(trim(p_code));
 if v_code !~ '^[a-z0-9_-]{2,40}$' or length(trim(p_name_ar)) not between 2 and 120 or p_price='NaN'::numeric or p_price<0 or p_price>100000000 or p_price<>round(p_price,2) or p_currency !~ '^[A-Z]{3}$' or p_interval not in ('monthly','yearly') then raise exception 'invalid plan parameters' using errcode='22023'; end if;
 if p_id is null then
  insert into public.platform_plans(code,name_ar,price_amount,currency,billing_interval,is_active) values(v_code,trim(p_name_ar),p_price,p_currency,p_interval,p_active) returning id into v_id;
 else
  if exists(select 1 from public.platform_subscriptions where plan_id=p_id) and exists(select 1 from public.platform_plans where id=p_id and (price_amount is distinct from p_price or currency is distinct from p_currency or billing_interval is distinct from p_interval)) then raise exception 'plan has subscriptions: create a new price version' using errcode='23514'; end if;
  update public.platform_plans set code=v_code,name_ar=trim(p_name_ar),price_amount=p_price,currency=p_currency,billing_interval=p_interval,is_active=p_active where id=p_id returning id into v_id;
  if v_id is null then raise exception 'plan not found' using errcode='P0002'; end if;
 end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),case when p_id is null then 'plan.created' else 'plan.updated' end,'plan',v_id,jsonb_build_object('code',v_code,'currency',p_currency,'billing_interval',p_interval,'is_active',p_active));
 return v_id;
end $$;
revoke all on function public.owner_upsert_plan(text,text,numeric,text,text,boolean,uuid) from public,anon;
grant execute on function public.owner_upsert_plan(text,text,numeric,text,text,boolean,uuid) to authenticated;
