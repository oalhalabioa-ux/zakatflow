-- Phase 2B recovery: read-only settlement reconciliation views.
-- Additive only: no table, policy, role, permission, or write-path changes.

create or replace view public.liquidity_flow_settlement_reconciliation as
select f.id as flow_id,f.organization_id,f.entity_id,f.account_id,f.direction,
 f.amount as expected_amount,f.currency,f.settled_amount,
 greatest(f.amount-f.settled_amount,0::numeric)::numeric(24,4) as expected_outstanding,
 f.settlement_status,
 coalesce(sum(case when a.allocation_type='PAYMENT' then a.amount when a.allocation_type='REVERSAL' and original.allocation_type='PAYMENT' then -a.amount else 0 end),0)::numeric(24,4) as net_actual_cash_allocated,
 coalesce(sum(case when a.allocation_type='ADVANCE_APPLICATION' then a.amount when a.allocation_type='REVERSAL' and original.allocation_type='ADVANCE_APPLICATION' then -a.amount else 0 end),0)::numeric(24,4) as net_advance_applied
from public.liquidity_flows f
left join public.liquidity_flow_settlement_allocations a on a.flow_id=f.id and a.organization_id=f.organization_id
left join public.liquidity_flow_settlement_allocations original on original.id=a.reversal_of_allocation_id and original.organization_id=a.organization_id
group by f.id,f.organization_id,f.entity_id,f.account_id,f.direction,f.amount,f.currency,f.settled_amount,f.settlement_status;

create or replace view public.liquidity_account_settlement_ledger_summary as
select a.id as account_id,a.organization_id,a.entity_id,a.currency,a.current_balance,a.current_balance_base,
 coalesce(sum(s.amount) filter(where s.direction='INFLOW'),0)::numeric(24,4) as settlement_inflows,
 coalesce(sum(s.amount) filter(where s.direction='OUTFLOW'),0)::numeric(24,4) as settlement_outflows,
 coalesce(sum(case when s.direction='INFLOW' then s.base_amount else -s.base_amount end),0)::numeric(24,4) as net_settlement_base_amount
from public.liquidity_accounts a
left join public.liquidity_settlements s on s.account_id=a.id and s.organization_id=a.organization_id
group by a.id,a.organization_id,a.entity_id,a.currency,a.current_balance,a.current_balance_base;
