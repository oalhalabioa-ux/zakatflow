-- Component coverage is keyed by the saved cash line and the source gold lot.
-- The enclosing calculation transaction must derive amounts from the receipt.
create table private.gold_receipt_assessment_components (
  assessment_line_id uuid not null references public.zakat_assessment_lines(id),
  source_lot_id uuid not null references public.lots(id),
  period_start date not null,
  period_due date not null check (period_due > period_start),
  remaining_base numeric not null check (remaining_base > 0 and remaining_base < 'Infinity'::numeric),
  eligible_base numeric not null check (eligible_base between 0 and remaining_base),
  primary key (assessment_line_id, source_lot_id)
);
alter table private.gold_receipt_assessment_components enable row level security;
revoke all on private.gold_receipt_assessment_components from public, anon, authenticated, service_role;

-- Call from the trusted snapshot writer. A draft, revision or payment must
-- never advance a component's period. Other receipts from the same gold lot
-- may have different spending and final-assessment histories.
create function private.gold_receipt_final_coverage(p_cash_lot uuid, p_source_lot uuid)
returns date language sql stable security invoker set search_path='' as $$
  select max(component.period_due)
  from private.gold_receipt_assessment_components component
  join public.zakat_assessment_lines line on line.id=component.assessment_line_id
  join public.zakat_assessments assessment on assessment.id=line.assessment_id
  join public.zakat_hawl_cycles cycle on cycle.final_assessment_id=assessment.id
    and cycle.id=assessment.hawl_cycle_id and cycle.user_id=assessment.user_id
  where assessment.user_id=(select auth.uid())
    and line.lot_id=p_cash_lot and component.source_lot_id=p_source_lot
    and component.eligible_base>0 and line.zakat_amount>0
$$;
revoke all on function private.gold_receipt_final_coverage(uuid,uuid) from public, anon, authenticated, service_role;
