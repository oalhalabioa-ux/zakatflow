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

create function public.gold_receipt_assessment_periods(p_receipt uuid,p_calendar text)
returns table(source_lot_id uuid,remaining_base numeric,period_start date,period_due date)
language sql stable security definer set search_path='' as $$
 select part.* from private.gold_receipt_component_periods(p_receipt,p_calendar) part
 where exists(select 1 from public.transactions receipt where receipt.id=p_receipt
   and receipt.user_id=auth.uid() and receipt.organization_id is null)
 order by part.period_due,part.source_lot_id
$$;
revoke all on function public.gold_receipt_assessment_periods(uuid,text) from public,anon;
grant execute on function public.gold_receipt_assessment_periods(uuid,text) to authenticated;

create or replace function public.save_zakat_assessment_snapshot(p_assessment jsonb,p_lines jsonb,p_revision_of uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 uid uuid:=auth.uid(); a public.zakat_assessments%rowtype; c public.zakat_hawl_cycles%rowtype;
 coverage record; expected_eligible numeric; m public.zakat_methods%rowtype; period record;prev uuid; item jsonb; lot public.lots%rowtype;
 component_total numeric; component_due numeric; first_due date;
 portfolio_market numeric:=0;eligible numeric:=0; due numeric:=0; price numeric; fx numeric; purity numeric; basis numeric; expected_nisab numeric; base_currency text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 if (p_assessment->>'assessment_date')::date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'ASSESSMENT_DATE_IN_FUTURE';end if;
 if jsonb_typeof(p_lines)<>'array' or coalesce((p_assessment->'calculation_snapshot'->>'schemaVersion')::integer,0)<>2
  or jsonb_array_length(p_lines) is distinct from (p_assessment->'calculation_snapshot'->>'candidateLots')::integer then raise exception 'ASSESSMENT_PAYLOAD_INVALID';end if;
 select * into m from public.zakat_methods where id=(p_assessment->>'method_id')::uuid;
 select profiles.base_currency into base_currency from public.profiles where id=uid;
 if m.id is null or m.zakat_rate is distinct from (p_assessment->>'zakat_rate')::numeric or base_currency is distinct from p_assessment->>'currency' then raise exception 'ASSESSMENT_METHOD_MISMATCH';end if;
 if p_assessment->>'hawl_cycle_id' is not null then
  select * into c from public.zakat_hawl_cycles where id=(p_assessment->>'hawl_cycle_id')::uuid and user_id=uid for update;
  if c.id is null or c.status not in ('OPEN','ACTIVE') then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
  if (p_assessment->>'assessment_date')::date<c.hawl_start_date then raise exception 'ASSESSMENT_BEFORE_CYCLE_START';end if;
  prev:=c.assessment_id;
 end if;
 if p_revision_of is not null and (prev is distinct from p_revision_of or not exists(select 1 from public.zakat_assessments where id=p_revision_of and user_id=uid and hawl_cycle_id=c.id and superseded_by is null)) then raise exception 'ASSESSMENT_SUPERSEDED';end if;
 expected_nisab:=(case when p_assessment->>'nisab_standard'='GOLD' then 85 else 595 end)
  *(p_assessment->'calculation_snapshot'->'metalPrices'->(p_assessment->>'nisab_standard')->>'price')::numeric
  *(p_assessment->'calculation_snapshot'->'metalPrices'->(p_assessment->>'nisab_standard')->>'fxRate')::numeric;
 if expected_nisab is null or expected_nisab<=0 or abs(expected_nisab-(p_assessment->>'nisab_value_base')::numeric)>0.00000001 then raise exception 'ASSESSMENT_NISAB_MISMATCH';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'lot_id' having count(*)>1) then raise exception 'ASSESSMENT_DUPLICATE_LOT';end if;
 for item in select value from jsonb_array_elements(p_lines) loop
  select * into lot from public.lots where id=(item->>'lot_id')::uuid and user_id=uid for share;
  if lot.id is null or lot.remaining_quantity is distinct from (item->>'quantity')::numeric then raise exception 'ASSESSMENT_BALANCE_CHANGED';end if;
  select sum(cp.remaining_base),sum(case when cp.period_due<=(p_assessment->>'assessment_date')::date then cp.remaining_base else 0 end),min(cp.period_due)
    into component_total,component_due,first_due from public.gold_receipt_assessment_periods(lot.source_transaction_id,m.calendar_type) cp;
  if component_total is not null then
    if component_total is distinct from lot.remaining_value_base or component_total is distinct from (item->>'market_value')::numeric
      or component_due is distinct from (item->>'eligible_value')::numeric
      or first_due is distinct from (item->'valuation_snapshot'->>'hawlDueDate')::date
      or (component_due=0 and item->>'eligibility_status' is distinct from 'HAWL_NOT_COMPLETED')
      or (component_due>0 and coalesce(item->>'eligibility_status','') not in ('ELIGIBLE','BELOW_NISAB'))
    then raise exception 'GOLD_RECEIPT_COMPONENT_BASIS_MISMATCH';end if;
  else
  select * into period from public.zakat_lot_hawl_periods(m.calendar_type) hp where hp.lot_id=lot.id;
  if period.lot_id is null or (item->'valuation_snapshot'->>'hawlStartDate')::date is distinct from period.hawl_start_date
   or (item->'valuation_snapshot'->>'hawlDueDate')::date is distinct from period.hawl_due_date
   or (item->'valuation_snapshot'->>'hawlPeriod')::integer is distinct from period.hawl_period then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
  if period.covered_through>(p_assessment->>'assessment_date')::date then raise exception 'ASSESSMENT_BEFORE_FINAL_COVERAGE';end if;
  if period.hawl_due_date>(p_assessment->>'assessment_date')::date and item->>'eligibility_status'<>'HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_NOT_COMPLETED';end if;
  if period.hawl_due_date<=(p_assessment->>'assessment_date')::date and item->>'eligibility_status'='HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_STATUS_MISMATCH';end if;
  if public.zakat_next_hawl_date(period.hawl_due_date,m.calendar_type)<=(p_assessment->>'assessment_date')::date then raise exception 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW';end if;
  end if;
  price:=(item->>'valuation_price')::numeric;fx:=(item->>'fx_rate')::numeric;purity:=(item->'valuation_snapshot'->>'purity')::numeric;
  basis:=(item->>'quantity')::numeric*price*fx*purity;
  if price is null or price<0 or fx is null or fx<=0 or purity is null or purity<=0 or purity>1 or abs(basis-(item->>'market_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_VALUATION_MISMATCH';end if;
  if (item->>'zakat_amount')::numeric<0 or (item->>'eligible_value')::numeric<0 or (item->>'eligible_value')::numeric>(item->>'market_value')::numeric then raise exception 'ASSESSMENT_LINE_INVALID';end if;
  if abs((item->>'zakat_amount')::numeric-(case when item->>'eligibility_status'='ELIGIBLE' then (item->>'eligible_value')::numeric*m.zakat_rate else 0 end))>0.00000001 then raise exception 'ASSESSMENT_RATE_MISMATCH';end if;
  select * into coverage from public.investment_zakat_lot_coverage(m.calendar_type) cv where cv.lot_id=lot.id;
  if coalesce((item->'valuation_snapshot'->'institutionCoverage'->>'coveredDays')::integer,0) is distinct from coalesce(coverage.covered_days,0)
   or (coverage.covered_days>0 and ((item->'valuation_snapshot'->'institutionCoverage'->>'periodDays')::integer is distinct from coverage.period_days
    or item->'valuation_snapshot'->'institutionCoverage'->'intervals' is distinct from coverage.coverage_intervals)) then raise exception 'ASSESSMENT_EXTERNAL_COVERAGE_MISMATCH';end if;
  if coverage.covered_days>0 then
   expected_eligible:=case when period.hawl_due_date<=(p_assessment->>'assessment_date')::date then (item->>'market_value')::numeric*(coverage.period_days-coverage.covered_days)/coverage.period_days else 0 end;
   if abs(expected_eligible-(item->>'eligible_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_EXTERNAL_COVERAGE_BASIS_MISMATCH';end if;
  end if;
  portfolio_market:=portfolio_market+(item->>'market_value')::numeric;
  eligible:=eligible+(item->>'eligible_value')::numeric;due:=due+(item->>'zakat_amount')::numeric;
 end loop;
 if p_assessment->'calculation_snapshot'->>'nisabQualificationBasis'='PORTFOLIO_MARKET_VALUE' then
  if portfolio_market is distinct from (p_assessment->'calculation_snapshot'->>'nisabQualificationValue')::numeric then raise exception 'ASSESSMENT_NISAB_POOL_MISMATCH';end if;
  if portfolio_market<expected_nisab then eligible:=0;end if;
 else
  if eligible<expected_nisab then eligible:=0;end if;
 end if;
 if abs(eligible-(p_assessment->>'total_zakatable_value')::numeric)>0.00000001 or abs(due-(p_assessment->>'zakat_due')::numeric)>0.00000001 or abs(due-eligible*m.zakat_rate)>0.00000001 then raise exception 'ASSESSMENT_TOTAL_MISMATCH';end if;
 insert into public.zakat_assessments(user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,total_zakatable_value,zakat_rate,zakat_due,currency,status,method_version,calculation_snapshot,hawl_cycle_id,cycle_number,assessment_kind)
 values(uid,(p_assessment->>'assessment_date')::date,(p_assessment->>'valuation_date')::date,m.id,p_assessment->>'nisab_standard',(p_assessment->>'nisab_quantity')::numeric,expected_nisab,eligible,m.zakat_rate,due,base_currency,'CALCULATED',m.version,p_assessment->'calculation_snapshot',c.id,coalesce(c.cycle_no,1),'RECALCULATION') returning * into a;
 for item in select value from jsonb_array_elements(p_lines) loop
  insert into public.zakat_assessment_lines(assessment_id,lot_id,quantity,valuation_price,valuation_currency,fx_rate,valuation_snapshot,market_value,eligible_value,zakat_amount,eligibility_status,reason_code,explanation)
  values(a.id,(item->>'lot_id')::uuid,(item->>'quantity')::numeric,(item->>'valuation_price')::numeric,item->>'valuation_currency',(item->>'fx_rate')::numeric,item->'valuation_snapshot',(item->>'market_value')::numeric,(item->>'eligible_value')::numeric,(item->>'zakat_amount')::numeric,(item->>'eligibility_status')::public.eligibility_status,item->>'reason_code',item->>'explanation');
 end loop;
 if prev is not null then update public.zakat_assessments set superseded_by=a.id where id=prev and user_id=uid;end if;
 if c.id is not null then
  update public.zakat_hawl_cycles set assessment_id=a.id,valuation_date=a.valuation_date,nisab_value_base=a.nisab_value_base,
   price_mode=a.calculation_snapshot->>'priceMode',price_source=a.calculation_snapshot->>'priceSource',
   gold_price=(a.calculation_snapshot->'prices'->>'gold')::numeric,silver_price=(a.calculation_snapshot->'prices'->>'silver')::numeric,
   snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('latestAssessmentId',a.id,'latestAssessmentDate',a.assessment_date,'calendarType',a.calculation_snapshot->>'calendarType','latestValuation',a.calculation_snapshot)
  where id=c.id and user_id=uid;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_assessment',a.id,'CREATE_IMMUTABLE_SNAPSHOT',jsonb_build_object('assessment',to_jsonb(a),'previous_assessment_id',prev));
 return to_jsonb(a);
end $$;
