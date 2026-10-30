create or replace function private.investment_save(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
  if p_request_id is null then raise exception 'INVESTMENT_REQUEST_REQUIRED';end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
  select * into c from public.investment_contracts where user_id=uid and request_id=p_request_id;
  if c.id is not null then if c.terms<>p_payload then raise exception 'INVESTMENT_REQUEST_CONFLICT';end if;return to_jsonb(c);end if;
  t:=p_payload;if not(t ?& array['name','instrument','ownership_scope','party_name','currency','principal','face_value','fees','annual_rate','start_date','maturity_date','interest_basis','zakat_basis','zakat_rate','zakat_base','zakat_treatment','inflation_rate','fx_rate','funding_account_id'])then raise exception 'INVESTMENT_TERMS_INVALID';end if;org:=nullif(t->>'organization_id','')::uuid;
  if coalesce(jsonb_typeof(t),'null')<>'object'or exists(select 1 from jsonb_object_keys(t)k where k not in('name','instrument','ownership_scope','organization_id','entity_id','cost_center_id','party_name','currency','principal','face_value','fees','annual_rate','start_date','maturity_date','interest_basis','zakat_basis','zakat_rate','zakat_base','zakat_treatment','inflation_rate','fx_rate','funding_account_id','reference','notes'))then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  foreach kind in array array['name','instrument','ownership_scope','party_name','currency','start_date','maturity_date','interest_basis','zakat_basis','zakat_treatment','funding_account_id']loop
   if coalesce(jsonb_typeof(t->kind),'null')<>'string'then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  end loop;
  foreach kind in array array['principal','face_value','fees','annual_rate','zakat_rate','zakat_base','inflation_rate','fx_rate']loop
   if coalesce(jsonb_typeof(t->kind),'null')<>'number'then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  end loop;
  if(t ? 'reference'and(jsonb_typeof(t->'reference')<>'string'or length(t->>'reference')>200))or(t ? 'notes'and(jsonb_typeof(t->'notes')<>'string'or length(t->>'notes')>2000))or(t->>'start_date')!~'^\d{4}-\d{2}-\d{2}$'or(t->>'maturity_date')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  if t->>'ownership_scope'='ORGANIZATION' then
   if org is null or not public.has_organization_permission(org,'assets.edit') then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
   select base_currency into base from public.organizations where id=org;
   if not exists(select 1 from public.liquidity_accounts a where a.id=(t->>'funding_account_id')::uuid and a.organization_id=org and a.currency=t->>'currency' and a.active and a.account_type in('BANK','CASH','WALLET'))then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
   if nullif(t->>'entity_id','')is not null and not exists(select 1 from public.organization_entities e where e.id=(t->>'entity_id')::uuid and e.organization_id=org)then raise exception 'INVESTMENT_ENTITY_SCOPE_MISMATCH';end if;
   if nullif(t->>'cost_center_id','')is not null and not exists(select 1 from public.organization_cost_centers e where e.id=(t->>'cost_center_id')::uuid and e.organization_id=org)then raise exception 'INVESTMENT_CENTER_SCOPE_MISMATCH';end if;
  elsif t->>'ownership_scope'='PERSONAL' and org is null and nullif(t->>'entity_id','')is null and nullif(t->>'cost_center_id','')is null then
   select base_currency into base from public.profiles where id=uid;
   if t->>'currency'<>base then raise exception 'PERSONAL_INVESTMENT_BASE_CURRENCY_REQUIRED';end if;
   if not exists(select 1 from public.asset_accounts a where a.id=(t->>'funding_account_id')::uuid and a.user_id=uid and a.ownership_scope='PERSONAL' and a.currency=t->>'currency' and a.asset_type in('BANK','CASH'))then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
  else raise exception 'INVESTMENT_SCOPE_INVALID';end if;
  if t->>'instrument'not in('DEPOSIT','BOND','SUKUK')or t->>'interest_basis'not in('ACT_365','ACT_360')or t->>'zakat_basis'not in('HIJRI_354','HIJRI_TABULAR')or t->>'zakat_treatment'not in('INVESTOR','DEDUCTED','COVERED')or t->>'currency'!~'^[A-Z]{3}$'or length(trim(t->>'name'))not between 1 and 120 or length(trim(t->>'party_name'))not between 1 and 160 then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  foreach kind in array array['principal','face_value','fees','annual_rate','zakat_rate','zakat_base','inflation_rate','fx_rate']loop
   val:=(t->>kind)::numeric;if val is null or val::text in('NaN','Infinity','-Infinity')or abs(val)>1e12 then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  end loop;
  if(t->>'principal')::numeric<=0 or(t->>'face_value')::numeric<=0 or(t->>'fees')::numeric<0 or(t->>'annual_rate')::numeric not between 0 and 100 or(t->>'zakat_rate')::numeric not between 0 and 100 or(t->>'zakat_base')::numeric<0 or(t->>'inflation_rate')::numeric not between -99 and 1000 or((t->>'fx_rate')::numeric<=0 or(t->>'fx_rate')::numeric>1e6) or(t->>'maturity_date')::date<=(t->>'start_date')::date or(t->>'maturity_date')::date-(t->>'start_date')::date>18250 then raise exception 'INVESTMENT_TERMS_INVALID';end if;
  if t->>'instrument'='DEPOSIT' and(t->>'face_value')::numeric<>(t->>'principal')::numeric then raise exception 'DEPOSIT_FACE_MUST_EQUAL_PRINCIPAL';end if;
  if t->>'currency'=base and(t->>'fx_rate')::numeric<>1 then raise exception 'INVESTMENT_BASE_FX_MUST_BE_ONE';end if;
  insert into public.investment_contracts(user_id,organization_id,terms,request_id)values(uid,org,t,p_request_id)returning * into c;
  insert into public.asset_accounts(user_id,organization_id,entity_id,cost_center_id,ownership_scope,asset_type,name,currency,unit,is_zakatable,asset_class_code,asset_type_code,metadata)
  values(uid,org,nullif(t->>'entity_id','')::uuid,nullif(t->>'cost_center_id','')::uuid,t->>'ownership_scope','OTHER',t->>'name',t->>'currency','unit',true,case when t->>'instrument'='DEPOSIT'then 'FINANCIAL'else 'INVESTMENT'end,case when t->>'instrument'='DEPOSIT'then 'DEPOSIT'when t->>'instrument'='BOND'then 'BOND'else 'SUKUK_BOND'end,jsonb_build_object('investment_id',c.id,'investment_status','DRAFT','acquisition_mode','INVESTMENT','quantity',1,'purchase_value',(t->>'principal')::numeric,'purchase_date',t->>'start_date','fx_rate',(t->>'fx_rate')::numeric,'market_value',(t->>'principal')::numeric+case when t->>'instrument'='DEPOSIT'then 0 else(t->>'fees')::numeric end))returning id into aid;
  update public.investment_contracts set asset_account_id=aid where id=c.id returning * into c;return to_jsonb(c);
end $$;
revoke all on function private.investment_save(text,uuid,jsonb,uuid)from public,anon,authenticated;

