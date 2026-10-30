-- Direction is explicit; existing incoming contracts keep their original treatment.
alter table public.participation_contracts add column direction text not null default 'INCOMING' check(direction in('INCOMING','OUTGOING'));
alter table public.participation_contracts add column deleted_at timestamptz;
alter table public.debt_contracts add column deleted_at timestamptz;
CREATE OR REPLACE FUNCTION private.create_participation_contract(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare uid uuid:=auth.uid();org uuid:=(p->>'organization_id')::uuid;req uuid:=(p->>'request_id')::uuid;prior public.participation_contracts%rowtype;capital numeric:=(p->>'capital')::numeric;fx numeric:=(p->>'exchange_rate')::numeric;profit numeric:=(p->>'investor_profit_pct')::numeric;loss numeric:=(p->>'investor_loss_pct')::numeric;start_dt date:=(p->>'start_date')::date;maturity date:=nullif(p->>'maturity_date','')::date;base text;new_id uuid;fp text:=md5(p::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 if coalesce(p->>'direction','INCOMING') not in('INCOMING','OUTGOING') then raise exception 'PARTICIPATION_DIRECTION_INVALID';end if;
 if req is null or capital is null or capital<=0 or capital>1e12 or capital<>round(capital,4)or capital::text in('NaN','Infinity','-Infinity')or fx is null or fx<=0 or fx>1e6 or fx::text in('NaN','Infinity','-Infinity')or profit is null or profit<=0 or profit>100 or profit::text in('NaN','Infinity','-Infinity')or loss is null or loss<=0 or loss>100 or loss::text in('NaN','Infinity','-Infinity')or start_dt is null or maturity<start_dt or(p->>'currency')!~'^[A-Z]{3}$'or p->>'capital_treatment'is null or p->>'capital_treatment'not in('FINANCING','EQUITY')or p->>'variable_return'is distinct from 'true'or length(trim(coalesce(p->>'reference','')))not between 1 and 120 or length(trim(coalesce(p->>'description','')))not between 3 and 500 or length(trim(coalesce(p->>'project','')))not between 3 and 160 or length(trim(coalesce(p->>'accounting_basis','')))not between 15 and 1000 or length(trim(coalesce(p->>'exit_terms','')))not between 15 and 1000 or length(trim(coalesce(p->>'loss_terms','')))not between 15 and 1000 then raise exception 'PARTICIPATION_TERMS_INVALID';end if;
 select base_currency into base from public.organizations where id=org;if base is null or(p->>'currency'=base and fx<>1)then raise exception 'PARTICIPATION_CURRENCY_INVALID';end if;
 if not exists(select 1 from public.liquidity_counterparties where id=(p->>'counterparty_id')::uuid and organization_id=org and active)or(nullif(p->>'entity_id','')is not null and not exists(select 1 from public.organization_entities where id=(p->>'entity_id')::uuid and organization_id=org and active))then raise exception 'PARTICIPATION_SCOPE_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|PARTICIPATION_CREATE|'||req::text,0));select * into prior from public.participation_contracts where organization_id=org and request_id=req;
 if prior.id is not null then if prior.payload_fingerprint<>fp then raise exception 'PARTICIPATION_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'replay',true);end if;
 insert into public.participation_contracts(organization_id,request_id,counterparty_id,entity_id,reference,description,project,capital,currency,exchange_rate,start_date,maturity_date,investor_profit_pct,investor_loss_pct,capital_treatment,accounting_basis,exit_terms,loss_terms,payload_fingerprint,created_by,direction)
 values(org,req,(p->>'counterparty_id')::uuid,nullif(p->>'entity_id','')::uuid,trim(p->>'reference'),trim(p->>'description'),trim(p->>'project'),capital,p->>'currency',fx,start_dt,maturity,profit,loss,p->>'capital_treatment',trim(p->>'accounting_basis'),trim(p->>'exit_terms'),trim(p->>'loss_terms'),fp,uid,coalesce(p->>'direction','INCOMING'))returning participation_contracts.id into new_id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'participation_contract',new_id,'CREATE',p);return jsonb_build_object('id',new_id,'state','DRAFT');
