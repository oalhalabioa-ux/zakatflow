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

-- Compute the next uncovered period using the same calendar as the parent
-- assessment. Source coverage and cash coverage can advance independently.
create function private.gold_receipt_component_periods(p_receipt uuid, p_calendar text)
returns table(source_lot_id uuid, remaining_base numeric, period_start date, period_due date)
language plpgsql stable security invoker set search_path='' as $$
declare part record;
begin
  for part in
    select r.source_lot_id, r.remaining_base, p.hawl_start_date,
           private.gold_receipt_final_coverage(cash.id,r.source_lot_id) as covered
    from public.personal_gold_receipt_remaining(p_receipt) r
    join public.lots cash on cash.source_transaction_id=p_receipt and cash.user_id=auth.uid()
    left join public.zakat_lot_hawl_periods(p_calendar) p on p.lot_id=r.source_lot_id
    where r.inherited_hawl_start_date is not null and r.remaining_base>0
    order by r.source_order
  loop
    if part.hawl_start_date is null then raise exception 'SOURCE_HAWL_PERIOD_REQUIRED'; end if;
    source_lot_id:=part.source_lot_id;
    remaining_base:=part.remaining_base;
    period_start:=part.hawl_start_date;
    period_due:=public.zakat_next_hawl_date(period_start,p_calendar);
    while period_due<=part.covered loop
      period_start:=period_due;
      period_due:=public.zakat_next_hawl_date(period_start,p_calendar);
    end loop;
    return next;
  end loop;
end $$;
revoke all on function private.gold_receipt_component_periods(uuid,text) from public,anon,authenticated,service_role;

-- Persist verified components in the same transaction as their assessment line.
create function private.capture_gold_cash_assessment_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  parent public.zakat_assessments%rowtype;
  cash public.lots%rowtype;
  calendar text;
  part record;
  total numeric := 0;
  eligible numeric := 0;
  amount numeric;
begin
  select * into parent from public.zakat_assessments where id=new.assessment_id;
  select * into cash from public.lots where id=new.lot_id and user_id=parent.user_id;
  if not exists (select 1 from private.personal_gold_receipt_hawl_sources s
    where s.user_id=parent.user_id and s.receipt_lot_id=cash.id and s.continuity_applies) then
    return new;
  end if;
  if parent.user_id is distinct from auth.uid() or cash.organization_id is not null then
    raise exception 'GOLD_CASH_ASSESSMENT_OWNER_MISMATCH';
  end if;
  select calendar_type into strict calendar from public.zakat_methods where id=parent.method_id;
  for part in select * from private.gold_receipt_component_periods(cash.source_transaction_id,calendar) loop
    if public.zakat_next_hawl_date(part.period_due,calendar)<=parent.assessment_date then
      raise exception 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW';
    end if;
    amount:=case when part.period_due<=parent.assessment_date then part.remaining_base else 0 end;
    total:=total+part.remaining_base;
    eligible:=eligible+amount;
    insert into private.gold_receipt_assessment_components
      (assessment_line_id,source_lot_id,period_start,period_due,remaining_base,eligible_base)
    values (new.id,part.source_lot_id,part.period_start,part.period_due,part.remaining_base,amount);
  end loop;
  if total is distinct from cash.remaining_value_base or total is distinct from new.market_value
    or (new.eligibility_status='ELIGIBLE' and eligible is distinct from new.eligible_value)
    or (eligible>0 and parent.zakat_due>0 and new.eligibility_status<>'ELIGIBLE') then
    raise exception 'GOLD_RECEIPT_COMPONENT_BASIS_MISMATCH';
  end if;
  return new;
end $$;
revoke all on function private.capture_gold_cash_assessment_line() from public,anon,authenticated,service_role;
create trigger capture_gold_cash_assessment_line after insert on public.zakat_assessment_lines
for each row execute function private.capture_gold_cash_assessment_line();
