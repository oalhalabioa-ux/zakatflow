-- Phase 2B recovery: read-only Financial Core ↔ Cash reconciliation views.
-- Additive only. No write-path, RLS, governance, role, or balance changes.

create or replace view public.financial_core_cash_event_flow_links as
with explicit_links as (
 select distinct f.organization_id,f.id as liquidity_flow_id,e.id as financial_event_id,'EXPLICIT_CASH_FLOW_LINK'::text as mapping_method
 from public.liquidity_flows f
 join public.financial_event_links l on l.organization_id=f.organization_id and l.link_type='CASH_FLOW' and l.target_module=any(array['liquidity_flows'::text,'liquidity_flow'::text]) and l.target_record_id=f.id and l.related_event_id is null
 join public.financial_events e on e.id=l.event_id and e.organization_id=l.organization_id
), source_key_links as (
 select distinct f.organization_id,f.id as liquidity_flow_id,e.id as financial_event_id,'SHARED_IDEMPOTENCY_KEY'::text as mapping_method
 from public.liquidity_flows f
 join public.financial_events e on e.organization_id=f.organization_id and e.source_module=f.source_module and e.source_event_key=f.source_event_key
 where f.source_event_key is not null and f.source_module is not null
 and not exists(select 1 from explicit_links x where x.organization_id=f.organization_id and x.liquidity_flow_id=f.id and x.financial_event_id=e.id)
)
select * from explicit_links union all select * from source_key_links;

create or replace view public.financial_core_cash_reconciliation as
with pair_rows as (
 select m.organization_id,m.liquidity_flow_id,m.financial_event_id,m.mapping_method,e.event_type,e.status financial_event_status,
 e.source_module financial_source_module,e.source_record_id financial_source_record_id,e.source_event_key financial_source_event_key,e.entity_id financial_entity_id,e.id event_id,
 (select l.related_event_id from public.financial_event_links l where l.organization_id=e.organization_id and l.event_id=e.id and l.link_type='SETTLEMENT_OF' order by l.created_at,l.id limit 1) original_event_id
 from public.financial_core_cash_event_flow_links m join public.financial_events e on e.id=m.financial_event_id and e.organization_id=m.organization_id
), flow_rows as (
 select f.organization_id,f.entity_id,f.id liquidity_flow_id,f.account_id,a.name liquidity_account_name,a.account_type liquidity_account_type,a.currency liquidity_account_currency,
 f.direction,f.flow_type,f.amount flow_amount,f.currency flow_currency,f.base_amount flow_base_amount,f.status liquidity_flow_status,f.settled_amount cash_settled_amount,
 f.settlement_status cash_settlement_status,f.source_module cash_source_module,f.source_record_id cash_source_record_id,f.source_event_key cash_source_event_key,
 f.transfer_id,f.intercompany_transfer_id,f.budget_line_id,
 case when f.intercompany_transfer_id is not null then 'INTERCOMPANY_TRANSFER' when f.transfer_id is not null then 'BANK_TO_BANK_TRANSFER' else 'OPERATING_CASH_FLOW' end cash_movement_kind,
 t.source_account_id transfer_source_account_id,t.destination_account_id transfer_destination_account_id,t.source_amount transfer_source_amount,t.source_currency transfer_source_currency,
 t.destination_amount transfer_destination_amount,t.destination_currency transfer_destination_currency,it.holding_organization_id,it.source_organization_id transfer_source_organization_id,
 it.destination_organization_id transfer_destination_organization_id,it.transaction_type intercompany_transaction_type,it.source_account_id intercompany_source_account_id,
 it.destination_account_id intercompany_destination_account_id,it.source_base_amount intercompany_source_base_amount,it.destination_base_amount intercompany_destination_base_amount
 from public.liquidity_flows f
 left join public.liquidity_accounts a on a.id=f.account_id and a.organization_id=f.organization_id
 left join public.liquidity_transfers t on t.id=f.transfer_id and t.organization_id=f.organization_id
 left join public.liquidity_intercompany_transfers it on it.id=f.intercompany_transfer_id and (f.organization_id=it.source_organization_id or f.organization_id=it.destination_organization_id)
)
select f.*,p.financial_event_id,p.event_id,p.original_event_id,p.mapping_method,p.event_type,p.financial_event_status,p.financial_source_module,p.financial_source_record_id,p.financial_source_event_key,p.financial_entity_id,
 case when p.financial_event_id is null then 'UNMATCHED_CASH_FLOW' when p.event_type='SETTLEMENT' then 'SETTLEMENT_CASH_FLOW' else 'SOURCE_EVENT_CASH_FLOW' end reconciliation_relation,
 case when p.event_type='SETTLEMENT' then (select case when count(distinct l.cash_direction)=1 then min(l.cash_direction) else 'MIXED' end from public.financial_event_lines l where l.event_id=p.financial_event_id and l.organization_id=p.organization_id)
      when p.event_type=any(array['REVENUE','RECEIVABLE']) then 'INFLOW' when p.event_type=any(array['EXPENSE','PAYABLE','ASSET_PURCHASE']) then 'OUTFLOW' else 'NON_CASH_OR_TRANSFER' end expected_direction,
 case when p.financial_event_id is null then 'UNMATCHED'
      when p.event_type=any(array['TRANSFER','REVERSAL']) then 'REVIEW_EVENT_TYPE'
      when p.event_type='SETTLEMENT' and exists(select 1 from public.financial_event_lines l where l.event_id=p.financial_event_id and l.organization_id=p.organization_id and l.cash_direction=any(array['INFLOW','OUTFLOW']) and l.cash_direction<>f.direction) then 'DIRECTION_MISMATCH'
      when p.event_type<>all(array['SETTLEMENT','TRANSFER','REVERSAL']) and p.event_type=any(array['REVENUE','RECEIVABLE']) and f.direction<>'INFLOW' then 'DIRECTION_MISMATCH'
      when p.event_type<>all(array['SETTLEMENT','TRANSFER','REVERSAL']) and p.event_type=any(array['EXPENSE','PAYABLE','ASSET_PURCHASE']) and f.direction<>'OUTFLOW' then 'DIRECTION_MISMATCH'
      else 'MATCHED' end reconciliation_status
