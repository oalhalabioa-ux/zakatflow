-- Annual lot periods advance only after a positive, frozen final assessment.
-- Legacy final amounts, prices and payment amounts are never rewritten.
create or replace function public.zakat_next_hawl_date(p_start date,p_calendar text)
returns date language plpgsql immutable strict set search_path='' as $$
declare jd bigint;l bigint;n bigint;j bigint;mm bigint;dd bigint;yy bigint;
begin
 if p_calendar='GREGORIAN' then return (p_start+interval '1 year')::date;end if;
 if p_calendar not in ('HIJRI','HIJRI_TABULAR') then raise exception 'HAWL_CALENDAR_INVALID';end if;
 jd:=to_char(p_start,'J')::bigint;l:=jd-1948440+10632;n:=floor((l-1)::numeric/10631);l:=l-10631*n+354;
 j:=floor((10985-l)::numeric/5316)*floor((50*l)::numeric/17719)+floor(l::numeric/5670)*floor((43*l)::numeric/15238);
 l:=l-floor((30-j)::numeric/15)*floor((17719*j)::numeric/50)-floor(j::numeric/16)*floor((15238*j)::numeric/43)+29;
 mm:=floor((24*l)::numeric/709);dd:=l-floor((709*mm)::numeric/24);yy:=30*n+j-30;
 jd:=dd+ceil(29.5*(mm-1))+yy*354+floor((3+11*(yy+1))::numeric/30)+1948439;
 return to_date(jd::text,'J');
end $$;
revoke all on function public.zakat_next_hawl_date(date,text) from public,anon;
grant execute on function public.zakat_next_hawl_date(date,text) to authenticated;

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
   where al.lot_id in(select id from ancestors) and al.zakat_amount>0) last_covered
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
revoke all on function public.zakat_lot_hawl_periods(text) from public,anon;
grant execute on function public.zakat_lot_hawl_periods(text) to authenticated;

