-- Financial Core: cash realization for financing proceeds and equity movements without settling AR/AP.
-- Financing inflow keeps the principal PAYABLE open for future debt-service settlement.
-- Equity cash movements create no receivable/payable or customer/supplier advance.
create or replace function public.post_financial_nonallocating_cash(
 p_financial_event_id uuid,p_recognition_event_id uuid,p_flow_id uuid,p_account_id uuid,
 p_direction text,p_settlement_date date,p_amount numeric,p_currency text,p_exchange_rate numeric,p_base_amount numeric,p_treatment text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public','private','extensions'
as $$
declare
 v_user uuid:=auth.uid(); v_event public.financial_events%rowtype; v_rec public.financial_events%rowtype;
 v_account public.liquidity_accounts%rowtype; v_flow public.liquidity_flows%rowtype; v_settlement uuid; v_hash text;
begin
 if v_user is null then raise exception 'UNAUTHORIZED'; end if;
 if upper(p_treatment) not in ('FINANCING','EQUITY') then raise exception 'NONALLOCATING_CASH_TREATMENT_NOT_ALLOWED'; end if;
 if upper(p_treatment)='FINANCING' and upper(p_direction)<>'INFLOW' then raise exception 'FINANCING_OUTFLOW_REQUIRES_PAYABLE_SETTLEMENT'; end if;
 select * into v_event from public.financial_events where id=p_financial_event_id for update;
 select * into v_rec from public.financial_events where id=p_recognition_event_id for update;
 if v_event.id is null or v_event.event_type<>'SETTLEMENT' or v_event.status<>'COMMITTED' then raise exception 'COMMITTED_SETTLEMENT_EVENT_REQUIRED'; end if;
 if v_rec.id is null or v_rec.organization_id<>v_event.organization_id or v_rec.status<>'ACTUAL' then raise exception 'ACTUAL_RECOGNITION_EVENT_REQUIRED'; end if;
 if upper(p_treatment)='FINANCING' and v_rec.event_type<>'LIABILITY' then raise exception 'FINANCING_LIABILITY_RECOGNITION_REQUIRED'; end if;
 if upper(p_treatment)='EQUITY' and v_rec.event_type<>'ADJUSTMENT' then raise exception 'EQUITY_ADJUSTMENT_RECOGNITION_REQUIRED'; end if;
 if not public.financial_core_can(v_event.organization_id,'financial_core.post') or not public.effective_organization_permission(v_event.organization_id,'liquidity.settle',p_base_amount,v_event.base_currency) then raise exception 'NONALLOCATING_CASH_POST_DENIED'; end if;
 if not public.financial_event_has_valid_approval(v_event.id) then raise exception 'VALID_APPROVAL_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_links where event_id=v_event.id and organization_id=v_event.organization_id and link_type='SETTLEMENT_OF' and related_event_id=v_rec.id) then raise exception 'SETTLEMENT_RECOGNITION_LINK_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=v_event.id and c.classification_type=upper(p_treatment) and l.cash_direction=upper(p_direction)) then raise exception 'SETTLEMENT_TREATMENT_LINE_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=v_rec.id and c.classification_type=upper(p_treatment)) then raise exception 'RECOGNITION_TREATMENT_MISMATCH'; end if;
 if exists(select 1 from public.financial_event_obligation_allocations where application_event_id=v_event.id) then raise exception 'NONALLOCATING_CASH_MUST_NOT_ALLOCATE_OBLIGATION'; end if;
 if round(p_amount*p_exchange_rate,4)<>round(p_base_amount,4) or p_amount<=0 or p_exchange_rate<=0 then raise exception 'CASH_CONVERSION_INVALID'; end if;
 select * into v_account from public.liquidity_accounts where id=p_account_id and organization_id=v_event.organization_id for update;
 if v_account.id is null or not v_account.active or v_account.currency<>upper(trim(p_currency)) then raise exception 'CASH_ACCOUNT_NOT_FOUND_OR_CURRENCY_MISMATCH'; end if;
 if v_account.entity_id is not null and v_account.entity_id is distinct from v_event.entity_id then raise exception 'CASH_ACCOUNT_ENTITY_MISMATCH'; end if;
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
end $$;
revoke all on function public.post_financial_nonallocating_cash(uuid,uuid,uuid,uuid,text,date,numeric,text,numeric,numeric,text) from public;
grant execute on function public.post_financial_nonallocating_cash(uuid,uuid,uuid,uuid,text,date,numeric,text,numeric,numeric,text) to authenticated;