from flow_rows f left join pair_rows p on p.organization_id=f.organization_id and p.liquidity_flow_id=f.liquidity_flow_id;

create or replace view public.financial_core_event_cash_position as
select e.id event_id,e.organization_id,e.entity_id,e.source_module,e.source_record_id,e.source_event_key,e.event_type,e.status,
 case when e.event_type='SETTLEMENT' then coalesce((select case when count(distinct l.cash_direction)=1 then min(l.cash_direction) else 'MIXED' end from public.financial_event_lines l where l.event_id=e.id and l.organization_id=e.organization_id),'NON_CASH')
      when e.event_type=any(array['REVENUE','RECEIVABLE']) then 'INFLOW' when e.event_type=any(array['EXPENSE','PAYABLE','ASSET_PURCHASE']) then 'OUTFLOW' else 'NON_CASH_OR_TRANSFER' end expected_cash_direction,
 s.settlement_status,s.settled_base_amount,s.due_base_amount,greatest(s.due_base_amount-s.settled_base_amount,0)::numeric(24,4) outstanding_base_amount,
 coalesce(x.linked_flow_count,0) linked_flow_count,coalesce(x.mismatched_flow_count,0) mismatched_flow_count,
 case when e.status=any(array['CANCELLED','REVERSED']) then 'NO_FUTURE_CASH_EXPECTED' when e.event_type='TRANSFER' then 'TRANSFER_SEMANTICS_REQUIRED'
      when e.event_type=any(array['REVENUE','RECEIVABLE','EXPENSE','PAYABLE','ASSET_PURCHASE']) and s.settlement_status='PAID' then 'SETTLED'
      when e.event_type=any(array['REVENUE','RECEIVABLE','EXPENSE','PAYABLE','ASSET_PURCHASE']) and s.settled_base_amount>0 then 'PARTIALLY_SETTLED'
      when e.event_type=any(array['REVENUE','RECEIVABLE','EXPENSE','PAYABLE','ASSET_PURCHASE']) then 'EXPECTED_FUTURE_CASH' else 'NON_CASH_OR_SPECIAL_EVENT' end cash_position
from public.financial_events e
left join public.financial_event_settlement_status s on s.event_id=e.id and s.organization_id=e.organization_id
left join lateral (
 select count(distinct r.liquidity_flow_id)::integer linked_flow_count,
 count(distinct r.liquidity_flow_id) filter(where r.reconciliation_status='DIRECTION_MISMATCH')::integer mismatched_flow_count
 from public.financial_core_cash_reconciliation r where r.organization_id=e.organization_id and (r.financial_event_id=e.id or r.original_event_id=e.id)
) x on true;