end $function$
;
CREATE OR REPLACE FUNCTION private.prepare_participation_movement(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare c public.participation_contracts%rowtype;uid uuid:=auth.uid();req uuid:=(p->>'request_id')::uuid;kind text:=p->>'kind';dt date:=(p->>'date')::date;pf date:=nullif(p->>'period_from','')::date;pt date:=nullif(p->>'period_to','')::date;
 amt numeric:=(p->>'amount')::numeric;profit_base numeric:=nullif(p->>'period_result','')::numeric;received numeric;reserved numeric;capital_committed numeric;prior public.participation_movements%rowtype;fp text:=md5(p::text);base text;cls uuid;eid uuid;cash uuid;flow uuid;mid uuid:=gen_random_uuid();obligations jsonb:='[]';account public.liquidity_accounts%rowtype;class_code text;class_type text;event_type text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.participation_contracts where id=(p->>'contract_id')::uuid;
 if c.id is null or c.organization_id is distinct from(p->>'organization_id')::uuid or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.create')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|PARTICIPATION_CONTRACT|'||c.id,0));
 select * into prior from public.participation_movements where organization_id=c.organization_id and request_id=req;
 if prior.id is not null then if prior.payload_fingerprint<>fp then raise exception 'PARTICIPATION_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'replay',true);end if;
 if c.deleted_at is not null or c.state in('CANCELLED','CLOSED')or req is null or kind is null or kind not in('CAPITAL_RECEIPT','CAPITAL_RETURN','PROFIT','LOSS')or dt is null or dt<c.start_date or dt>(now()at time zone 'Asia/Riyadh')::date or length(trim(coalesce(p->>'reason','')))not between 15 and 500 then raise exception 'PARTICIPATION_MOVEMENT_INVALID';end if;
 if exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL'and m.event_date>dt)then raise exception 'PARTICIPATION_MOVEMENT_CHRONOLOGY';end if;
 if kind='CAPITAL_RECEIPT'and c.maturity_date is not null and dt>c.maturity_date then raise exception 'PARTICIPATION_MATURED_NO_NEW_CAPITAL';end if;
 if kind in('PROFIT','LOSS')then
  if profit_base is null or profit_base<=0 or profit_base>1e12 or profit_base::text in('NaN','Infinity','-Infinity')or profit_base<>round(profit_base,4)or pf is null or pt is null or pf<c.start_date or pt<pf or pt>dt then raise exception 'PARTICIPATION_PERIOD_INVALID';end if;
  if exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and m.kind in('PROFIT','LOSS')and e.status not in('CANCELLED','REVERSED')and daterange(m.period_from,m.period_to,'[]')&&daterange(pf,pt,'[]'))then raise exception 'PARTICIPATION_PERIOD_ALREADY_DECLARED';end if;
  amt:=round(profit_base*(case when kind='PROFIT'then c.investor_profit_pct else c.investor_loss_pct end)/100,4);
 end if;
 if amt is null or amt<=0 or amt>1e12 or amt<>round(amt,4)or amt::text in('NaN','Infinity','-Infinity')then raise exception 'PARTICIPATION_AMOUNT_INVALID';end if;
 select coalesce(sum(m.amount)filter(where m.kind='CAPITAL_RECEIPT'and e.status='ACTUAL'),0),coalesce(sum(m.amount)filter(where m.kind in('CAPITAL_RETURN','LOSS')and e.status not in('CANCELLED','REVERSED')),0),coalesce(sum(m.amount)filter(where m.kind='CAPITAL_RECEIPT'and e.status not in('CANCELLED','REVERSED')),0)into received,reserved,capital_committed from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id;
 if kind='CAPITAL_RECEIPT'and capital_committed+amt>c.capital then raise exception 'PARTICIPATION_CAPITAL_EXCEEDED';end if;
 if kind in('CAPITAL_RETURN','LOSS')and amt>received-reserved then raise exception 'PARTICIPATION_AVAILABLE_CAPITAL_EXCEEDED';end if;
 if kind in('PROFIT','LOSS')and pf<(select min(m.event_date)from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and m.kind='CAPITAL_RECEIPT'and e.status='ACTUAL')then raise exception 'PARTICIPATION_PERIOD_BEFORE_CAPITAL';end if;
 if kind in('PROFIT','LOSS')and received<=0 then raise exception 'PARTICIPATION_CAPITAL_NOT_RECEIVED';end if;
 select base_currency into base from public.organizations where id=c.organization_id;
 class_type:=case when c.direction='OUTGOING' then case when kind='PROFIT' then 'REVENUE' when kind='LOSS' then 'OPEX' else 'CAPEX' end else case when kind='PROFIT'and c.capital_treatment='FINANCING'then 'OPEX'when kind='LOSS'and c.capital_treatment='FINANCING'then 'REVENUE'else c.capital_treatment end end;
 class_code:='PARTICIPATION_'||c.direction||'_'||case when kind='PROFIT'then 'PROFIT_'when kind='LOSS'then 'LOSS_'else 'CAPITAL_'end||c.capital_treatment;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(c.organization_id,class_code,case when kind='PROFIT'then 'أرباح مستثمر معتمدة'else 'رأس مال مشاركة'end,class_type,true,uid)on conflict(organization_id,code)do nothing;
 select id into cls from public.financial_classifications where organization_id=c.organization_id and code=class_code and classification_type=class_type and active;
 if cls is null then raise exception 'PARTICIPATION_CLASSIFICATION_REQUIRED';end if;
 if kind in('CAPITAL_RETURN','PROFIT')then obligations:=jsonb_build_array(jsonb_build_object('obligation_key',lower(kind),'obligation_type',case when c.direction='OUTGOING' then 'RECEIVABLE' else 'PAYABLE' end,'settleable_amount',amt,'currency',c.currency,'exchange_rate',c.exchange_rate,'base_currency',base,'settleable_base_amount',round(amt*c.exchange_rate,4)));end if;
 event_type:=case when c.direction='OUTGOING' then case when kind='CAPITAL_RECEIPT' then 'ASSET' when kind='PROFIT' then 'REVENUE' when kind='LOSS' then 'EXPENSE' else 'ADJUSTMENT' end else case when kind='CAPITAL_RECEIPT'and c.capital_treatment='FINANCING'then 'LIABILITY'when kind='PROFIT'and c.capital_treatment='FINANCING'then 'EXPENSE'when kind='LOSS'and c.capital_treatment='FINANCING'then 'REVENUE'else 'ADJUSTMENT'end end;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',c.organization_id,'entity_id',c.entity_id,'counterparty_id',c.counterparty_id,'event_type',event_type,'source_module','PARTICIPATION','source_record_id',c.id,'source_event_key','participation:'||mid,'event_date',dt,'due_date',case when kind in('CAPITAL_RETURN','PROFIT')then dt else null end,'base_currency',base,'description',c.reference||' · '||kind||' · '||trim(p->>'reason'),'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description',trim(p->>'reason'),'amount',amt,'currency',c.currency,'exchange_rate',c.exchange_rate,'base_amount',round(amt*c.exchange_rate,4),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',obligations,'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','participation_contracts','target_record_id',c.id))));
 perform public.transition_financial_event(eid,'PLANNED','Participation movement prepared');perform public.transition_financial_event(eid,'COMMITTED','Awaiting participation approval');
 if kind='CAPITAL_RECEIPT'then
  if not public.effective_organization_permission(c.organization_id,'liquidity.edit',null,null)then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
  select * into account from public.liquidity_accounts where id=(p->>'account_id')::uuid and organization_id=c.organization_id and active;
  if account.id is null or account.currency<>c.currency or(account.entity_id is not null and account.entity_id is distinct from c.entity_id)then raise exception 'PARTICIPATION_ACCOUNT_MISMATCH';end if;
  insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
  values(c.organization_id,c.entity_id,account.id,case when c.direction='OUTGOING' then 'OUTFLOW' else 'INFLOW' end,case when c.direction='OUTGOING' then 'INVESTMENT' else 'FINANCING' end,case when c.direction='OUTGOING' then 'تمويل استثمار خارجي · ' else 'استلام رأس مال مشاركة · ' end||c.reference,c.counterparty_id,dt,amt,c.currency,round(amt*c.exchange_rate,4),'CONFIRMED','MANUAL',c.reference,'PARTICIPATION',c.id,'participation-receipt:'||mid)returning id into flow;
  insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id)values(eid,c.organization_id,'CASH_FLOW','liquidity_flows',flow);
  cash:=public.create_financial_event_command(jsonb_build_object('organization_id',c.organization_id,'entity_id',c.entity_id,'counterparty_id',c.counterparty_id,'event_type','SETTLEMENT','source_module','PARTICIPATION','source_record_id',c.id,'source_event_key','participation-cash:'||mid,'event_date',dt,'due_date',null,'base_currency',base,'description',case when c.direction='OUTGOING' then 'صرف تمويل استثمار خارجي · ' else 'قبض رأس مال مشاركة · ' end||c.reference,'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description',trim(p->>'reason'),'amount',amt,'currency',c.currency,'exchange_rate',c.exchange_rate,'base_amount',round(amt*c.exchange_rate,4),'cash_direction',case when c.direction='OUTGOING' then 'OUTFLOW' else 'INFLOW' end,'vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',eid))));
  perform public.transition_financial_event(cash,'PLANNED','Participation cash receipt prepared');perform public.transition_financial_event(cash,'COMMITTED','Awaiting receipt approval');
 end if;
 insert into public.participation_movements(id,organization_id,contract_id,request_id,kind,amount,period_result,period_from,period_to,event_date,account_id,recognition_event_id,cash_event_id,flow_id,reason,payload_fingerprint,created_by)
 values(mid,c.organization_id,c.id,req,kind,amt,case when kind in('PROFIT','LOSS')then profit_base end,case when kind in('PROFIT','LOSS')then pf end,case when kind in('PROFIT','LOSS')then pt end,dt,account.id,eid,cash,flow,trim(p->>'reason'),fp,uid);return jsonb_build_object('id',mid,'eventId',eid,'cashEventId',cash,'amount',amt);
