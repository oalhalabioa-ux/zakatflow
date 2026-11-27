-- Forward-only personal pooled Hawl treatment. Existing snapshots remain immutable.
create or replace function public.zakat_lot_hawl_periods(p_calendar text)
returns table(lot_id uuid,hawl_start_date date,hawl_due_date date,hawl_period integer,covered_through date)
language plpgsql security invoker set search_path='' as $$
declare l record;uid uuid:=auth.uid(); cycle_start date;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select public.personal_first_hawl_start() into cycle_start;
 for l in select lot.id,case when lot.organization_id is null then greatest(lot.hawl_start_date,cycle_start) else lot.hawl_start_date end root_start,
  (with recursive ancestors as (select lot.id,lot.hawl_continuity_source_lot_id parent,array[lot.id] seen union all select parent.id,parent.hawl_continuity_source_lot_id,anc.seen||parent.id from ancestors anc join public.lots parent on parent.id=anc.parent and parent.user_id=uid where not(parent.id=any(anc.seen))) select max(case when a.calculation_snapshot->>'hawlPeriodPolicy'='FINAL_COVERAGE_V1' then nullif(al.valuation_snapshot->>'hawlDueDate','')::date else a.assessment_date end) from public.zakat_assessment_lines al
   join public.zakat_assessments a on a.id=al.assessment_id and a.user_id=uid
   join public.zakat_hawl_cycles c on c.final_assessment_id=a.id and c.user_id=uid
   where al.lot_id in(select id from ancestors) and (al.zakat_amount>0 or (coalesce((al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer,0)>0 and (al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer=(al.valuation_snapshot->'institutionCoverage'->>'periodDays')::integer))) last_covered
  ,pooled.last_due,pooled.last_period
  from public.lots lot
  left join lateral (
    with recursive ancestors as (
      select lot.id,lot.hawl_continuity_source_lot_id as parent,array[lot.id] as seen
      union all
      select parent.id,parent.hawl_continuity_source_lot_id,anc.seen||parent.id
      from ancestors anc join public.lots parent on parent.id=anc.parent and parent.user_id=uid
      where not(parent.id=any(anc.seen))
    )
    select (al.valuation_snapshot->>'hawlDueDate')::date as last_due,
      (al.valuation_snapshot->>'hawlPeriod')::integer as last_period
    from public.zakat_assessment_lines al
    join public.zakat_assessments a on a.id=al.assessment_id and a.user_id=uid
    join public.zakat_hawl_cycles c on c.final_assessment_id=a.id and c.user_id=uid
    where al.lot_id in(select id from ancestors) and al.zakat_amount>0
      and a.calculation_snapshot->>'personalHawlPeriodPolicy'='PERSONAL_POOL_V1'
      and al.valuation_snapshot->>'periodBasis'='PERSONAL_POOL_V1'
    order by last_due desc,last_period desc limit 1
  ) pooled on true
  where lot.user_id=uid and lot.hawl_start_date is not null loop
  lot_id:=l.id;hawl_start_date:=l.root_start;hawl_period:=1;covered_through:=l.last_covered;
  if l.last_due>=hawl_start_date then
   hawl_start_date:=l.last_due;
   hawl_period:=l.last_period+1;
  end if;
  hawl_due_date:=public.zakat_next_hawl_date(hawl_start_date,p_calendar);
  while covered_through is not null and hawl_due_date<=covered_through loop
   hawl_start_date:=hawl_due_date;hawl_period:=hawl_period+1;
   if hawl_period>200 then raise exception 'HAWL_PERIOD_RANGE_EXCEEDED';end if;
   hawl_due_date:=public.zakat_next_hawl_date(hawl_start_date,p_calendar);
  end loop;
  return next;
 end loop;
end $$;

-- Method-specific periods for assessment and validation. Other consumers keep
-- the original lot-period contract. Amounts and existing finals are never updated.
create function public.personal_zakat_assessment_periods(p_cycle uuid, p_method uuid)
returns table (
  lot_id uuid, hawl_start_date date, hawl_due_date date, hawl_period integer,
  covered_through date, period_basis text
)
language sql stable security invoker set search_path = '' as $$
  with method as (
    select m.code,m.calendar_type from public.zakat_methods m where m.id=p_method
  ), cycle as (
    select c.hawl_start_date,c.hawl_due_date
    from public.zakat_hawl_cycles c cross join method m
    where c.id=p_cycle and c.user_id=auth.uid()
      and c.status in ('OPEN','ACTIVE') and m.code='UNIFIED_HAWL'
  ), external_coverage as (
    select cv.lot_id from method m
    cross join lateral public.investment_zakat_lot_coverage(m.calendar_type) cv
    where exists (select 1 from cycle) and cv.covered_days>0
  ), periods as (
    select p.*,c.hawl_start_date pool_start,c.hawl_due_date pool_due,
      c.hawl_due_date is not null and p.hawl_due_date>c.hawl_start_date
      and (p.covered_through is null or p.covered_through<c.hawl_due_date)
      and l.acquisition_date<=c.hawl_due_date and l.organization_id is null
      and a.organization_id is null and a.ownership_scope='PERSONAL' and a.is_zakatable
      and l.hawl_continuity_source_lot_id is null
      and not exists(select 1 from external_coverage cv where cv.lot_id=l.id) as pooled
    from method m cross join lateral public.zakat_lot_hawl_periods(m.calendar_type) p
    join public.lots l on l.id=p.lot_id and l.user_id=auth.uid()
    join public.asset_accounts a on a.id=l.asset_account_id
    left join cycle c on true
  )
  select p.lot_id,case when p.pooled then p.pool_start else p.hawl_start_date end,
    case when p.pooled then p.pool_due else p.hawl_due_date end,
    p.hawl_period,p.covered_through,case when p.pooled then 'PERSONAL_POOL_V1' else 'LOT_PERIOD' end
  from periods p
$$;
revoke all on function public.personal_zakat_assessment_periods(uuid,uuid) from public,anon;
grant execute on function public.personal_zakat_assessment_periods(uuid,uuid) to authenticated;

-- Save the inputs used by the pool and reject stale open snapshots at close.
create function private.personal_pooled_hawl_witness(p_cycle uuid, p_method uuid, p_cutoff date)
returns text
language sql stable security invoker set search_path = '' as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(
    l.id,l.asset_account_id,l.source_transaction_id,l.remaining_quantity,l.remaining_value_base,
    hp.hawl_start_date,hp.hawl_due_date,hp.hawl_period,hp.period_basis
  ) order by l.id)::text,'[]'))
  from public.lots l
  join public.asset_accounts a on a.id=l.asset_account_id
  left join public.personal_zakat_assessment_periods(p_cycle,p_method) hp on hp.lot_id=l.id
  where l.user_id=auth.uid() and l.organization_id is null and a.ownership_scope='PERSONAL'
    and a.is_zakatable and l.acquisition_date<=p_cutoff and l.remaining_quantity>0
