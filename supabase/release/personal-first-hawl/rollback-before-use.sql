-- Apply as one transaction before any confirmed first-cycle policy is in use.
lock table public.zakat_hawl_cycles in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.zakat_hawl_cycles
    where snapshot->>'personal_start_policy' in ('FIRST_NISAB_V1','SETTLED_OPENING_V1')) then
    raise exception 'FIRST_HAWL_POLICY_IN_USE';
  end if;
end $$;

create or replace function public.zakat_lot_hawl_periods(p_calendar text)
returns table(lot_id uuid,hawl_start_date date,hawl_due_date date,hawl_period integer,covered_through date)
language plpgsql security invoker set search_path='' as $$
declare l record;uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 for l in select lot.id,lot.hawl_start_date root_start,
  (with recursive ancestors as (select lot.id,lot.hawl_continuity_source_lot_id parent,array[lot.id] seen union all select parent.id,parent.hawl_continuity_source_lot_id,anc.seen||parent.id from ancestors anc join public.lots parent on parent.id=anc.parent and parent.user_id=uid where not(parent.id=any(anc.seen))) select max(case when a.calculation_snapshot->>'hawlPeriodPolicy'='FINAL_COVERAGE_V1' then nullif(al.valuation_snapshot->>'hawlDueDate','')::date else a.assessment_date end) from public.zakat_assessment_lines al
   join public.zakat_assessments a on a.id=al.assessment_id and a.user_id=uid
   join public.zakat_hawl_cycles c on c.final_assessment_id=a.id and c.user_id=uid
   where al.lot_id in(select id from ancestors) and (al.zakat_amount>0 or (coalesce((al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer,0)>0 and (al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer=(al.valuation_snapshot->'institutionCoverage'->>'periodDays')::integer))) last_covered
  from public.lots lot where lot.user_id=uid and lot.hawl_start_date is not null loop
  lot_id:=l.id;hawl_start_date:=l.root_start;hawl_period:=1;covered_through:=l.last_covered;
  hawl_due_date:=public.zakat_next_hawl_date(hawl_start_date,p_calendar);
  while covered_through is not null and hawl_due_date<=covered_through loop
   hawl_start_date:=hawl_due_date;hawl_period:=hawl_period+1;
   if hawl_period>200 then raise exception 'HAWL_PERIOD_RANGE_EXCEEDED';end if;
   hawl_due_date:=public.zakat_next_hawl_date(hawl_start_date,p_calendar);
  end loop;
  return next;
 end loop;
end $$;

create or replace function private.gold_receipt_component_periods(p_receipt uuid, p_calendar text)
returns table(source_lot_id uuid, remaining_base numeric, period_start date, period_due date)
language plpgsql stable security invoker set search_path='' as $$
declare part record;
begin
  for part in
    select r.source_lot_id, r.remaining_base, r.inherited_hawl_start_date as hawl_start_date, s.coverage_captured,
           greatest(s.source_covered_through,private.gold_receipt_final_coverage(cash.id,r.source_lot_id)) as covered
    from public.personal_gold_receipt_remaining(p_receipt) r
    join public.lots cash on cash.source_transaction_id=p_receipt and cash.user_id=auth.uid()
    join private.personal_gold_receipt_hawl_sources s on s.receipt_id=p_receipt and s.source_lot_id=r.source_lot_id
    where r.inherited_hawl_start_date is not null and r.remaining_base>0
    order by r.source_order
  loop
    if not part.coverage_captured then raise exception 'RECEIPT_SOURCE_COVERAGE_REVIEW_REQUIRED'; end if;
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

drop function public.personal_first_hawl_start();
