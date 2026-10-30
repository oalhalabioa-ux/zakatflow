-- Read-only AR/AP subledger derived from Financial Core obligations.
create or replace view public.financial_counterparty_open_items
with (security_invoker = true) as
select
  e.organization_id,
  e.counterparty_id,
  cp.name as counterparty_name,
  cp.party_type,
  b.obligation_id,
  b.event_id,
  b.obligation_key,
  b.obligation_type,
  e.source_module,
  e.source_record_id,
  e.source_event_key,
  e.description,
  e.event_date,
  e.due_date,
  b.currency,
  b.base_currency,
  b.settleable_amount,
  b.adjusted_settleable_base_amount as due_base_amount,
  b.applied_base_amount,
  b.consumed_advance_base_amount,
  b.outstanding_base_amount,
  greatest(0::numeric,b.adjusted_settleable_base_amount-b.outstanding_base_amount) as settled_base_amount,
  (e.due_date is not null and e.due_date < current_date and b.outstanding_base_amount > 0) as is_overdue
from public.financial_event_obligation_balances b
join public.financial_events e on e.id=b.event_id and e.organization_id=b.organization_id
left join public.liquidity_counterparties cp on cp.id=e.counterparty_id and cp.organization_id=e.organization_id
where b.obligation_type in ('RECEIVABLE','PAYABLE')
  and e.status <> 'REVERSED';

create or replace view public.financial_counterparty_balances
with (security_invoker = true) as
select
 organization_id,counterparty_id,counterparty_name,party_type,base_currency,
 sum(case when obligation_type='RECEIVABLE' then outstanding_base_amount else 0 end) as receivable_balance,
 sum(case when obligation_type='PAYABLE' then outstanding_base_amount else 0 end) as payable_balance,
 sum(case when obligation_type='RECEIVABLE' and is_overdue then outstanding_base_amount else 0 end) as overdue_receivable,
 sum(case when obligation_type='PAYABLE' and is_overdue then outstanding_base_amount else 0 end) as overdue_payable,
 count(*) filter (where outstanding_base_amount>0) as open_item_count
from public.financial_counterparty_open_items
where outstanding_base_amount>0
group by organization_id,counterparty_id,counterparty_name,party_type,base_currency;
