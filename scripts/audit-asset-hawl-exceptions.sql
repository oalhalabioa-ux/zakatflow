-- Personal Zakat review at today's Riyadh date. Requires an authorized read-only
-- database connection with visibility into the private evidence tables.
begin transaction read only;

with recursive
as_of as (
  select (now() at time zone 'Asia/Riyadh')::date as review_date
),
open_lots as (
  select l.*, a.asset_type, p.base_currency, m.calendar_type
  from public.lots l
  join public.asset_accounts a on a.id=l.asset_account_id and a.user_id=l.user_id
  join public.profiles p on p.id=l.user_id
  left join public.zakat_methods m on m.id=p.zakat_method_id
  cross join as_of
  where l.organization_id is null and a.organization_id is null
    and a.ownership_scope='PERSONAL' and a.is_zakatable
    and l.remaining_quantity>0 and l.acquisition_date<=as_of.review_date
),
gold_receipts as (
  select l.id as lot_id, l.user_id, r.id as receipt_id, s.id as sale_id, s.quantity as sold_quantity,
         r.quantity=l.original_quantity and r.base_value=l.original_value_base
           and l.remaining_value_base between 0 and l.original_value_base as reconciled
  from open_lots l
  join public.transactions r on r.id=l.source_transaction_id and r.user_id=l.user_id
    and r.asset_account_id=l.asset_account_id and r.organization_id is null
    and r.transaction_type='ADD' and r.metadata->>'source'='sale_proceeds'
  join public.transactions s on s.id::text=r.metadata->>'sale_transaction_id' and s.user_id=l.user_id
    and s.organization_id is null and s.transaction_type='SALE'
  join public.asset_accounts gold on gold.id=s.asset_account_id and gold.user_id=s.user_id
    and gold.organization_id is null and gold.ownership_scope='PERSONAL' and gold.asset_type='GOLD'
  where l.asset_type in ('BANK','CASH')
    and not exists (
      select 1 from public.transactions rev
      where rev.reversal_of_transaction_id=r.id and rev.user_id=l.user_id
    )
),
source_parts as (
  select g.lot_id, h.*,
         sum(h.sold_quantity) over (partition by g.lot_id order by h.source_order) as running_quantity,
         sum(h.sold_quantity) over (partition by g.lot_id) as total_quantity
  from gold_receipts g
  join private.personal_gold_receipt_hawl_sources h on h.receipt_id=g.receipt_id
    and h.receipt_lot_id=g.lot_id and h.user_id=g.user_id
),
residual_parts as (
  select h.*,
    greatest(0, round(l.original_value_base*h.running_quantity/h.total_quantity,8)
      - greatest(round(l.original_value_base*(h.running_quantity-h.sold_quantity)/h.total_quantity,8),
                 l.original_value_base-l.remaining_value_base)) as remaining_base
  from source_parts h
  join open_lots l on l.id=h.lot_id
),
receipt_evidence as (
  select g.lot_id, g.receipt_id, g.sale_id,
    array_remove(array[
      case when g.reconciled is not true
        or exists (select 1 from residual_parts h where h.lot_id=g.lot_id and h.total_quantity<>g.sold_quantity)
        then 'RECEIPT_BASIS_MISMATCH' end,
      case when l.hawl_start_date is null
        and not exists (select 1 from residual_parts h where h.lot_id=g.lot_id)
        then 'LEGACY_RECEIPT_NO_HAWL_EVIDENCE' end,
      case when exists (select 1 from residual_parts h where h.lot_id=g.lot_id
        and h.remaining_base>0 and h.continuity_applies and h.source_hawl_start_date is null)
        then 'RECEIPT_SOURCE_HAWL_UNKNOWN' end,
      case when exists (select 1 from residual_parts h where h.lot_id=g.lot_id
        and h.remaining_base>0 and h.continuity_applies and h.source_hawl_start_date is not null
        and not h.coverage_captured) then 'RECEIPT_SOURCE_COVERAGE_UNVERIFIED' end,
      case when l.hawl_start_date is null
        and exists (select 1 from residual_parts h where h.lot_id=g.lot_id
          and h.remaining_base>0 and not h.continuity_applies)
        then 'RECEIPT_CONTINUITY_NOT_APPLICABLE_REVIEW' end
    ], null) as reasons
  from gold_receipts g
  join open_lots l on l.id=g.lot_id
),
lineage as (
  select l.id as lot_id, l.id as ancestor_id, l.user_id, l.hawl_continuity_source_lot_id as parent,
         array[l.id] as visited
  from open_lots l
  where l.hawl_start_date is not null
  union all
  select lineage.lot_id, p.id, p.user_id, p.hawl_continuity_source_lot_id, visited||p.id
  from lineage
  join public.lots p on p.id=lineage.parent and p.user_id=lineage.user_id and p.organization_id is null
  where not p.id=any(visited)
),
final_lines as (
  select line.id as line_id,line.lot_id, a.id as assessment_id,a.user_id,a.assessment_date,
         line.zakat_amount,line.valuation_snapshot, a.calculation_snapshot
  from public.zakat_assessment_lines line
  join public.zakat_assessments a on a.id=line.assessment_id and a.organization_id is null
  join public.zakat_hawl_cycles c on c.final_assessment_id=a.id and c.user_id=a.user_id
),
lot_coverage as (
  select lineage.lot_id,
    max(case when f.calculation_snapshot->>'hawlPeriodPolicy'='FINAL_COVERAGE_V1'
      then nullif(f.valuation_snapshot->>'hawlDueDate','')::date else f.assessment_date end) as covered_through
  from lineage
  join final_lines f on f.lot_id=lineage.ancestor_id and f.user_id=lineage.user_id and f.zakat_amount>0
  group by lineage.lot_id
),
period_anchors as (
  select l.id as lot_id, null::uuid as source_lot_id, l.calendar_type,
         l.hawl_start_date as start_date, c.covered_through
  from open_lots l
  left join lot_coverage c on c.lot_id=l.id
  where l.hawl_start_date is not null
  union all
  select l.id, h.source_lot_id, l.calendar_type, h.source_hawl_start_date,
    greatest(h.source_covered_through, max(c.period_due))
  from residual_parts h
  join open_lots l on l.id=h.lot_id
  left join final_lines f on f.lot_id=l.id and f.user_id=l.user_id and f.zakat_amount>0
  left join private.gold_receipt_assessment_components c on c.assessment_line_id=f.line_id
    and c.source_lot_id=h.source_lot_id and c.eligible_base>0
  where l.hawl_start_date is null and h.continuity_applies and h.coverage_captured
    and h.source_hawl_start_date is not null and h.remaining_base>0
  group by l.id,h.source_lot_id,l.calendar_type,h.source_hawl_start_date,h.source_covered_through
),
periods as (
  select lot_id, source_lot_id, calendar_type, covered_through, 1 as period_no,
    public.zakat_next_hawl_date(start_date,calendar_type) as due_date
  from period_anchors
  where calendar_type in ('GREGORIAN','HIJRI','HIJRI_TABULAR')
  union all
  select lot_id,source_lot_id,calendar_type,covered_through,period_no+1,
    public.zakat_next_hawl_date(due_date,calendar_type)
  from periods
  where due_date<=covered_through and period_no<200
),
uncovered as (
  select p.lot_id, min(p.due_date) as first_due_date,
    bool_or(p.due_date<as_of.review_date) as past_due,
    bool_or(public.zakat_next_hawl_date(p.due_date,p.calendar_type)<=as_of.review_date) as multiple_due
  from periods p
  cross join as_of
  where (p.covered_through is null or p.due_date>p.covered_through)
  group by p.lot_id
),
exceptions as (
  select l.*,e.receipt_id,e.sale_id,u.first_due_date,
    coalesce(e.reasons,array[]::text[]) || array_remove(array[
      case when u.multiple_due then 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW'
           when u.past_due then 'PAST_UNCOVERED_PERIOD' end,
      case when exists (select 1 from period_anchors p where p.lot_id=l.id
        and (p.calendar_type is null or p.calendar_type not in ('GREGORIAN','HIJRI','HIJRI_TABULAR')))
        then 'CALENDAR_UNVERIFIED' end,
      case when exists (select 1 from periods p where p.lot_id=l.id
        and p.period_no=200 and p.due_date<=p.covered_through) then 'HAWL_PERIOD_RANGE_EXCEEDED' end
    ],null) as reasons
  from open_lots l
  left join receipt_evidence e on e.lot_id=l.id
  left join uncovered u on u.lot_id=l.id
)
select e.id as review_lot_id, e.reasons, e.asset_type, e.acquisition_date, e.first_due_date,
  e.calendar_type,e.base_currency,e.remaining_value_base,
  rn.document_number as source_voucher,sn.document_number as sale_voucher,
  (select count(*) from public.transaction_allocations a
   where a.transaction_id=e.sale_id and a.user_id=e.user_id) as saved_sale_allocations,
  (select count(distinct f.assessment_id) from final_lines f
   where f.lot_id=e.id and f.user_id=e.user_id) as final_assessments_with_lot,
  (select count(distinct c.final_assessment_id) from public.zakat_hawl_cycles c
   join public.zakat_assessments a on a.id=c.final_assessment_id and a.user_id=c.user_id
   where c.user_id=e.user_id and a.organization_id is null and a.assessment_date>=e.acquisition_date
     and a.assessment_date<=as_of.review_date) as final_assessments_since_acquisition
from exceptions e
cross join as_of
left join public.voucher_numbers rn on rn.source_table='transactions' and rn.source_id=e.source_transaction_id
  and rn.owner_id=e.user_id and rn.organization_id is null
left join public.voucher_numbers sn on sn.source_table='transactions' and sn.source_id=e.sale_id
  and sn.owner_id=e.user_id and sn.organization_id is null
where cardinality(e.reasons)>0
order by e.acquisition_date,e.id;

rollback;
