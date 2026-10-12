-- Financial corrections tested in the Production parity QA environment.
BEGIN;
ALTER VIEW public.liquidity_flow_settlement_reconciliation SET (security_invoker=true);
REVOKE ALL ON TABLE public.liquidity_flow_settlement_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.liquidity_flow_settlement_reconciliation TO authenticated;
ALTER VIEW public.liquidity_account_settlement_ledger_summary SET (security_invoker=true);
REVOKE ALL ON TABLE public.liquidity_account_settlement_ledger_summary FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.liquidity_account_settlement_ledger_summary TO authenticated;
ALTER VIEW public.financial_core_cash_event_flow_links SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_cash_event_flow_links FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_cash_event_flow_links TO authenticated;
ALTER VIEW public.financial_core_cash_reconciliation SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_cash_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_cash_reconciliation TO authenticated;
ALTER VIEW public.financial_core_event_cash_position SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_event_cash_position FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_event_cash_position TO authenticated;
DROP POLICY IF EXISTS financial_classifications_org_insert ON public.financial_classifications;
CREATE POLICY financial_classifications_org_insert ON public.financial_classifications FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid() AND NOT is_system AND public.has_organization_permission(organization_id,'organization.edit'));
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
CREATE OR REPLACE FUNCTION public.transition_financial_event(p_event_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare e public.financial_events%rowtype;scope text;valid boolean:=false;begin select * into e from public.financial_events where id=p_event_id for update;if e.id is null then raise exception 'FINANCIAL_EVENT_NOT_FOUND';end if;if (e.status='DRAFT' and p_new_status in('PLANNED','CANCELLED')) or(e.status='PLANNED' and p_new_status in('COMMITTED','CANCELLED')) or(e.status='COMMITTED' and p_new_status in('ACTUAL','CANCELLED')) or(e.status='ACTUAL' and p_new_status='REVERSED') then valid:=true;end if;if not valid then raise exception 'INVALID_FINANCIAL_EVENT_TRANSITION:%->%',e.status,p_new_status;end if;scope:=case when p_new_status='ACTUAL' then case when e.event_type='REVERSAL' then 'financial_core.reverse' else 'financial_core.post' end when p_new_status='REVERSED' then 'financial_core.reverse' else 'financial_core.create' end;if not public.financial_core_can(e.organization_id,scope) then raise exception 'FINANCIAL_CORE_TRANSITION_DENIED';end if;if p_new_status='ACTUAL' and not public.financial_event_has_valid_approval(e.id) then raise exception 'VALID_APPROVAL_REQUIRED';end if;if p_new_status='ACTUAL' and (e.event_type='SETTLEMENT' or(e.event_type='REVERSAL' and exists(select 1 from public.financial_event_links l join public.liquidity_settlements s on s.financial_event_id=l.related_event_id where l.event_id=e.id and l.link_type='REVERSAL_OF'))) and not exists(select 1 from public.liquidity_settlements s where s.financial_event_id=e.id and s.organization_id=e.organization_id and s.status='POSTED') then raise exception 'CASH_POST_REQUIRES_ATOMIC_PATH';end if;
if p_new_status='REVERSED' and exists(select 1 from public.liquidity_settlements s where s.financial_event_id=e.id and s.organization_id=e.organization_id and s.status='POSTED') then raise exception 'CASH_REVERSAL_REQUIRES_ATOMIC_PATH';end if;
update public.financial_events set status=p_new_status,updated_at=now(),posted_by=case when p_new_status='ACTUAL' then auth.uid() else posted_by end,posted_at=case when p_new_status='ACTUAL' then now() else posted_at end where id=e.id;insert into public.financial_event_status_history(event_id,organization_id,from_status,to_status,actor_id,note) values(e.id,e.organization_id,e.status,p_new_status,auth.uid(),p_note);return p_new_status;end$function$
;
CREATE OR REPLACE FUNCTION private.cash_reverse_financial_settlement_atomic(p_original_settlement_id uuid, p_reversal_event_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare v_user uuid:=auth.uid(); v_original public.liquidity_settlements%rowtype; v_reversal_event public.financial_events%rowtype;
  v_existing public.liquidity_settlements%rowtype; v_hash text; v_norm jsonb; v_ids uuid[]; v_flow record; v_account public.liquidity_accounts%rowtype;
  v_orig_event public.financial_events%rowtype; v_alloc record; v_reverse_id uuid; v_expected text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_original from public.liquidity_settlements where id=p_original_settlement_id;
  if v_original.id is null then raise exception 'CASH_SETTLEMENT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_original.organization_id::text||'|PHASE2B_CASH_WRITE',0));
  select * into v_reversal_event from public.financial_events where id=p_reversal_event_id;
  if v_reversal_event.id is null or v_reversal_event.organization_id<>v_original.organization_id or v_reversal_event.event_type<>'REVERSAL' then raise exception 'REVERSAL_FINANCIAL_EVENT_INVALID'; end if;
  if not public.financial_core_can(v_original.organization_id,'financial_core.reverse') then raise exception 'FINANCIAL_CORE_REVERSE_DENIED'; end if;
  if not public.effective_organization_permission(v_original.organization_id,'liquidity.settle',v_original.base_amount,v_original.base_currency) or not public.has_organization_permission(v_original.organization_id,'liquidity.edit') then raise exception 'CASH_SETTLEMENT_REVERSE_DENIED'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  v_norm:=private.canonical_financial_json(jsonb_build_object('original_settlement_id',v_original.id,'reversal_event_id',v_reversal_event.id,'reason',trim(p_reason),'amount',v_original.amount,'currency',v_original.currency,'exchange_rate',v_original.exchange_rate,'base_amount',v_original.base_amount,'account_id',v_original.account_id,'direction',case when v_original.direction='INFLOW' then 'OUTFLOW' else 'INFLOW' end));
  v_hash:=encode(extensions.digest(convert_to(v_norm::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_original.organization_id::text||'|'||v_reversal_event.source_module||'|'||v_reversal_event.source_event_key||'|CASH_REVERSE',0));
  select * into v_existing from public.liquidity_settlements where organization_id=v_reversal_event.organization_id and source_module=v_reversal_event.source_module and source_event_key=v_reversal_event.source_event_key for update;
  if found then
    if v_existing.payload_fingerprint<>v_hash then raise exception 'IDEMPOTENCY_CONFLICT: reversal key was used with different payload'; end if;
    return jsonb_build_object('financial_event_id',v_reversal_event.id,'liquidity_settlement_id',v_existing.id,'status',v_existing.status,'idempotent_replay',true);
  end if;
  perform e.id from public.financial_events e where e.id in (v_original.financial_event_id,p_reversal_event_id) order by e.id for update;
  select * into v_reversal_event from public.financial_events where id=p_reversal_event_id;
  select * into v_orig_event from public.financial_events where id=v_original.financial_event_id and organization_id=v_original.organization_id;
  if v_reversal_event.status<>'COMMITTED' or not public.financial_event_has_valid_approval(v_reversal_event.id) then raise exception 'REVERSAL_EVENT_MUST_BE_APPROVED_AND_COMMITTED'; end if;
  if not exists(select 1 from public.financial_event_links l where l.event_id=v_reversal_event.id and l.organization_id=v_reversal_event.organization_id and l.link_type='REVERSAL_OF' and l.related_event_id=v_original.financial_event_id) then raise exception 'REVERSAL_EVENT_MUST_LINK_ORIGINAL_EVENT'; end if;
  if v_original.status<>'POSTED' then raise exception 'ORIGINAL_SETTLEMENT_NOT_POSTED'; end if;
  perform o.id from public.financial_event_obligations o where o.id in (select a.obligation_id from public.financial_event_obligation_allocations a where a.application_event_id=v_orig_event.id and a.organization_id=v_original.organization_id) order by o.id for update;
  if exists(select 1 from public.financial_event_obligations adv join public.financial_event_obligation_allocations a on a.source_advance_obligation_id=adv.id and a.organization_id=adv.organization_id join public.financial_events ae on ae.id=a.application_event_id and ae.organization_id=a.organization_id
    where adv.event_id=v_orig_event.id and adv.organization_id=v_orig_event.organization_id and adv.obligation_type in ('CUSTOMER_ADVANCE','SUPPLIER_ADVANCE','UNAPPLIED_CASH') and ae.status='ACTUAL') then raise exception 'ADVANCE_HAS_ACTIVE_APPLICATIONS_REVERSE_APPLICATIONS_FIRST'; end if;
  select * into v_account from public.liquidity_accounts where id=v_original.account_id and organization_id=v_original.organization_id for update;
  select * into v_original from public.liquidity_settlements where id=p_original_settlement_id and organization_id=v_original.organization_id for update;
  if v_original.status<>'POSTED' then raise exception 'ORIGINAL_SETTLEMENT_NOT_POSTED'; end if;
  perform f.id from public.liquidity_flows f where f.id in (select a.flow_id from public.liquidity_flow_settlement_allocations a where a.settlement_id=v_original.id and a.organization_id=v_original.organization_id) order by f.id for update;
  if exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=v_reversal_event.id and l.organization_id=v_reversal_event.organization_id and c.classification_type in ('REVENUE','OPEX','CAPEX','ASSET','TAX')) then raise exception 'REVERSAL_EVENT_CANNOT_RECOGNIZE_REVENUE_EXPENSE_ASSET_OR_VAT'; end if;
  v_expected:=case when v_original.direction='INFLOW' then 'OUTFLOW' else 'INFLOW' end;
  if (select coalesce(sum(l.base_amount),0) from public.financial_event_lines l where l.event_id=v_reversal_event.id and l.organization_id=v_reversal_event.organization_id and l.cash_direction=v_expected)<>v_original.base_amount then raise exception 'REVERSAL_EVENT_AMOUNT_MUST_MATCH_ORIGINAL_CASH'; end if;
  insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,status,payload_fingerprint,reversal_of_id,reversal_reason,created_by,posted_by)
    values(v_original.organization_id,v_original.entity_id,v_original.account_id,v_expected,v_reversal_event.event_date,v_original.amount,v_original.currency,v_original.exchange_rate,v_original.base_currency,v_original.base_amount,v_reversal_event.source_module,v_reversal_event.source_event_key,v_reversal_event.id,'POSTED',v_hash,v_original.id,trim(p_reason),v_user,v_user)
    returning id into v_reverse_id;
  for v_alloc in select * from public.liquidity_flow_settlement_allocations a where a.settlement_id=v_original.id and a.organization_id=v_original.organization_id and a.allocation_type in ('PAYMENT','ADVANCE_APPLICATION') and not exists(select 1 from public.liquidity_flow_settlement_allocations ra where ra.reversal_of_allocation_id=a.id and ra.organization_id=a.organization_id) order by a.flow_id loop
    insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount,reversal_of_allocation_id,created_by)
      values(v_original.organization_id,v_reverse_id,v_alloc.flow_id,v_reversal_event.id,'REVERSAL',v_alloc.amount,v_alloc.currency,v_alloc.exchange_rate,v_alloc.base_currency,v_alloc.base_amount,v_alloc.id,v_user);
    update public.liquidity_flows set settled_amount=greatest(settled_amount-v_alloc.amount,0),
      settlement_status=case when settled_amount-v_alloc.amount<=0 then 'UNSETTLED' when settled_amount-v_alloc.amount<amount then 'PARTIAL' else 'SETTLED' end,updated_at=now()
      where id=v_alloc.flow_id and organization_id=v_original.organization_id;
    insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id)
      values(v_reversal_event.id,v_reversal_event.organization_id,'CASH_FLOW','liquidity_flows',v_alloc.flow_id) on conflict do nothing;
  end loop;
  update public.liquidity_accounts set current_balance=current_balance+case when v_expected='INFLOW' then v_original.amount else -v_original.amount end,
    current_balance_base=current_balance_base+case when v_expected='INFLOW' then v_original.base_amount else -v_original.base_amount end,updated_at=now()
    where id=v_original.account_id and organization_id=v_original.organization_id;
  insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id)
    values(v_reversal_event.id,v_reversal_event.organization_id,'CASH_SETTLEMENT','liquidity_settlements',v_reverse_id);
  insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason)
    values(v_original.organization_id,v_reverse_id,null,'POSTED',v_user,p_reason);
  update public.liquidity_settlements set status='REVERSED',reversal_reason=trim(p_reason),reversed_by=v_user,reversed_at=now() where id=v_original.id and organization_id=v_original.organization_id;
  insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason)
    values(v_original.organization_id,v_original.id,'POSTED','REVERSED',v_user,p_reason);
  perform public.transition_financial_event(v_reversal_event.id,'ACTUAL','Atomic Cash reversal');
  perform public.transition_financial_event(v_orig_event.id,'REVERSED',trim(p_reason));
  return jsonb_build_object('original_settlement_id',v_original.id,'reversal_settlement_id',v_reverse_id,'financial_event_id',v_reversal_event.id,'status','REVERSED','idempotent_replay',false);
