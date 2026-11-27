-- Derive a Hawl for eligible opening balances only after the owner has
-- explicitly settled the prior periods. Preserve the original lot and finals.
create function private.personal_settled_opening_lot_anchors()
returns table(lot_id uuid, anchor_date date)
language sql stable security invoker set search_path = '' as $$
  select l.id,greatest(l.acquisition_date,c.hawl_start_date)
  from public.zakat_hawl_cycles c
  join public.lots l on l.user_id=c.user_id and l.organization_id is null
    and l.hawl_start_date is null and l.hawl_continuity_source_lot_id is null
  join public.asset_accounts a on a.id=l.asset_account_id and a.user_id=c.user_id
    and a.organization_id is null and a.ownership_scope='PERSONAL' and a.is_zakatable
  join public.transactions t on t.id=l.source_transaction_id and t.user_id=c.user_id
    and t.asset_account_id=a.id and t.organization_id is null
    and t.transaction_type='OPENING_BALANCE' and t.transaction_date=l.acquisition_date
  where c.user_id=auth.uid() and c.cycle_no=1
    and c.snapshot->>'personal_start_policy'='SETTLED_OPENING_V1'
$$;
revoke all on function private.personal_settled_opening_lot_anchors() from public,anon,authenticated;
grant execute on function private.personal_settled_opening_lot_anchors() to authenticated;

