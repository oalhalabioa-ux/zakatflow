BEGIN;
CREATE OR REPLACE FUNCTION private.cash_post_financial_settlement_atomic(p_financial_event_id uuid, p_account_id uuid, p_direction text, p_settlement_date date, p_amount numeric, p_currency text, p_exchange_rate numeric, p_base_amount numeric, p_allocations jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare e public.financial_events%rowtype;a public.liquidity_accounts%rowtype;sid uuid;existing public.liquidity_settlements%rowtype;x record;o public.financial_event_obligations%rowtype;allocated numeric:=0;finger text;
begin
if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;select * into e from public.financial_events where id=p_financial_event_id for update;if e.id is null then raise exception 'FINANCIAL_EVENT_NOT_FOUND';end if;
if e.event_type<>'SETTLEMENT' then raise exception 'SETTLEMENT_EVENT_REQUIRED';end if;
if not public.financial_core_can(e.organization_id,'financial_core.post') or not public.effective_organization_permission(e.organization_id,'liquidity.settle',p_base_amount,e.base_currency) then raise exception 'CASH_SETTLEMENT_POST_DENIED';end if;
if p_amount::text in('NaN','Infinity','-Infinity') or p_exchange_rate::text in('NaN','Infinity','-Infinity') or p_base_amount::text in('NaN','Infinity','-Infinity') or p_direction is null or p_amount is null or p_exchange_rate is null or p_base_amount is null or p_currency is null or p_settlement_date is null or upper(p_direction) not in('INFLOW','OUTFLOW') or p_amount<=0 or p_exchange_rate<=0 or round(p_amount*p_exchange_rate,4)<>round(p_base_amount,4) then raise exception 'SETTLEMENT_AMOUNT_DIRECTION_OR_FX_INVALID';end if;

finger:=encode(extensions.digest(convert_to(private.canonical_financial_json(jsonb_build_object('event',e.id,'account',p_account_id,'direction',upper(p_direction),'date',p_settlement_date,'amount',p_amount,'currency',upper(p_currency),'rate',p_exchange_rate,'base',p_base_amount,'allocations',coalesce(p_allocations,'[]')))::text,'UTF8'),'sha256'),'hex');
select * into existing from public.liquidity_settlements where organization_id=e.organization_id and financial_event_id=e.id for update;
if existing.id is not null then if existing.payload_fingerprint<>finger then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('financial_event_id',e.id,'liquidity_settlement_id',existing.id,'status',existing.status,'idempotent_replay',true);end if;
if not public.financial_event_has_valid_approval(e.id) then raise exception 'VALID_APPROVAL_REQUIRED';end if;
if e.status<>'COMMITTED' then raise exception 'SETTLEMENT_EVENT_MUST_BE_COMMITTED';end if;
select * into a from public.liquidity_accounts where id=p_account_id and organization_id=e.organization_id and active for update;if a.id is null then raise exception 'CASH_ACCOUNT_NOT_FOUND_OR_INACTIVE';end if;if a.currency<>upper(p_currency) then raise exception 'CASH_ACCOUNT_CURRENCY_MISMATCH';end if;
perform o0.id from public.financial_event_obligations o0 where o0.id in(select (item->>'obligation_id')::uuid from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) item) and o0.organization_id=e.organization_id order by o0.id for update;
if jsonb_array_length(coalesce(p_allocations,'[]'::jsonb))=0 then raise exception 'SETTLEMENT_ALLOCATION_REQUIRED';end if;
if exists(select 1 from jsonb_array_elements(p_allocations) item group by item->>'obligation_id' having count(*)>1) then raise exception 'DUPLICATE_SETTLEMENT_OBLIGATION';end if;
for x in select * from jsonb_to_recordset(coalesce(p_allocations,'[]')) as q(obligation_id uuid,flow_id uuid,amount numeric,base_amount numeric,flow_amount numeric,flow_currency text,flow_exchange_rate numeric) loop
select * into o from public.financial_event_obligations where id=x.obligation_id and organization_id=e.organization_id;if o.id is null or o.adjusts_obligation_id is not null then raise exception 'SETTLEMENT_OBLIGATION_INVALID';end if;
if not exists(select 1 from public.financial_events root where root.id=o.event_id and root.organization_id=e.organization_id and root.status='ACTUAL') then raise exception 'SETTLEMENT_ORIGINAL_RECOGNITION_REQUIRED';end if;
if x.amount is null or x.base_amount is null or x.amount::text in('NaN','Infinity','-Infinity') or x.base_amount::text in('NaN','Infinity','-Infinity') or o.base_currency<>e.base_currency or round(x.amount*p_exchange_rate,4)<>round(x.base_amount,4) or x.amount<=0 or x.base_amount<=0 then raise exception 'SETTLEMENT_ALLOCATION_AMOUNT_OR_CURRENCY_INVALID';end if;
if x.flow_id is not null and not exists(select 1 from public.liquidity_flows f join public.financial_event_links l on l.target_record_id=f.id and l.target_module='liquidity_flows' and l.link_type='CASH_FLOW' and l.event_id=o.event_id and l.organization_id=e.organization_id where f.id=x.flow_id and f.organization_id=e.organization_id and f.direction=upper(p_direction) and f.currency=coalesce(upper(x.flow_currency),upper(p_currency))) then raise exception 'SETTLEMENT_FLOW_OBLIGATION_MISMATCH';end if;
if x.flow_id is not null then
 perform f.id from public.liquidity_flows f where f.id=x.flow_id and f.organization_id=e.organization_id for update;
 if coalesce(x.flow_amount,x.amount)<=0 or coalesce(x.flow_exchange_rate,p_exchange_rate)<=0 or round(coalesce(x.flow_amount,x.amount)*coalesce(x.flow_exchange_rate,p_exchange_rate),4)<>round(x.base_amount,4) then raise exception 'SETTLEMENT_FLOW_AMOUNT_OR_FX_INVALID';end if;
 if coalesce(x.flow_amount,x.amount)>(select f.amount-f.settled_amount from public.liquidity_flows f where f.id=x.flow_id and f.organization_id=e.organization_id) then raise exception 'SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING';end if;