end;
$function$
;
REVOKE ALL ON FUNCTION private.cash_reverse_financial_settlement_atomic(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.cash_reverse_financial_settlement_atomic(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.reverse_financial_settlement(p_original_settlement_id uuid,p_reversal_event_id uuid,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.cash_reverse_financial_settlement_atomic(p_original_settlement_id,p_reversal_event_id,p_reason); $$;
REVOKE ALL ON FUNCTION public.reverse_financial_settlement(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_financial_settlement(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.accounting_invoice_binding_state(p_org uuid,p_document uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE linked boolean; recognized boolean;BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_organization_permission(p_org,'vat.edit') OR public.has_organization_permission(p_org,'financial_core.view')) THEN RAISE EXCEPTION 'INVOICE_BINDING_SCOPE_DENIED';END IF;
 SELECT count(*)>0,coalesce(bool_or(e.status IN('ACTUAL','REVERSED')),false) INTO linked,recognized FROM public.financial_events e WHERE e.organization_id=p_org AND (EXISTS(SELECT 1 FROM public.financial_event_links l WHERE l.event_id=e.id AND l.organization_id=p_org AND l.target_module='vat_documents' AND l.target_record_id=p_document AND l.link_type='SOURCE') OR EXISTS(SELECT 1 FROM public.financial_vat_source_bindings b WHERE b.event_id=e.id AND b.organization_id=p_org AND b.source_table='vat_documents' AND b.source_record_id=p_document));
 RETURN jsonb_build_object('bound',linked,'posted',recognized);
END $$;
REVOKE ALL ON FUNCTION private.accounting_invoice_binding_state(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accounting_invoice_binding_state(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION private.guard_accounting_invoice_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='pg_catalog','public' AS $$
DECLARE bound boolean; posted boolean;
BEGIN
 IF OLD.document_kind<>'INVOICE' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'zatca_status'-'notes') IS NOT DISTINCT FROM (to_jsonb(OLD)-'zatca_status'-'notes') THEN RETURN NEW;END IF;
 SELECT (x->>'bound')::boolean,(x->>'posted')::boolean INTO bound,posted FROM (SELECT private.accounting_invoice_binding_state(OLD.organization_id,OLD.id) x) q;
 IF bound AND (posted OR current_user NOT IN('postgres','supabase_admin')) THEN RAISE EXCEPTION 'VAT_BOUND_INVOICE_REQUIRES_CORRECTION';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_accounting_invoice_source ON public.vat_documents;
CREATE TRIGGER guard_accounting_invoice_source BEFORE UPDATE OR DELETE ON public.vat_documents FOR EACH ROW EXECUTE FUNCTION private.guard_accounting_invoice_source();
REVOKE ALL ON FUNCTION private.guard_accounting_invoice_source() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.financial_budget_report(p_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$declare o public.financial_budget_plan_ownership%rowtype;p public.budget_plans%rowtype;result jsonb;unmapped jsonb;begin select * into o from public.financial_budget_plan_ownership where plan_id=p_plan;if not found or not public.financial_budget_can(o.organization_id,o.entity_id,o.cost_center_id) then raise exception 'BUDGET_PLAN_READ_DENIED';end if;select * into p from public.budget_plans where id=p_plan;with facts as(select * from private.phase2d_plan_facts(p_plan)),gross as(select f.*,coalesce(g.paid,0)*abs(l.base_amount)/nullif(w.weight,0)*case when l.metadata->>'recognition_sign'='-1' then -1 else 1 end paid_share,coalesce(g.due,0)*abs(l.base_amount)/nullif(w.weight,0)*case when l.metadata->>'recognition_sign'='-1' then -1 else 1 end due_share from facts f join public.financial_event_lines l on l.id=f.financial_line_id left join lateral(select sum(abs(v.raw_base_amount)) weight from public.financial_budget_operational_facts v where v.event_id=f.event_id) w on true left join lateral(select sum(case when b.obligation_type in('RECEIVABLE','PAYABLE') then b.applied_base_amount else b.consumed_advance_base_amount end) paid,sum(b.outstanding_base_amount) due from public.financial_event_obligation_balances b where b.event_id=f.event_id and b.organization_id=f.organization_id) g on true),monthly as(select bl.id budget_line_id,bl.name,bl.category,bl.line_type,m.month fiscal_month,coalesce(bl.monthly_budget[m.month],0) budget_amount,coalesce(bl.monthly_actual[m.month],0) legacy_actual,coalesce(bl.monthly_forecast[m.month],0) forecast_amount,coalesce((select sum(f.actual_amount) from facts f where f.budget_line_id=bl.id and f.fiscal_month=m.month),0) actual_amount,coalesce((select sum(f.committed_amount) from facts f where f.budget_line_id=bl.id and f.fiscal_month=m.month),0) committed_amount,coalesce((select sum(g.paid_share) from gross g where g.budget_line_id=bl.id and g.fiscal_month=m.month),0) paid_settled_gross,coalesce((select sum(g.due_share) from gross g where g.budget_line_id=bl.id and g.fiscal_month=m.month),0) outstanding_gross from public.budget_lines bl cross join generate_series(1,12)m(month) where bl.plan_id=p_plan and bl.user_id=p.user_id and bl.active),metrics as(select *,budget_amount-committed_amount-actual_amount remaining_budget,case when line_type='REVENUE' then actual_amount-budget_amount else budget_amount-actual_amount end favorable_variance,forecast_amount-actual_amount forecast_minus_actual,actual_amount-legacy_actual reconciliation_difference from monthly)select coalesce(jsonb_agg(to_jsonb(metrics)||jsonb_build_object('variance_percent',100*favorable_variance/nullif(abs(budget_amount),0),'actual_source','FINANCIAL_CORE_DERIVED','legacy_source','LEGACY_MANUAL_MONTHLY_ACTUAL') order by budget_line_id,fiscal_month),'[]') into result from metrics;select coalesce(jsonb_agg(to_jsonb(f)),'[]') into unmapped from private.phase2d_plan_facts(p_plan)f where f.reason is not null;return jsonb_build_object('plan_id',p_plan,'organization_id',o.organization_id,'entity_id',o.entity_id,'cost_center_id',o.cost_center_id,'currency',p.currency,'scenario',p.scenario,'fiscal_start',o.fiscal_start,'rows',result,'unmapped_financial_actuals',unmapped,'unmapped_amount',(select coalesce(sum(f.unmapped_amount),0)from private.phase2d_plan_facts(p_plan)f where f.reason is not null),'unmapped_alert',jsonb_array_length(unmapped)>0,'legacy_actual_not_replaced',true,'forecast_not_changed',true);end$function$
;
-- These authenticated financial APIs are never needed by anonymous callers.
DO $access$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('amend_unissued_sales_invoice','amend_unsettled_purchase_invoice','approve_financial_event','can_self_approve_financial_event','configure_financial_budget','create_financial_event_command','effective_organization_permission','financial_budget_can','financial_budget_consolidated','financial_budget_drilldown','financial_budget_report','financial_core_can','link_zatca_accounting_document','owner_set_member_permission_override','owner_set_organization_approval_policy','owner_update_organization_role','post_financial_settlement','post_vat_financial_event','prepare_vat_financial_event','seed_default_organization_roles','transition_financial_event') LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $access$;
COMMIT;