end $function$
;
CREATE OR REPLACE FUNCTION private.post_external_investment_cash(p_financial_event_id uuid, p_recognition_event_id uuid, p_flow_id uuid, p_account_id uuid, p_direction text, p_settlement_date date, p_amount numeric, p_currency text, p_exchange_rate numeric, p_base_amount numeric, p_treatment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
 v_user uuid:=auth.uid(); v_event public.financial_events%rowtype; v_rec public.financial_events%rowtype;
 v_account public.liquidity_accounts%rowtype; v_flow public.liquidity_flows%rowtype; v_settlement uuid; v_hash text;
begin
 if v_user is null then raise exception 'UNAUTHORIZED'; end if;
 if upper(p_treatment) <> 'CAPEX' then raise exception 'NONALLOCATING_CASH_TREATMENT_NOT_ALLOWED'; end if;
 if p_direction is distinct from 'OUTFLOW' then raise exception 'EXTERNAL_INVESTMENT_OUTFLOW_REQUIRED';end if;
 select * into v_event from public.financial_events where id=p_financial_event_id for update;
 select * into v_rec from public.financial_events where id=p_recognition_event_id for update;
 if v_event.id is null or v_event.event_type<>'SETTLEMENT' or v_event.status<>'COMMITTED' then raise exception 'COMMITTED_SETTLEMENT_EVENT_REQUIRED'; end if;
 if v_rec.id is null or v_rec.organization_id<>v_event.organization_id or v_rec.status<>'ACTUAL' then raise exception 'ACTUAL_RECOGNITION_EVENT_REQUIRED'; end if;
 if v_rec.event_type<>'ASSET' or v_rec.source_module<>'PARTICIPATION' or not exists(select 1 from public.participation_contracts c join public.participation_movements m on m.contract_id=c.id where c.id=v_rec.source_record_id and c.direction='OUTGOING' and c.deleted_at is null and m.recognition_event_id=v_rec.id and m.cash_event_id=v_event.id and m.execution_state='POSTING')then raise exception 'EXTERNAL_INVESTMENT_SOURCE_REQUIRED';end if;
 
 if not public.financial_core_can(v_event.organization_id,'financial_core.post') or not public.effective_organization_permission(v_event.organization_id,'liquidity.settle',p_base_amount,v_event.base_currency) then raise exception 'NONALLOCATING_CASH_POST_DENIED'; end if;
 if not public.financial_event_has_valid_approval(v_event.id) then raise exception 'VALID_APPROVAL_REQUIRED'; end if;
 if not public.effective_organization_permission(v_event.organization_id,'liquidity.edit',p_base_amount,v_event.base_currency) then raise exception 'NONALLOCATING_CASH_POST_DENIED';end if;
 if p_settlement_date is null or p_settlement_date<>v_event.event_date or p_settlement_date<v_rec.event_date or p_settlement_date>(now()at time zone 'Asia/Riyadh')::date then raise exception 'NONALLOCATING_CASH_DATE_MISMATCH';end if;
 if p_amount is distinct from round(p_amount,4)or p_base_amount is distinct from round(p_base_amount,4)
 or p_amount is distinct from(select sum(l.amount)from public.financial_event_lines l where l.event_id=v_event.id)
 or p_base_amount is distinct from(select sum(l.base_amount)from public.financial_event_lines l where l.event_id=v_event.id)
 or exists(select 1 from public.financial_event_lines l where l.event_id=v_event.id and(l.currency is distinct from upper(trim(p_currency))or l.exchange_rate is distinct from p_exchange_rate or l.cash_direction is distinct from upper(p_direction)))then raise exception 'NONALLOCATING_CASH_INSTRUCTION_MISMATCH';end if;

 if not exists(select 1 from public.financial_event_links where event_id=v_event.id and organization_id=v_event.organization_id and link_type='SETTLEMENT_OF' and related_event_id=v_rec.id) then raise exception 'SETTLEMENT_RECOGNITION_LINK_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=v_event.id and c.classification_type=upper(p_treatment) and l.cash_direction=upper(p_direction)) then raise exception 'SETTLEMENT_TREATMENT_LINE_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=v_rec.id and c.classification_type=upper(p_treatment)) then raise exception 'RECOGNITION_TREATMENT_MISMATCH'; end if;
 if exists(select 1 from public.financial_event_obligation_allocations where application_event_id=v_event.id) then raise exception 'NONALLOCATING_CASH_MUST_NOT_ALLOCATE_OBLIGATION'; end if;
 if round(p_amount*p_exchange_rate,4)<>round(p_base_amount,4) or p_amount<=0 or p_exchange_rate<=0 then raise exception 'CASH_CONVERSION_INVALID'; end if;
 select * into v_account from public.liquidity_accounts where id=p_account_id and organization_id=v_event.organization_id for update;
 if v_account.id is null or not v_account.active or v_account.currency<>upper(trim(p_currency)) then raise exception 'CASH_ACCOUNT_NOT_FOUND_OR_CURRENCY_MISMATCH'; end if;
 if v_account.entity_id is not null and v_account.entity_id is distinct from v_event.entity_id then raise exception 'CASH_ACCOUNT_ENTITY_MISMATCH'; end if;
 if v_account.current_balance-coalesce(v_account.restricted_balance,0)-coalesce(v_account.uncleared_balance,0)<p_amount then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
 select * into v_flow from public.liquidity_flows where id=p_flow_id and organization_id=v_event.organization_id for update;
 if v_flow.id is null or v_flow.direction<>upper(p_direction) or v_flow.currency<>upper(trim(p_currency)) or v_flow.transfer_id is not null or v_flow.intercompany_transfer_id is not null then raise exception 'CASH_FLOW_NOT_FOUND_OR_MISMATCH'; end if;
 if not exists(select 1 from public.financial_event_links where event_id=v_rec.id and organization_id=v_event.organization_id and link_type='CASH_FLOW' and target_module='liquidity_flows' and target_record_id=v_flow.id) then raise exception 'RECOGNITION_CASH_FLOW_LINK_REQUIRED'; end if;
 if v_flow.settled_amount+p_amount>v_flow.amount then raise exception 'EXPECTED_FLOW_OVER_SETTLEMENT'; end if;
 v_hash:=encode(extensions.digest(convert_to(v_event.organization_id::text||'|'||v_event.source_module||'|'||v_event.source_event_key||'|'||p_account_id::text||'|'||p_amount::text||'|'||upper(p_currency)||'|'||p_settlement_date::text,'UTF8'),'sha256'),'hex');
 select id into v_settlement from public.liquidity_settlements where organization_id=v_event.organization_id and source_module=v_event.source_module and source_event_key=v_event.source_event_key;
 if v_settlement is not null then return jsonb_build_object('financial_event_id',v_event.id,'liquidity_settlement_id',v_settlement,'status','POSTED','idempotent_replay',true); end if;
 insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,payload_fingerprint,created_by,posted_by)
 values(v_event.organization_id,v_event.entity_id,p_account_id,upper(p_direction),p_settlement_date,round(p_amount,4),upper(trim(p_currency)),p_exchange_rate,v_event.base_currency,round(p_base_amount,4),v_event.source_module,v_event.source_event_key,v_event.id,v_hash,v_user,v_user) returning id into v_settlement;
 update public.liquidity_flows set settled_amount=settled_amount+p_amount,settlement_status=case when settled_amount+p_amount>=amount then 'SETTLED' else 'PARTIAL' end,status=case when settled_amount+p_amount>=amount then 'ACTUAL' else status end,account_id=coalesce(account_id,p_account_id),updated_at=now() where id=v_flow.id;
 update public.liquidity_accounts set current_balance=current_balance+case when upper(p_direction)='INFLOW' then p_amount else -p_amount end,current_balance_base=current_balance_base+case when upper(p_direction)='INFLOW' then p_base_amount else -p_base_amount end,updated_at=now() where id=p_account_id;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id) values(v_event.id,v_event.organization_id,'CASH_FLOW','liquidity_flows',v_flow.id) on conflict do nothing;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id) values(v_event.id,v_event.organization_id,'CASH_SETTLEMENT','liquidity_settlements',v_settlement) on conflict do nothing;
 insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason) values(v_event.organization_id,v_settlement,null,'POSTED',v_user,'Non-allocating financing/equity cash post');
 update public.financial_events set settlement_date=p_settlement_date where id=v_event.id;
 perform public.transition_financial_event(v_event.id,'ACTUAL','Non-allocating financing/equity cash post');
 return jsonb_build_object('financial_event_id',v_event.id,'liquidity_settlement_id',v_settlement,'status','POSTED','idempotent_replay',false);