end if;
if (upper(p_direction)='OUTFLOW' and o.obligation_type<>'PAYABLE')or(upper(p_direction)='INFLOW' and o.obligation_type<>'RECEIVABLE') then raise exception 'SETTLEMENT_DIRECTION_OBLIGATION_TYPE_MISMATCH';end if;
if x.base_amount>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=o.id),o.settleable_base_amount) then raise exception 'FINANCIAL_CORE_OVER_SETTLEMENT';end if;allocated:=allocated+x.base_amount;end loop;
if round(allocated,4)<>round(p_base_amount,4) then raise exception 'SETTLEMENT_ALLOCATIONS_MUST_EQUAL_MOVEMENT';end if;
insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,payload_fingerprint,created_by,posted_by)
values(e.organization_id,e.entity_id,p_account_id,upper(p_direction),p_settlement_date,p_amount,upper(p_currency),p_exchange_rate,e.base_currency,p_base_amount,e.source_module,e.source_event_key,e.id,finger,auth.uid(),auth.uid()) returning id into sid;
for x in select * from jsonb_to_recordset(coalesce(p_allocations,'[]')) as q(obligation_id uuid,flow_id uuid,amount numeric,base_amount numeric,flow_amount numeric,flow_currency text,flow_exchange_rate numeric) loop
insert into public.financial_event_obligation_allocations(organization_id,application_event_id,obligation_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount) values(e.organization_id,e.id,x.obligation_id,'PAYMENT',x.amount,upper(p_currency),p_exchange_rate,e.base_currency,x.base_amount);
if x.flow_id is not null then update public.liquidity_flows set settled_amount=least(amount,settled_amount+coalesce(x.flow_amount,x.amount)),settlement_status=case when settled_amount+coalesce(x.flow_amount,x.amount)>=amount then 'SETTLED' else 'PARTIAL' end,account_id=p_account_id,updated_at=now() where id=x.flow_id and organization_id=e.organization_id;
insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount,created_by) values(e.organization_id,sid,x.flow_id,e.id,'PAYMENT',coalesce(x.flow_amount,x.amount),coalesce(upper(x.flow_currency),upper(p_currency)),coalesce(x.flow_exchange_rate,p_exchange_rate),e.base_currency,x.base_amount,auth.uid());end if;end loop;
update public.liquidity_accounts set current_balance=current_balance+case when upper(p_direction)='INFLOW' then p_amount else -p_amount end,current_balance_base=current_balance_base+case when upper(p_direction)='INFLOW' then p_base_amount else -p_base_amount end,updated_at=now() where id=p_account_id;
insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason) values(e.organization_id,sid,null,'POSTED',auth.uid(),'Financial Core settlement');
perform public.transition_financial_event(e.id,'ACTUAL','Atomic cash settlement post');
return jsonb_build_object('financial_event_id',e.id,'liquidity_settlement_id',sid,'status','POSTED','idempotent_replay',false);end$function$
;

COMMIT;