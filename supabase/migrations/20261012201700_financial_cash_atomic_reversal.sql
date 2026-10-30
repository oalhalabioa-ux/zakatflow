BEGIN;
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

COMMIT;