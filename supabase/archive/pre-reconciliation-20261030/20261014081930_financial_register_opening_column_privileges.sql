-- Existing grants intentionally allow only specific insert columns.
-- created_by retains its auth.uid() default; RLS and role checks remain active.
grant insert(metadata) on public.liquidity_accounts to authenticated;
create or replace function public.open_financial_account(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();req uuid;scope text;org uuid;entity uuid;kind text;base text;ccy text;amt numeric;fx numeric;dt date;hawl date;a public.asset_accounts%rowtype;b public.liquidity_accounts%rowtype;payload jsonb;m jsonb;result jsonb;fp text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('request_id','scope','organization_id','entity_id','type','name','currency','opening_balance','opening_date','hawl_start_date','fx_rate','due_date','notes')) then raise exception 'FINANCIAL_ACCOUNT_INVALID';end if;
 req:=(p_payload->>'request_id')::uuid;scope:=p_payload->>'scope';org:=nullif(p_payload->>'organization_id','')::uuid;entity:=nullif(p_payload->>'entity_id','')::uuid;kind:=p_payload->>'type';ccy:=p_payload->>'currency';amt:=(p_payload->>'opening_balance')::numeric;fx:=(p_payload->>'fx_rate')::numeric;dt:=(p_payload->>'opening_date')::date;hawl:=nullif(p_payload->>'hawl_start_date','')::date;
 if req is null or scope is null or kind is null or ccy is null or scope not in('PERSONAL','ORGANIZATION') or kind not in('CASH','BANK','RECEIVABLE') or length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120 or ccy!~'^[A-Z]{3}$' or amt is null or amt<0 or amt>1e12 or amt::text in('NaN','Infinity','-Infinity') or fx is null or fx<=0 or fx>1e6 or fx::text in('NaN','Infinity','-Infinity') or dt is null or dt>(now() at time zone 'Asia/Riyadh')::date or hawl>dt or length(coalesce(p_payload->>'notes',''))>500 then raise exception 'FINANCIAL_ACCOUNT_INVALID';end if;
 if scope='PERSONAL' then
  if org is not null or entity is not null then raise exception 'FINANCIAL_ACCOUNT_SCOPE_INVALID';end if;
  select base_currency into base from public.profiles where id=uid;
 elsif scope='ORGANIZATION' then
  if org is null or kind='RECEIVABLE' then raise exception 'ORGANIZATION_DEBT_REQUIRES_FINANCIAL_CORE';end if;
  if not exists(select 1 from public.organization_members where organization_id=org and user_id=uid and status='ACTIVE' and role in('OWNER','ADMIN','ACCOUNTANT','ADVISOR')) then raise exception 'FINANCIAL_ACCOUNT_ACCESS_DENIED';end if;
  if entity is not null and not exists(select 1 from public.organization_entities where id=entity and organization_id=org) then raise exception 'FINANCIAL_ACCOUNT_ENTITY_MISMATCH';end if;
  select base_currency into base from public.organizations where id=org;
 end if;
 if base is null or (ccy=base and fx<>1) then raise exception 'FINANCIAL_ACCOUNT_FX_INVALID';end if;
 if kind='RECEIVABLE' and amt<=0 then raise exception 'RECEIVABLE_OPENING_REQUIRED';end if;
 if nullif(p_payload->>'due_date','') is not null then perform (p_payload->>'due_date')::date;end if;
 perform pg_advisory_xact_lock(hashtextextended('financial-opening:'||uid::text||req::text,0));fp:=md5(p_payload::text);
 m:=jsonb_build_object('opening_request_id',req,'opening_fingerprint',fp,'opening_date',dt,'opening_balance',amt,'opening_currency',ccy,'opening_fx_rate',fx,'entry_source','FINANCIAL_REGISTER','notes',coalesce(p_payload->>'notes',''));
 if scope='ORGANIZATION' then
  select * into b from public.liquidity_accounts where created_by=uid and metadata->>'opening_request_id'=req::text;
  if b.id is not null then if b.metadata->>'opening_fingerprint'<>fp then raise exception 'FINANCIAL_ACCOUNT_REQUEST_CONFLICT';end if;return to_jsonb(b);end if;
  insert into public.liquidity_accounts(organization_id,entity_id,name,account_type,currency,current_balance,current_balance_base,restricted_balance,restricted_balance_base,uncleared_balance,uncleared_balance_base,notes,metadata)
  values(org,entity,trim(p_payload->>'name'),kind,ccy,amt,amt*fx,0,0,0,0,coalesce(p_payload->>'notes',''),m) returning * into b;
  result:=to_jsonb(b);
 else
  select * into a from public.asset_accounts where user_id=uid and metadata->>'opening_request_id'=req::text;
  if a.id is not null then if a.metadata->>'opening_fingerprint'<>fp then raise exception 'FINANCIAL_ACCOUNT_REQUEST_CONFLICT';end if;return to_jsonb(a);end if;
  m:=m||jsonb_build_object('quantity',case when amt>0 then amt else 1 end,'purchase_value',amt,'purchase_date',dt,'fx_rate',fx,'acquisition_mode','OPENING_BALANCE','due_date',p_payload->>'due_date');
  payload:=jsonb_build_object('name',trim(p_payload->>'name'),'asset_type',kind,'currency',ccy,'ownership_scope','PERSONAL','unit','unit','is_zakatable',true,'organization_id',null,'metadata',m);
  if amt>0 then
   result:=public.create_asset_with_acquisition(payload,req);
   update public.lots set hawl_start_date=coalesce(hawl,dt),origin_hawl_start_date=coalesce(hawl,dt),zakatable_pool_entered_date=coalesce(hawl,dt) where asset_account_id=(result->>'id')::uuid and user_id=uid;
  else
   insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,unit,is_zakatable,metadata) values(uid,kind::public.asset_type,trim(p_payload->>'name'),ccy,'PERSONAL','unit',true,m) returning * into a;
   result:=to_jsonb(a);
  end if;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'financial_account',(result->>'id')::uuid,'OPEN_FINANCIAL_ACCOUNT',m||jsonb_build_object('scope',scope,'type',kind));
 return result;
end $$;
revoke all on function public.open_financial_account(jsonb) from public,anon;
grant execute on function public.open_financial_account(jsonb) to authenticated;

