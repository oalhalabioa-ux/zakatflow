create or replace function private.investment_prepare(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;

  if p_request_id is null then raise exception 'INVESTMENT_REQUEST_REQUIRED';end if;
  withheld:=coalesce((p_payload->>'withheld_zakat')::numeric,0);kind:=p_payload->>'kind';v_amount:=(p_payload->>'amount')::numeric;fx:=(p_payload->>'fx_rate')::numeric;dt:=(p_payload->>'date')::date;aid:=(p_payload->>'account_id')::uuid;
  if kind not in('FUND','INCOME','REDEEM')or v_amount is null or v_amount<=0 or v_amount>1e12 or v_amount::text in('NaN','Infinity','-Infinity')or fx is null or fx<=0 or fx>1e6 or fx::text in('NaN','Infinity','-Infinity')or dt is null or length(trim(p_payload->>'notes'))not between 1 and 2000 then raise exception 'INVESTMENT_OPERATION_INVALID';end if;
  if withheld<0 or withheld::text in('NaN','Infinity','-Infinity')or withheld>1e12 or(withheld>0 and(kind<>'INCOME'or t->>'zakat_treatment'<>'DEDUCTED'))then raise exception 'INVESTMENT_WITHHELD_ZAKAT_INVALID';end if;
  select * into o from public.investment_operations where user_id=uid and request_id=p_request_id;
  if o.id is not null then if o.contract_id<>c.id or o.kind<>kind or o.account_id<>aid or o.amount<>v_amount or o.exchange_rate<>fx or o.operation_date<>dt or o.withheld_zakat<>withheld or o.notes<>p_payload->>'notes'then raise exception 'INVESTMENT_REQUEST_CONFLICT';end if;return to_jsonb(o);end if;
  if kind='FUND'and(c.status<>'DRAFT'or v_amount<>(t->>'principal')::numeric+(t->>'fees')::numeric or dt<>(t->>'start_date')::date or aid<>(t->>'funding_account_id')::uuid or fx<>(t->>'fx_rate')::numeric)then raise exception 'INVESTMENT_FUNDING_TERMS_MISMATCH';end if;
  if kind='INCOME'and(c.status not in('ACTIVE','CLOSED')or(dt<(t->>'maturity_date')::date and c.status<>'CLOSED'))then raise exception 'INVESTMENT_INCOME_REQUIRES_MATURITY';end if;
  if kind='REDEEM'and(c.status<>'ACTIVE'or dt<(t->>'start_date')::date or v_amount>(t->>'face_value')::numeric)then raise exception 'INVESTMENT_REDEMPTION_INVALID';end if;
  if dt>current_date then raise exception 'INVESTMENT_EXECUTION_DATE_IN_FUTURE';end if;
  if t->>'currency'=base and fx<>1 then raise exception 'INVESTMENT_BASE_FX_MUST_BE_ONE';end if;
  if org is null then
   if not exists(select 1 from public.asset_accounts a where a.id=aid and a.user_id=uid and a.ownership_scope='PERSONAL'and a.currency=t->>'currency'and a.asset_type in('BANK','CASH'))then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
  else
   if not public.has_organization_permission(org,'liquidity.edit')or not public.financial_core_can(org,'financial_core.create')then raise exception 'INVESTMENT_FINANCIAL_CREATE_DENIED';end if;
   if not exists(select 1 from public.liquidity_accounts a where a.id=aid and a.organization_id=org and a.active and a.currency=t->>'currency'and a.account_type in('BANK','CASH','WALLET'))then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
  end if;
  insert into public.investment_operations(contract_id,user_id,organization_id,kind,operation_date,account_id,amount,exchange_rate,notes,request_id,withheld_zakat)values(c.id,uid,org,kind,dt,aid,v_amount,fx,p_payload->>'notes',p_request_id,withheld)returning * into o;
  if org is not null then
   classtype:=case when kind='INCOME'then 'REVENUE'when kind='FUND'and t->>'instrument'<>'DEPOSIT'then 'INVESTMENT'else 'TRANSFER'end;
   classcode:=case when kind='INCOME'then 'INVESTMENT_YIELD'when kind='FUND'and t->>'instrument'<>'DEPOSIT'then 'INVESTMENT_SECURITIES'else 'INVESTMENT_CAPITAL_TRANSFER'end;
   insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(org,classcode,case when kind='INCOME'then 'عوائد الاستثمارات'when classtype='INVESTMENT'then 'شراء أدوات استثمارية'else 'تحويل رأس مال الاستثمارات'end,classtype,true,uid)on conflict(organization_id,code)do nothing;
   select id into classid from public.financial_classifications where organization_id=org and code=classcode and active and classification_type=classtype;
   if classid is null then raise exception 'INVESTMENT_FINANCIAL_CLASSIFICATION_REQUIRED';end if;
   cost:=(t->>'principal')::numeric+(t->>'fees')::numeric;book:=case when t->>'instrument'='DEPOSIT'then(t->>'principal')::numeric else cost end;
   if kind='REDEEM'then book:=coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=c.asset_account_id),book*(t->>'fx_rate')::numeric)/fx;end if;
   val:=case when kind='FUND'and t->>'instrument'='DEPOSIT'then(t->>'principal')::numeric when kind='REDEEM'then book when kind='INCOME'then v_amount+withheld else v_amount end;
   lines:=jsonb_build_array(jsonb_build_object('line_number',1,'description',t->>'name','classification_id',classid,'cost_center_id',nullif(t->>'cost_center_id','')::uuid,'amount',val,'currency',t->>'currency','exchange_rate',fx,'base_amount',val*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
   delta:=case when kind='FUND'and t->>'instrument'='DEPOSIT'then-(t->>'fees')::numeric when kind='REDEEM'then v_amount-book else 0 end;
   if delta<>0 then
    classcode:=case when delta>0 then 'INVESTMENT_CAPITAL_GAIN'else 'INVESTMENT_FEES_LOSS'end;classtype:=case when delta>0 then 'REVENUE'else 'OPEX'end;
    insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(org,classcode,case when delta>0 then 'أرباح استرداد الاستثمارات'else 'رسوم وخسائر الاستثمارات'end,classtype,true,uid)on conflict(organization_id,code)do nothing;
    select id into extraid from public.financial_classifications where organization_id=org and code=classcode and active and classification_type=classtype;
    if extraid is null then raise exception 'INVESTMENT_GAIN_FEE_CLASSIFICATION_REQUIRED';end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('line_number',2,'description','Investment fee / realized gain-loss','classification_id',extraid,'cost_center_id',nullif(t->>'cost_center_id','')::uuid,'amount',abs(delta),'currency',t->>'currency','exchange_rate',fx,'base_amount',abs(delta)*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
   end if;
   if withheld>0 then
    insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(org,'INVESTMENT_WITHHELD_ZAKAT','زكاة محجوزة من عوائد الاستثمار','ZAKAT',true,uid)on conflict(organization_id,code)do nothing;
    select id into extraid from public.financial_classifications where organization_id=org and code='INVESTMENT_WITHHELD_ZAKAT'and classification_type='ZAKAT'and active;if extraid is null then raise exception 'INVESTMENT_FINANCIAL_CLASSIFICATION_REQUIRED';end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('line_number',jsonb_array_length(lines)+1,'description','Bank withheld zakat / statement: '||o.notes,'classification_id',extraid,'cost_center_id',nullif(t->>'cost_center_id','')::uuid,'amount',withheld,'currency',t->>'currency','exchange_rate',fx,'base_amount',withheld*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
   end if;
   rid:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',nullif(t->>'entity_id','')::uuid,'counterparty_id',null,'event_type',case when kind='INCOME'then 'REVENUE'when kind='FUND'and t->>'instrument'<>'DEPOSIT'then 'ASSET_PURCHASE'else 'TRANSFER'end,'source_module','INVESTMENTS','source_record_id',o.id,'source_event_key','investment:'||o.id||':recognition','event_date',dt,'due_date',dt,'base_currency',base,'description',kind||' / '||(t->>'name'),'lines',lines,'obligations',jsonb_build_array(jsonb_build_object('obligation_key','investment-cash','obligation_type',case when kind='FUND'then 'PAYABLE'else 'RECEIVABLE'end,'settleable_amount',v_amount,'currency',t->>'currency','exchange_rate',fx,'base_currency',base,'settleable_base_amount',v_amount*fx)),'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','investment_operations','target_record_id',o.id,'metadata','{}'::jsonb))));
   select id into fid from public.liquidity_flows where organization_id=org and source_module='INVESTMENTS'and source_event_key='investment:'||c.id||':forecast:'||kind and settled_amount=0 for update;
   if fid is null then
    insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
    values(org,nullif(t->>'entity_id','')::uuid,aid,case when kind='FUND'then 'OUTFLOW'else 'INFLOW'end,'INVESTMENT',kind||' / '||(t->>'name'),t->>'party_name',dt,v_amount,t->>'currency',v_amount*fx,'EXPECTED','MANUAL',t->>'reference','INVESTMENTS',o.id,'investment:'||o.id||':cash')returning id into fid;
   else update public.liquidity_flows set amount=v_amount,base_amount=v_amount*fx,due_date=dt,account_id=aid,source_record_id=o.id,title=kind||' / '||(t->>'name')where id=fid;end if;
   insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata)values(rid,org,'CASH_FLOW','liquidity_flows',fid,'{}');
   sid:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',nullif(t->>'entity_id','')::uuid,'counterparty_id',null,'event_type','SETTLEMENT','source_module','INVESTMENTS','source_record_id',o.id,'source_event_key','investment:'||o.id||':settlement','event_date',dt,'due_date',dt,'base_currency',base,'description','Cash / '||kind||' / '||(t->>'name'),'lines',jsonb_build_array(jsonb_build_object('line_number',1,'description',t->>'name','classification_id',classid,'cost_center_id',nullif(t->>'cost_center_id','')::uuid,'amount',v_amount,'currency',t->>'currency','exchange_rate',fx,'base_amount',v_amount*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',rid,'metadata','{}'::jsonb))));
   perform public.transition_financial_event(rid,'PLANNED','Investment preparation');perform public.transition_financial_event(rid,'COMMITTED','Investment submitted');perform public.transition_financial_event(sid,'PLANNED','Investment cash preparation');perform public.transition_financial_event(sid,'COMMITTED','Investment cash submitted');
   update public.investment_operations set recognition_event_id=rid,settlement_event_id=sid,flow_id=fid where id=o.id returning * into o;
  end if;
  return to_jsonb(o);

end $$;
revoke all on function private.investment_prepare(text,uuid,jsonb,uuid)from public,anon,authenticated;

