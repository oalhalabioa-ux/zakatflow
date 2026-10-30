create or replace function private.investment_assert_coverage_redemption(p_contract_id uuid,p_date date)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||auth.uid()::text,0));
 if exists(select 1 from public.zakat_assessment_lines al
  join public.zakat_assessments a on a.id=al.assessment_id and a.user_id=auth.uid()
  join public.zakat_hawl_cycles cy on cy.final_assessment_id=a.id and cy.user_id=auth.uid()
  cross join lateral jsonb_array_elements(coalesce(al.valuation_snapshot->'institutionCoverage'->'intervals','[]'::jsonb)) interval
  where interval->>'contractId'=p_contract_id::text and (interval->>'to')::date>p_date)
 then raise exception 'INVESTMENT_REDEMPTION_FINAL_COVERAGE_LOCKED';end if;
end $$;
revoke all on function private.investment_assert_coverage_redemption(uuid,date) from public,anon,authenticated;

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
  if kind='REDEEM' and t->>'zakat_assessment_mode'='INSTITUTION_COVERED' then perform private.investment_assert_coverage_redemption(c.id,dt);end if;
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


create or replace function private.investment_apply_posted(p_operation_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare o public.investment_operations%rowtype;c public.investment_contracts%rowtype;m jsonb;base text;fx numeric;cost numeric;assetcost numeric;tid uuid;banktid uuid;transfer uuid:=gen_random_uuid();remaining numeric;take numeric;tq numeric;l record;gain numeric;
begin
 select * into o from public.investment_operations where id=p_operation_id for update;
 select * into c from public.investment_contracts where id=o.contract_id for update;
 if auth.uid() is null or c.id is null or(c.organization_id is null and c.user_id<>auth.uid())or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit')) then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 if o.status='POSTED' then return;end if;
 if o.status<>'APPROVED' then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
 m:=c.terms;fx:=o.exchange_rate;base:=case when c.organization_id is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=c.organization_id)end;
 if o.kind='REDEEM' and m->>'zakat_assessment_mode'='INSTITUTION_COVERED' then perform private.investment_assert_coverage_redemption(c.id,o.operation_date);end if;
 cost:=(m->>'principal')::numeric+(m->>'fees')::numeric;assetcost:=case when m->>'instrument'='DEPOSIT' then(m->>'principal')::numeric else cost end;
 if c.organization_id is not null then
  if not exists(select 1 from public.financial_events e join public.liquidity_settlements s on s.financial_event_id=e.id where e.id=o.settlement_event_id and e.status='ACTUAL' and s.status='POSTED' and s.organization_id=c.organization_id and s.account_id=o.account_id and s.amount=o.amount and s.exchange_rate=o.exchange_rate and s.currency=m->>'currency'and s.settlement_date=o.operation_date and s.direction=case when o.kind='FUND'then 'OUTFLOW'else 'INFLOW'end and exists(select 1 from public.financial_event_obligation_allocations al join public.financial_event_obligations ob on ob.id=al.obligation_id where al.application_event_id=o.settlement_event_id and ob.event_id=o.recognition_event_id and al.base_amount=o.amount*o.exchange_rate)) then raise exception 'INVESTMENT_CASH_POST_REQUIRED';end if;
  if o.kind='FUND'and(select current_balance-restricted_balance-uncleared_balance from public.liquidity_accounts where id=o.account_id)<0 then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
 else
  if o.approved_by<>auth.uid() then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
  perform 1 from public.asset_accounts a where a.id=o.account_id and a.user_id=c.user_id and a.ownership_scope='PERSONAL' and a.asset_type in('BANK','CASH') and a.currency=m->>'currency' for update;
  if not found then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
  if o.kind='FUND' then
   perform 1 from public.lots where asset_account_id=o.account_id and remaining_value_base>0 order by id for update;
   remaining:=o.amount*fx;
   if coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=o.account_id and user_id=c.user_id and acquisition_date<=o.operation_date and remaining_quantity>0),0)<remaining then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
   insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
   values(c.user_id,o.account_id,'TRANSFER_OUT',o.operation_date,0,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx),auth.uid()) returning id into banktid;
  else
   insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
   values(c.user_id,o.account_id,case when o.kind='INCOME' then 'ADD'::public.transaction_type else 'TRANSFER_IN'::public.transaction_type end,o.operation_date,o.amount,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx),auth.uid()) returning id into banktid;
   if o.kind='INCOME' then
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,o.account_id,banktid,o.operation_date,o.operation_date,o.operation_date,o.operation_date,o.amount,o.amount,o.amount*fx,o.amount*fx,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id));
   end if;
  end if;
 end if;
 if o.kind='FUND' then
  if c.status<>'DRAFT' then raise exception 'INVESTMENT_ALREADY_FUNDED';end if;
  insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,reference,metadata,created_by)
  values(c.user_id,c.asset_account_id,c.organization_id,nullif(m->>'entity_id','')::uuid,case when m->>'instrument'='DEPOSIT' then 'TRANSFER_IN'::public.transaction_type else 'PURCHASE'::public.transaction_type end,o.operation_date,1,m->>'currency',assetcost,base,assetcost*fx,transfer,m->>'reference',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx,'asset_effect_base',assetcost*fx),auth.uid())returning id into tid;
  if c.organization_id is null then
   for l in select * from public.lots where asset_account_id=o.account_id and user_id=c.user_id and remaining_quantity>0 and remaining_value_base>0 and acquisition_date<=o.operation_date order by acquisition_date,created_at,id for update loop
    exit when remaining<=0;take:=least(remaining,l.remaining_value_base);tq:=l.remaining_quantity*take/l.remaining_value_base;
    insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)values(c.user_id,banktid,l.id,tq,take,'FIFO');
    update public.lots set remaining_quantity=greatest(0,remaining_quantity-tq),remaining_value_base=greatest(0,remaining_value_base-take),status=case when take=l.remaining_value_base then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=l.id;
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,hawl_continuity_source_lot_id,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,c.asset_account_id,tid,o.operation_date,l.hawl_start_date,coalesce(l.origin_hawl_start_date,l.hawl_start_date),l.zakatable_pool_entered_date,l.id,take/(o.amount*fx),take/(o.amount*fx),take*assetcost/cost,take*assetcost/cost,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'base_currency',base));
    remaining:=remaining-take;
   end loop;
   if remaining>0 then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
   update public.transactions set quantity=(select sum(quantity)from public.transaction_allocations where transaction_id=banktid)where id=banktid;
  else
   insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
   values(c.user_id,c.asset_account_id,tid,o.operation_date,1,1,assetcost*fx,assetcost*fx,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'base_currency',base));
  end if;
  update public.investment_contracts set status='ACTIVE',updated_at=now()where id=c.id;
  update public.asset_accounts set metadata=metadata||jsonb_build_object('investment_status','ACTIVE')where id=c.asset_account_id;
 elsif o.kind='REDEEM' then
  if c.status<>'ACTIVE' then raise exception 'INVESTMENT_NOT_ACTIVE';end if;
  perform 1 from public.lots where asset_account_id=c.asset_account_id order by id for update;
  gain:=o.amount*fx-coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=c.asset_account_id),0);
  insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
  values(c.user_id,c.asset_account_id,c.organization_id,nullif(m->>'entity_id','')::uuid,'TRANSFER_OUT',o.operation_date,1,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'asset_effect_base',-coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=c.asset_account_id),0),'realized_gain_base',gain,'fx_rate',fx),auth.uid())returning id into tid;
  for l in select * from public.lots where asset_account_id=c.asset_account_id and remaining_quantity>0 for update loop
   insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)values(c.user_id,tid,l.id,l.remaining_quantity,l.remaining_value_base,'FIFO');
   if c.organization_id is null then
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,hawl_continuity_source_lot_id,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,o.account_id,banktid,o.operation_date,l.hawl_start_date,coalesce(l.origin_hawl_start_date,l.hawl_start_date),l.zakatable_pool_entered_date,l.id,o.amount*l.remaining_quantity,o.amount*l.remaining_quantity,o.amount*fx*l.remaining_quantity,o.amount*fx*l.remaining_quantity,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id));
   end if;
   update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED'where id=l.id;
  end loop;
  update public.investment_contracts set status='CLOSED',updated_at=now()where id=c.id;
  update public.asset_accounts set metadata=metadata||jsonb_build_object('investment_status','CLOSED')where id=c.asset_account_id;
 end if;
 if c.organization_id is not null then update public.liquidity_flows set status='ACTUAL'where id=o.flow_id;end if;
 update public.investment_operations set status='POSTED',posted_by=auth.uid(),posted_at=now()where id=o.id;
 perform private.investment_refresh_forecasts(c.id);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(auth.uid(),'investment',c.id,'INVESTMENT_'||o.kind,jsonb_build_object('operation_id',o.id,'amount',o.amount,'currency',m->>'currency','date',o.operation_date));
end $$;
revoke all on function private.investment_apply_posted(uuid) from public,anon,authenticated;