end $function$
;
revoke all on function private.post_external_investment_cash(uuid,uuid,uuid,uuid,text,date,numeric,text,numeric,numeric,text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.post_participation_movement(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare m public.participation_movements%rowtype;c public.participation_contracts%rowtype;e public.financial_events%rowtype;cash public.financial_events%rowtype;ob uuid;flow uuid;r jsonb;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.post')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));
 select * into m from public.participation_movements where id=p_id for update;select * into c from public.participation_contracts where id=m.contract_id;
 if m.execution_state='POSTED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if c.deleted_at is not null or c.state in('CANCELLED','CLOSED')or m.execution_state<>'PREPARED'then raise exception 'PARTICIPATION_MOVEMENT_STATE_INVALID';end if;
 select * into e from public.financial_events where id=m.recognition_event_id for update;
 if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if m.cash_event_id is not null then select * into cash from public.financial_events where id=m.cash_event_id for update;if cash.status<>'COMMITTED'or not public.financial_event_has_valid_approval(cash.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;end if;
 if exists(select 1 from public.participation_movements a join public.financial_events ae on ae.id=a.recognition_event_id where a.contract_id=c.id and ae.status='ACTUAL'and a.event_date>m.event_date)then raise exception 'PARTICIPATION_MOVEMENT_CHRONOLOGY';end if;
 update public.participation_movements set execution_state='POSTING'where id=m.id;
 perform public.transition_financial_event(e.id,'ACTUAL','Approved participation recognition');
 if m.kind='CAPITAL_RECEIPT'then
  if c.direction='OUTGOING' then r:=private.post_external_investment_cash(m.cash_event_id,m.recognition_event_id,m.flow_id,m.account_id,'OUTFLOW',m.event_date,m.amount,c.currency,c.exchange_rate,round(m.amount*c.exchange_rate,4),'CAPEX');else r:=public.post_financial_nonallocating_cash(m.cash_event_id,m.recognition_event_id,m.flow_id,m.account_id,'INFLOW',m.event_date,m.amount,c.currency,c.exchange_rate,round(m.amount*c.exchange_rate,4),c.capital_treatment);end if;
 elsif m.kind in('CAPITAL_RETURN','PROFIT')then
  select id into ob from public.financial_event_obligations where event_id=m.recognition_event_id and adjusts_obligation_id is null;
  flow:=private.ensure_debt_flow(ob);
  update public.participation_movements set flow_id=flow where id=m.id;
 end if;
 update public.participation_movements set execution_state='POSTED'where id=m.id;update public.participation_contracts set state='ACTIVE'where id=c.id and state='DRAFT';return jsonb_build_object('id',m.id,'status','POSTED');
end $function$
;
-- Draft deletion is audited and removes the document from workspaces, retaining the immutable financial trail.
create function private.manage_contract_draft(p_type text,p_id uuid,p_action text,p_payload jsonb,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare org uuid;ev uuid;rec public.debt_contracts%rowtype;part public.participation_contracts%rowtype;r jsonb;before_data jsonb;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 if p_action is null or p_type is null or p_action not in('EDIT','DELETE')or p_type not in('DEBT','PARTICIPATION')or length(trim(coalesce(p_reason,'')))not between 3 and 500 then raise exception 'CONTRACT_DRAFT_INPUT_INVALID';end if;
 if p_type='DEBT' then select * into rec from public.debt_contracts where id=p_id;org:=rec.organization_id;else select * into part from public.participation_contracts where id=p_id;org:=part.organization_id;end if;
 if org is null or not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'CONTRACT_DRAFT_ACCESS_DENIED';end if;
 if p_type='DEBT'then
  perform pg_advisory_xact_lock(hashtextextended(org::text||'|PHASE2B_CASH_WRITE',0));
  perform pg_advisory_xact_lock(hashtextextended(org::text||'|DEBT_CONTRACT|'||p_id,0));
  select * into rec from public.debt_contracts where id=p_id for update;ev:=rec.financial_event_id;
  perform 1 from public.financial_events where id=ev for update;
  if rec.deleted_at is not null then if p_action='DELETE'then return jsonb_build_object('id',p_id,'deleted',true,'replay',true);end if;raise exception 'CONTRACT_DRAFT_ALREADY_REMOVED';end if;
  if not exists(select 1 from public.financial_events where id=ev and status in('DRAFT','PLANNED','COMMITTED'))or public.financial_event_has_valid_approval(ev)or exists(select 1 from public.financing_charge_events where contract_id=p_id)then raise exception 'CONTRACT_DRAFT_ONLY_UNAPPROVED';end if;
  before_data:=to_jsonb(rec);
  if p_action='EDIT'then
   if coalesce(p_payload#>>'{contract,organization_id}',p_payload->>'organization_id')is distinct from org::text then raise exception 'CONTRACT_DRAFT_SCOPE_MISMATCH';end if;
   if exists(select 1 from public.financing_contract_terms where id=p_id and product='FINANCING')then r:=private.create_financed_contract(p_payload);elsif rec.kind='LOAN'then r:=private.create_qard_contract(p_payload);else r:=private.create_debt_contract(p_payload);end if;
   if (r->>'id')::uuid=p_id then raise exception 'CONTRACT_DRAFT_NEW_REQUEST_REQUIRED';end if;
  end if;
  perform public.transition_financial_event(ev,'CANCELLED',p_reason);
  update public.debt_contracts set deleted_at=now()where id=p_id;
 else
  perform pg_advisory_xact_lock(hashtextextended(org::text||'|PARTICIPATION_CONTRACT|'||p_id,0));
  select * into part from public.participation_contracts where id=p_id for update;
  if part.deleted_at is not null then if p_action='DELETE'then return jsonb_build_object('id',p_id,'deleted',true,'replay',true);end if;raise exception 'CONTRACT_DRAFT_ALREADY_REMOVED';end if;
  if part.state<>'DRAFT'or exists(select 1 from public.participation_movements where contract_id=p_id and execution_state<>'CANCELLED')then raise exception 'CONTRACT_DRAFT_ONLY_UNAPPROVED';end if;
  before_data:=to_jsonb(part);
  if p_action='EDIT'then
   if p_payload->>'organization_id'is distinct from org::text or coalesce(p_payload->>'direction','INCOMING')<>part.direction then raise exception 'CONTRACT_DRAFT_SCOPE_MISMATCH';end if;
   r:=private.create_participation_contract(p_payload);if (r->>'id')::uuid=p_id then raise exception 'CONTRACT_DRAFT_NEW_REQUEST_REQUIRED';end if;
  end if;
  update public.participation_contracts set deleted_at=now(),state='CANCELLED'where id=p_id;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)values(auth.uid(),'contract_draft',p_id,p_action,before_data,jsonb_build_object('organization_id',org,'replacement',r->>'id','reason',p_reason));
 return coalesce(r,jsonb_build_object('id',p_id,'deleted',true));
end $$;
revoke all on function private.manage_contract_draft(text,uuid,text,jsonb,text)from public,anon;grant execute on function private.manage_contract_draft(text,uuid,text,jsonb,text)to authenticated;
create function public.manage_contract_draft(p_type text,p_id uuid,p_action text,p_payload jsonb,p_reason text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.manage_contract_draft(p_type,p_id,p_action,p_payload,p_reason);$$;
revoke all on function public.manage_contract_draft(text,uuid,text,jsonb,text)from public,anon;grant execute on function public.manage_contract_draft(text,uuid,text,jsonb,text)to authenticated;

create or replace function private.participation_clearing_classification()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(new.organization_id,'PARTICIPATION_PAYABLE_CLEARING','تسوية مستحقات المستثمرين','PAYABLE',true,auth.uid()),(new.organization_id,'PARTICIPATION_RECEIVABLE_CLEARING','تحصيل مستحقات الاستثمار','RECEIVABLE',true,auth.uid())on conflict(organization_id,code)do nothing;return new;end $$;