$$;
revoke all on function private.personal_pooled_hawl_witness(uuid,uuid,date) from public,anon;
grant execute on function private.personal_pooled_hawl_witness(uuid,uuid,date) to authenticated;

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
 if c.id is not null and m.code='UNIFIED_HAWL'
  and p_assessment->'calculation_snapshot'->>'personalHawlPeriodPolicy' is distinct from 'PERSONAL_POOL_V1'
 then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
 if (c.id is null or m.code<>'UNIFIED_HAWL')
  and p_assessment->'calculation_snapshot'->>'personalHawlPeriodPolicy' is not null
 then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
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
    if item->'valuation_snapshot'->>'periodBasis'='PERSONAL_POOL_V1'
      or component_total is distinct from lot.remaining_value_base or component_total is distinct from (item->>'market_value')::numeric
      or component_due is distinct from (item->>'eligible_value')::numeric
      or first_due is distinct from (item->'valuation_snapshot'->>'hawlDueDate')::date
      or (component_due=0 and item->>'eligibility_status' is distinct from 'HAWL_NOT_COMPLETED')
      or (component_due>0 and coalesce(item->>'eligibility_status','') not in ('ELIGIBLE','BELOW_NISAB'))
    then raise exception 'GOLD_RECEIPT_COMPONENT_BASIS_MISMATCH';end if;
  else
  select * into period from public.personal_zakat_assessment_periods(c.id,m.id) hp where hp.lot_id=lot.id;
  if period.lot_id is null or coalesce(item->'valuation_snapshot'->>'periodBasis','LOT_PERIOD') is distinct from period.period_basis
   or (item->'valuation_snapshot'->>'hawlStartDate')::date is distinct from period.hawl_start_date
   or (item->'valuation_snapshot'->>'hawlDueDate')::date is distinct from period.hawl_due_date
   or (item->'valuation_snapshot'->>'hawlPeriod')::integer is distinct from period.hawl_period then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
  if period.covered_through>(p_assessment->>'assessment_date')::date then raise exception 'ASSESSMENT_BEFORE_FINAL_COVERAGE';end if;
  if period.hawl_due_date>(p_assessment->>'assessment_date')::date and item->>'eligibility_status'<>'HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_NOT_COMPLETED';end if;
  if period.hawl_due_date<=(p_assessment->>'assessment_date')::date and item->>'eligibility_status'='HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_STATUS_MISMATCH';end if;
  if public.zakat_next_hawl_date(period.hawl_due_date,m.calendar_type)<=(p_assessment->>'assessment_date')::date then raise exception 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW';end if;
  end if;
  if component_total is null and period.period_basis='PERSONAL_POOL_V1' then
   expected_eligible:=case when period.hawl_due_date<=(p_assessment->>'assessment_date')::date then (item->>'market_value')::numeric else 0 end;
   if (item->>'eligible_value')::numeric is distinct from expected_eligible then
    raise exception 'POOLED_HAWL_LINE_BASIS_MISMATCH';
   end if;
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
 if c.id is not null and m.code='UNIFIED_HAWL' then
  p_assessment:=jsonb_set(p_assessment,'{calculation_snapshot,personalHawlWitness}',
   to_jsonb(private.personal_pooled_hawl_witness(c.id,m.id,(p_assessment->>'assessment_date')::date)));
 end if;
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