create or replace function public.save_zakat_assessment_snapshot(p_assessment jsonb,p_lines jsonb,p_revision_of uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 uid uuid:=auth.uid(); a public.zakat_assessments%rowtype; c public.zakat_hawl_cycles%rowtype;
 m public.zakat_methods%rowtype; period record;prev uuid; item jsonb; lot public.lots%rowtype;
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
  select * into period from public.zakat_lot_hawl_periods(m.calendar_type) hp where hp.lot_id=lot.id;
  if period.lot_id is null or (item->'valuation_snapshot'->>'hawlStartDate')::date is distinct from period.hawl_start_date
   or (item->'valuation_snapshot'->>'hawlDueDate')::date is distinct from period.hawl_due_date
   or (item->'valuation_snapshot'->>'hawlPeriod')::integer is distinct from period.hawl_period then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
  if period.covered_through>(p_assessment->>'assessment_date')::date then raise exception 'ASSESSMENT_BEFORE_FINAL_COVERAGE';end if;
  if period.hawl_due_date>(p_assessment->>'assessment_date')::date and item->>'eligibility_status'<>'HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_NOT_COMPLETED';end if;
  if period.hawl_due_date<=(p_assessment->>'assessment_date')::date and item->>'eligibility_status'='HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_STATUS_MISMATCH';end if;
  if public.zakat_next_hawl_date(period.hawl_due_date,m.calendar_type)<=(p_assessment->>'assessment_date')::date then raise exception 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW';end if;
  price:=(item->>'valuation_price')::numeric;fx:=(item->>'fx_rate')::numeric;purity:=(item->'valuation_snapshot'->>'purity')::numeric;
  basis:=(item->>'quantity')::numeric*price*fx*purity;
  if price is null or price<0 or fx is null or fx<=0 or purity is null or purity<=0 or purity>1 or abs(basis-(item->>'market_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_VALUATION_MISMATCH';end if;
  if (item->>'zakat_amount')::numeric<0 or (item->>'eligible_value')::numeric<0 or (item->>'eligible_value')::numeric>(item->>'market_value')::numeric then raise exception 'ASSESSMENT_LINE_INVALID';end if;
  if abs((item->>'zakat_amount')::numeric-(case when item->>'eligibility_status'='ELIGIBLE' then (item->>'eligible_value')::numeric*m.zakat_rate else 0 end))>0.00000001 then raise exception 'ASSESSMENT_RATE_MISMATCH';end if;
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
revoke all on function public.save_zakat_assessment_snapshot(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_zakat_assessment_snapshot(jsonb,jsonb,uuid) to authenticated;

create or replace function public.reconcile_final_zakat_payments()
returns void language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();p record;c record;l record;d jsonb;desired jsonb:='[]';
 remaining numeric;cycle_open numeric;line_open numeric;take numeric;existing uuid;cycle_paid numeric;idx integer;posted record;old_allocations jsonb;repaired boolean:=false;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 perform 1 from public.zakat_hawl_cycles where user_id=uid order by cycle_no,id for update;
 perform 1 from public.zakat_payments where user_id=uid order by payment_date,created_at,id for update;
 -- Preserve previously posted allocations. Only an edited/deleted/backdated payment
 -- explicitly reflows the affected part of the ledger in write_zakat_payment.
 if exists(select 1 from public.zakat_payment_allocations pa join public.zakat_hawl_cycles vc on vc.id=pa.hawl_cycle_id where pa.user_id=uid and (pa.assessment_id is distinct from vc.final_assessment_id or vc.final_assessment_id is null)) then raise exception 'EXISTING_ALLOCATION_FINAL_BASIS_REQUIRES_REVIEW';end if;
 if exists(select 1 from public.zakat_payments vp where vp.user_id=uid and (select coalesce(sum(allocated_amount),0) from public.zakat_payment_allocations where payment_id=vp.id and user_id=uid)>vp.base_amount) then raise exception 'EXISTING_PAYMENT_OVERALLOCATED';end if;
 if exists(select 1 from public.zakat_hawl_cycles vc where vc.user_id=uid and (select coalesce(sum(allocated_amount),0) from public.zakat_payment_allocations where hawl_cycle_id=vc.id and user_id=uid)>vc.final_zakat_due) then raise exception 'EXISTING_CYCLE_OVERALLOCATED';end if;
 -- Seed only valid capacity on each frozen line. Invalid legacy amounts return
 -- to the same payment and are redistributed FIFO; valid allocation IDs survive.
 select coalesce(jsonb_agg(to_jsonb(pa)),'[]') into old_allocations from public.zakat_payment_allocations pa where pa.user_id=uid;
 for posted in select pa.*,al.zakat_amount line_due,lot.asset_account_id actual_asset
  from public.zakat_payment_allocations pa join public.zakat_payments pay on pay.id=pa.payment_id and pay.user_id=uid
  join public.zakat_assessment_lines al on al.id=pa.assessment_line_id and al.assessment_id=pa.assessment_id
  join public.lots lot on lot.id=al.lot_id and lot.user_id=uid
  where pa.user_id=uid order by pay.payment_date,pay.created_at,pay.id,pa.created_at,pa.id loop
  if posted.lot_id is distinct from (select lot_id from public.zakat_assessment_lines where id=posted.assessment_line_id)
   or posted.asset_account_id is distinct from posted.actual_asset then raise exception 'EXISTING_ALLOCATION_ASSET_MISMATCH';end if;
  select greatest(0,posted.line_due-coalesce(sum((x->>'amount')::numeric),0)) into line_open from jsonb_array_elements(desired) x where x->>'line'=posted.assessment_line_id::text;
  take:=least(posted.allocated_amount,line_open);
  if take is distinct from posted.allocated_amount then repaired:=true;end if;
  if take>0 then desired:=desired||jsonb_build_array(jsonb_build_object('payment',posted.payment_id,'cycle',posted.hawl_cycle_id,'assessment',posted.assessment_id,'line',posted.assessment_line_id,'lot',posted.lot_id,'asset',posted.asset_account_id,'due',posted.due_date,'amount',take,'allocation',posted.id));end if;
 end loop;
 if (select count(*) from public.zakat_payment_allocations where user_id=uid)<>(select count(*) from public.zakat_payment_allocations pa join public.zakat_assessment_lines al on al.id=pa.assessment_line_id and al.assessment_id=pa.assessment_id join public.lots lot on lot.id=al.lot_id and lot.user_id=uid where pa.user_id=uid) then raise exception 'EXISTING_ALLOCATION_LINE_MISMATCH';end if;


 for p in select * from public.zakat_payments where user_id=uid order by payment_date,created_at,id loop
  select p.base_amount-coalesce(sum((x->>'amount')::numeric),0) into remaining from jsonb_array_elements(desired) x where x->>'payment'=p.id::text;
  for c in select * from public.zakat_hawl_cycles where user_id=uid and not coalesce((snapshot->>'historical_settled')::boolean,false) order by cycle_no,hawl_due_date,id loop
   exit when remaining<=0;
   -- Never skip an earlier cycle whose final liability is not established.
   exit when c.final_assessment_id is null or c.final_zakat_due is null;
   if not exists(select 1 from public.zakat_assessments a where a.id=c.final_assessment_id and a.user_id=uid and a.hawl_cycle_id=c.id and a.status::text not in ('DRAFT','CANCELLED') and a.zakat_due=c.final_zakat_due) then raise exception 'FINAL_BASIS_INVALID';end if;
   if (select coalesce(sum(zakat_amount),0) from public.zakat_assessment_lines where assessment_id=c.final_assessment_id) is distinct from c.final_zakat_due then raise exception 'FINAL_LINES_TOTAL_MISMATCH';end if;
   select greatest(0,c.final_zakat_due-coalesce(sum((x->>'amount')::numeric),0)) into cycle_open from jsonb_array_elements(desired) x where x->>'cycle'=c.id::text;
   for l in select al.id,al.lot_id,al.zakat_amount,lot.asset_account_id,coalesce(nullif(al.valuation_snapshot->>'hawlDueDate','')::date,lot.hawl_due_date,c.hawl_due_date) due_date from public.zakat_assessment_lines al left join public.lots lot on lot.id=al.lot_id and lot.user_id=uid where al.assessment_id=c.final_assessment_id and al.zakat_amount>0 order by coalesce(nullif(al.valuation_snapshot->>'hawlDueDate','')::date,lot.hawl_due_date,c.hawl_due_date),al.id loop
    exit when remaining<=0 or cycle_open<=0;
    select greatest(0,l.zakat_amount-coalesce(sum((x->>'amount')::numeric),0)) into line_open from jsonb_array_elements(desired) x where x->>'line'=l.id::text;
    take:=least(remaining,cycle_open,line_open);
    if take<=0 then continue;end if;
    select (ordinality-1)::integer into idx from jsonb_array_elements(desired) with ordinality x(value,ordinality) where value->>'payment'=p.id::text and value->>'line'=l.id::text limit 1;
    if idx is null then
     desired:=desired||jsonb_build_array(jsonb_build_object('payment',p.id,'cycle',c.id,'assessment',c.final_assessment_id,'line',l.id,'lot',l.lot_id,'asset',l.asset_account_id,'due',l.due_date,'amount',take));
    else
     desired:=jsonb_set(desired,array[idx::text,'amount'],to_jsonb((desired->idx->>'amount')::numeric+take));
    end if;
    remaining:=remaining-take;cycle_open:=cycle_open-take;
   end loop;
  end loop;
 end loop;
 for d in select value from jsonb_array_elements(desired) loop
  select id into existing from public.zakat_payment_allocations where user_id=uid and payment_id=(d->>'payment')::uuid and assessment_line_id=(d->>'line')::uuid order by created_at,id limit 1;
  if existing is null then
   insert into public.zakat_payment_allocations(user_id,payment_id,hawl_cycle_id,assessment_id,assessment_line_id,lot_id,asset_account_id,due_date,allocated_amount) values(uid,(d->>'payment')::uuid,(d->>'cycle')::uuid,(d->>'assessment')::uuid,(d->>'line')::uuid,(d->>'lot')::uuid,(d->>'asset')::uuid,(d->>'due')::date,(d->>'amount')::numeric) returning id into existing;
  else
   update public.zakat_payment_allocations set allocated_amount=(d->>'amount')::numeric,hawl_cycle_id=(d->>'cycle')::uuid,assessment_id=(d->>'assessment')::uuid where id=existing and (allocated_amount is distinct from (d->>'amount')::numeric or hawl_cycle_id is distinct from (d->>'cycle')::uuid or assessment_id is distinct from (d->>'assessment')::uuid);
  end if;
  d:=d||jsonb_build_object('allocation',existing);
  desired:=jsonb_set(desired,array[(select (ordinality-1)::text from jsonb_array_elements(desired) with ordinality x(value,ordinality) where value->>'payment'=d->>'payment' and value->>'line'=d->>'line' limit 1)],d);
 end loop;
 delete from public.zakat_payment_allocations pa where pa.user_id=uid and not exists(select 1 from jsonb_array_elements(desired) x where x->>'allocation'=pa.id::text);
 for c in select * from public.zakat_hawl_cycles where user_id=uid and final_assessment_id is not null and not coalesce((snapshot->>'historical_settled')::boolean,false) loop
  select coalesce(sum(allocated_amount),0) into cycle_paid from public.zakat_payment_allocations where user_id=uid and hawl_cycle_id=c.id;
  update public.zakat_hawl_cycles set status=case when cycle_paid>=final_zakat_due then 'PAID' else 'CLOSED' end where id=c.id and status is distinct from case when cycle_paid>=final_zakat_due then 'PAID' else 'CLOSED' end;
 end loop;
 if repaired then
  insert into public.audit_logs(user_id,entity_type,action,old_data,new_data) values(uid,'zakat_payment_allocations','REPAIR_INVALID_FINAL_LINE_CAPACITY',old_allocations,(select coalesce(jsonb_agg(to_jsonb(pa)),'[]') from public.zakat_payment_allocations pa where pa.user_id=uid));
 end if;
end $$;
revoke all on function public.reconcile_final_zakat_payments() from public,anon;
grant execute on function public.reconcile_final_zakat_payments() to authenticated;

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
 update public.zakat_assessments set assessment_kind='FINAL' where id=a.id and user_id=uid;
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=a.id,final_zakat_due=a.zakat_due,closed_at=now(),assessment_id=a.id,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('finalValuation',a.calculation_snapshot) where id=c.id and user_id=uid;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_hawl_cycle',c.id,'FINALIZE_AND_APPLY_CARRIED_CREDIT',jsonb_build_object('final_assessment_id',a.id,'final_zakat_due',a.zakat_due));
 return c.id;
end $$;
revoke all on function public.close_zakat_cycle(uuid,uuid) from public,anon;
grant execute on function public.close_zakat_cycle(uuid,uuid) to authenticated;

create or replace function public.guard_closed_zakat_cycle()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status in ('CLOSED','PAID') then
  if tg_op='DELETE' then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
  if row(new.hawl_start_date,new.hawl_due_date) is distinct from row(old.hawl_start_date,old.hawl_due_date) and (auth.uid() is distinct from old.user_id or current_setting('zakat.date_correction_cycle',true) is distinct from old.id::text) then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
  if row(new.user_id,new.cycle_no,new.nisab_standard,new.nisab_value_base,new.assessment_id,new.final_assessment_id,new.final_zakat_due,new.valuation_date,new.gold_price,new.silver_price,new.price_mode,new.price_source)
   is distinct from row(old.user_id,old.cycle_no,old.nisab_standard,old.nisab_value_base,old.assessment_id,old.final_assessment_id,old.final_zakat_due,old.valuation_date,old.gold_price,old.silver_price,old.price_mode,old.price_source)
   or new.snapshot->'finalValuation' is distinct from old.snapshot->'finalValuation'
   or new.status not in ('CLOSED','PAID') then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists trg_closed_zakat_cycle on public.zakat_hawl_cycles;
create trigger trg_closed_zakat_cycle before update or delete on public.zakat_hawl_cycles for each row execute function public.guard_closed_zakat_cycle();
revoke all on function public.guard_closed_zakat_cycle() from public,anon,authenticated;


create or replace function public.correct_final_zakat_cycle_dates(p_cycle_id uuid,p_start_date date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;end_date date;result jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.final_assessment_id is null then raise exception 'FINAL_CYCLE_NOT_FOUND';end if;
 select assessment_date into end_date from public.zakat_assessments where id=c.final_assessment_id and user_id=uid;
 if p_start_date is null or p_start_date>=end_date then raise exception 'CYCLE_DATE_RANGE_INVALID';end if;
 perform set_config('zakat.date_correction_cycle',c.id::text,true);
 update public.zakat_hawl_cycles set nisab_reached_date=p_start_date,hawl_start_date=p_start_date,hawl_due_date=end_date,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('cycleDateCorrection',jsonb_build_object('previousStart',c.hawl_start_date,'previousDue',c.hawl_due_date,'source','USER_CONFIRMED_DATE_CORRECTION','correctedAt',now())) where id=c.id returning to_jsonb(zakat_hawl_cycles.*) into result;
 perform set_config('zakat.date_correction_cycle','',true);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(uid,'zakat_hawl_cycle',c.id,'CORRECT_CYCLE_DATES_KEEP_FROZEN_LIABILITY',to_jsonb(c),result);
 return result;
end $$;
revoke all on function public.correct_final_zakat_cycle_dates(uuid,date) from public,anon;
grant execute on function public.correct_final_zakat_cycle_dates(uuid,date) to authenticated;
-- Repair only open successor anchors inherited from an inconsistent legacy due date.
-- Final cycles and their valuation snapshots are untouched.
do $$
declare c record;new_due date;
begin
 for c in select current.*,(a.assessment_date+1) new_start,m.calendar_type
  from public.zakat_hawl_cycles current
  join lateral(select prev.final_assessment_id from public.zakat_hawl_cycles prev where prev.user_id=current.user_id and prev.cycle_no<current.cycle_no and prev.final_assessment_id is not null order by prev.cycle_no desc limit 1) prev on true
  join public.zakat_assessments a on a.id=prev.final_assessment_id and a.user_id=current.user_id
  join public.zakat_methods m on m.id=a.method_id
  where current.status in ('OPEN','ACTIVE') and current.final_assessment_id is null loop
  new_due:=public.zakat_next_hawl_date(c.new_start,c.calendar_type);
  if c.hawl_start_date is distinct from c.new_start or c.hawl_due_date is distinct from new_due then
   update public.zakat_hawl_cycles set hawl_start_date=c.new_start,nisab_reached_date=c.new_start,hawl_due_date=new_due,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('anchorRepair',jsonb_build_object('previousStart',c.hawl_start_date,'previousDue',c.hawl_due_date,'source','PREVIOUS_FINAL_ASSESSMENT_DATE')) where id=c.id;
   insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(c.user_id,'zakat_hawl_cycle',c.id,'REPAIR_OPEN_CYCLE_FINAL_COVERAGE_ANCHOR',jsonb_build_object('start',c.hawl_start_date,'due',c.hawl_due_date),jsonb_build_object('start',c.new_start,'due',new_due));
  end if;
 end loop;
end $$;