create or replace function public.zakat_lot_hawl_periods(p_calendar text)
returns table(lot_id uuid,hawl_start_date date,hawl_due_date date,hawl_period integer,covered_through date)
language plpgsql security invoker set search_path='' as $$
declare l record;uid uuid:=auth.uid(); cycle_start date;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select public.personal_first_hawl_start() into cycle_start;
 for l in select lot.id,
  case when lot.organization_id is null then greatest(coalesce(lot.hawl_start_date,opening.anchor_date),cycle_start)
    else lot.hawl_start_date end root_start,
  (with recursive ancestors as (select lot.id,lot.hawl_continuity_source_lot_id parent,array[lot.id] seen union all select parent.id,parent.hawl_continuity_source_lot_id,anc.seen||parent.id from ancestors anc join public.lots parent on parent.id=anc.parent and parent.user_id=uid where not(parent.id=any(anc.seen))) select max(case when a.calculation_snapshot->>'hawlPeriodPolicy'='FINAL_COVERAGE_V1' then nullif(al.valuation_snapshot->>'hawlDueDate','')::date else a.assessment_date end) from public.zakat_assessment_lines al
   join public.zakat_assessments a on a.id=al.assessment_id and a.user_id=uid
   join public.zakat_hawl_cycles c on c.final_assessment_id=a.id and c.user_id=uid
   where al.lot_id in(select id from ancestors) and (al.zakat_amount>0 or (coalesce((al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer,0)>0 and (al.valuation_snapshot->'institutionCoverage'->>'coveredDays')::integer=(al.valuation_snapshot->'institutionCoverage'->>'periodDays')::integer))) last_covered
  ,pooled.last_due,pooled.last_period
  from public.lots lot
  left join private.personal_settled_opening_lot_anchors() opening on opening.lot_id=lot.id
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
  where lot.user_id=uid and (lot.hawl_start_date is not null or opening.lot_id is not null) loop
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

create or replace function public.close_zakat_cycle(p_cycle_id uuid,p_final_assessment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;a public.zakat_assessments%rowtype;continuity jsonb;effective_due date;invoice_positions jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null then raise exception 'ACTIVE_CYCLE_NOT_FOUND';end if;
 select * into a from public.zakat_assessments where id=p_final_assessment_id and user_id=uid and hawl_cycle_id=c.id;
 if a.id is null or a.status::text in ('DRAFT','CANCELLED') or a.superseded_by is not null or c.assessment_id is distinct from a.id then raise exception 'FINAL_ASSESSMENT_NOT_IN_CYCLE';end if;
 if c.final_zakat_due is not null and c.final_zakat_due is distinct from a.zakat_due then raise exception 'RECORDED_FINAL_BASIS_REQUIRES_REVIEW';end if;
 continuity:=private.personal_hawl_continuity(c.id,a.method_id,a.assessment_date);
 if a.calculation_snapshot->'hawlContinuity' is distinct from continuity then
  raise exception 'HAWL_CONTINUITY_RECALCULATION_REQUIRED';end if;
 invoice_positions:=private.personal_invoice_assessment_positions(c.id,a.method_id,a.assessment_date,continuity);
 if (a.calculation_snapshot->'invoiceHawlEvidence') is distinct from
    (case when jsonb_array_length(invoice_positions)>0 then invoice_positions end) then
  raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
 end if;
 if exists(select 1 from jsonb_array_elements(invoice_positions) p
   where (p->>'netBase')::numeric>0
    and not exists(select 1 from public.lots l
      join public.zakat_assessment_lines al on al.lot_id=l.id and al.assessment_id=a.id
      where l.id=(p->>'lotId')::uuid and l.user_id=uid
       and l.remaining_quantity=al.quantity and l.remaining_value_base=(p->>'grossBase')::numeric
       and al.valuation_snapshot->'invoiceHawlPosition'=p)) then
  raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
 end if;
 effective_due:=greatest(c.hawl_due_date,(continuity->>'effectiveDue')::date);
 if a.assessment_date<effective_due or (now() at time zone 'Asia/Riyadh')::date<effective_due then raise exception 'CYCLE_HAWL_NOT_COMPLETED';end if;
 if a.calculation_snapshot->>'hawlPeriodPolicy' is distinct from 'FINAL_COVERAGE_V1' then raise exception 'FINAL_ASSESSMENT_RECALCULATION_REQUIRED';end if;
 -- Open assessments saved before opening lots had a derived period must be recalculated.
 if exists(
  select 1 from private.personal_settled_opening_lot_anchors() opening
  join public.lots l on l.id=opening.lot_id
  join public.asset_accounts asset on asset.id=l.asset_account_id
  where l.acquisition_date<=a.assessment_date and l.remaining_quantity>0
   and case
    when asset.asset_type in ('GOLD','SILVER') then true
    when asset.asset_type in ('CASH','BANK') then l.remaining_value_base>0
    -- For other assets, an explicit zero market price overrides book value.
    else coalesce(
     (coalesce(asset.metadata->>'market_price_per_unit',asset.metadata->>'market_price',
      asset.metadata->>'market_value',asset.metadata->>'estimated_value'))::numeric,
     l.remaining_value_base
    )>0
   end
   and not exists(
    select 1 from public.zakat_assessment_lines al
    where al.assessment_id=a.id and al.lot_id=l.id and al.quantity=l.remaining_quantity
   )
 ) then raise exception 'FINAL_ASSESSMENT_RECALCULATION_REQUIRED';end if;
 if exists(select 1 from public.zakat_methods m where m.id=a.method_id and m.code='UNIFIED_HAWL') then
  if a.calculation_snapshot->>'personalHawlPeriodPolicy' is distinct from 'PERSONAL_POOL_V1'
   or a.calculation_snapshot->>'personalHawlWitness' is distinct from
    private.personal_pooled_hawl_witness(c.id,a.method_id,a.assessment_date)
   then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
  if exists(
   select 1
   from public.zakat_assessment_lines al
   left join private.personal_hawl_periods_at_cutoff(c.id,a.method_id,continuity) hp on hp.lot_id=al.lot_id
   left join public.lots l on l.id=al.lot_id and l.user_id=uid
   where al.assessment_id=a.id and (
    l.remaining_quantity is distinct from al.quantity
    or (al.valuation_snapshot->'invoiceHawlPosition' is null
     and (al.valuation_snapshot->>'periodBasis'='PERSONAL_POOL_V1' or hp.period_basis='PERSONAL_POOL_V1')
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