create or replace function public.close_zakat_cycle(p_cycle_id uuid,p_final_assessment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;a public.zakat_assessments%rowtype;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null then raise exception 'ACTIVE_CYCLE_NOT_FOUND';end if;
 select * into a from public.zakat_assessments where id=p_final_assessment_id and user_id=uid and hawl_cycle_id=c.id;
 if a.id is null or a.status::text in ('DRAFT','CANCELLED') or a.superseded_by is not null or c.assessment_id is distinct from a.id then raise exception 'FINAL_ASSESSMENT_NOT_IN_CYCLE';end if;
 if c.final_zakat_due is not null and c.final_zakat_due is distinct from a.zakat_due then raise exception 'RECORDED_FINAL_BASIS_REQUIRES_REVIEW';end if;
 if a.assessment_date<c.hawl_due_date or (now() at time zone 'Asia/Riyadh')::date<c.hawl_due_date then raise exception 'CYCLE_HAWL_NOT_COMPLETED';end if;
 if a.calculation_snapshot->>'hawlPeriodPolicy' is distinct from 'FINAL_COVERAGE_V1' then raise exception 'FINAL_ASSESSMENT_RECALCULATION_REQUIRED';end if;
 if exists(select 1 from public.zakat_methods m where m.id=a.method_id and m.code='UNIFIED_HAWL') then
  if a.calculation_snapshot->>'personalHawlPeriodPolicy' is distinct from 'PERSONAL_POOL_V1'
   or a.calculation_snapshot->>'personalHawlWitness' is distinct from
    private.personal_pooled_hawl_witness(c.id,a.method_id,a.assessment_date)
   then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
  if exists(
   select 1
   from public.zakat_assessment_lines al
   left join public.personal_zakat_assessment_periods(c.id,a.method_id) hp on hp.lot_id=al.lot_id
   left join public.lots l on l.id=al.lot_id and l.user_id=uid
   where al.assessment_id=a.id and (
    l.remaining_quantity is distinct from al.quantity
    or ((al.valuation_snapshot->>'periodBasis'='PERSONAL_POOL_V1' or hp.period_basis='PERSONAL_POOL_V1')
     and not (al.valuation_snapshot->>'receiptComponentPolicy' is not null
      and al.valuation_snapshot->>'periodBasis' is distinct from 'PERSONAL_POOL_V1')
     and (hp.period_basis is distinct from al.valuation_snapshot->>'periodBasis'
      or hp.hawl_start_date is distinct from (al.valuation_snapshot->>'hawlStartDate')::date
      or hp.hawl_due_date is distinct from (al.valuation_snapshot->>'hawlDueDate')::date
      or hp.hawl_period is distinct from (al.valuation_snapshot->>'hawlPeriod')::integer))
   )
  ) then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
 end if;
 update public.zakat_assessments set assessment_kind='FINAL' where id=a.id and user_id=uid;
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=a.id,final_zakat_due=a.zakat_due,closed_at=now(),assessment_id=a.id,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('finalValuation',a.calculation_snapshot) where id=c.id and user_id=uid;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_hawl_cycle',c.id,'FINALIZE_AND_APPLY_CARRIED_CREDIT',jsonb_build_object('final_assessment_id',a.id,'final_zakat_due',a.zakat_due));
 return c.id;
end $$;
