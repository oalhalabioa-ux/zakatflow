-- Additive: preserve existing assessments, prices, payments and original lots.
alter table public.zakat_assessment_lines add column if not exists valuation_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.guard_asset_acquisition_edit()
returns trigger language plpgsql security invoker set search_path=public as $$
declare k text;
begin
 if exists(select 1 from public.transactions where asset_account_id=old.id)
    or exists(select 1 from public.lots where asset_account_id=old.id) then
  if row(new.user_id,new.asset_type,new.currency,new.unit,new.ownership_scope,new.organization_id,new.entity_id,new.cost_center_id,new.asset_class_code,new.asset_type_code)
    is distinct from row(old.user_id,old.asset_type,old.currency,old.unit,old.ownership_scope,old.organization_id,old.entity_id,old.cost_center_id,old.asset_class_code,old.asset_type_code) then
   raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';
  end if;
  foreach k in array array['quantity','purchase_value','opening_value','purchase_price','karat','purity'] loop
   if coalesce(nullif(new.metadata->>k,'')::numeric,0) is distinct from coalesce(nullif(old.metadata->>k,'')::numeric,0) then
    raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';
   end if;
  end loop;
  foreach k in array array['purchase_date','acquisition_mode','funding_account_id'] loop
   if new.metadata->>k is distinct from old.metadata->>k then raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';end if;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists trg_asset_acquisition_edit on public.asset_accounts;
create trigger trg_asset_acquisition_edit before update on public.asset_accounts for each row execute function public.guard_asset_acquisition_edit();
revoke all on function public.guard_asset_acquisition_edit() from public,anon,authenticated;

create or replace function public.guard_zakat_assessment_snapshot()
returns trigger language plpgsql security invoker set search_path=public as $$
declare closed boolean; locked boolean;
begin
 select exists(select 1 from public.zakat_hawl_cycles c where c.id=old.hawl_cycle_id and c.status in ('CLOSED','PAID')) into closed;
 locked:=closed or coalesce((old.calculation_snapshot->>'schemaVersion')::integer,0)>=2;
 if tg_op='DELETE' then
  if locked then raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';end if;return old;
 end if;
 if closed and (new.status is distinct from old.status or new.superseded_by is distinct from old.superseded_by) then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
 if locked and (to_jsonb(new)-array['status','assessment_kind','superseded_by']) is distinct from (to_jsonb(old)-array['status','assessment_kind','superseded_by']) then
  raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';
 end if;
 if new.status='CANCELLED' and exists(select 1 from public.zakat_payment_allocations where assessment_id=old.id) then raise exception 'ASSESSMENT_HAS_PAYMENTS';end if;
 return new;
end $$;
drop trigger if exists trg_zakat_assessment_snapshot on public.zakat_assessments;
create trigger trg_zakat_assessment_snapshot before update or delete on public.zakat_assessments for each row execute function public.guard_zakat_assessment_snapshot();
revoke all on function public.guard_zakat_assessment_snapshot() from public,anon,authenticated;

create or replace function public.guard_zakat_line_snapshot()
returns trigger language plpgsql security invoker set search_path=public as $$
declare aid uuid; a public.zakat_assessments%rowtype; expected integer;
begin
 aid:=case when tg_op='INSERT' then new.assessment_id else old.assessment_id end;
 select * into a from public.zakat_assessments where id=aid;
 if exists(select 1 from public.zakat_hawl_cycles c where c.id=a.hawl_cycle_id and c.status in ('CLOSED','PAID')) then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
 if coalesce((a.calculation_snapshot->>'schemaVersion')::integer,0)>=2 then
  if tg_op<>'INSERT' then raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';end if;
  expected:=coalesce((a.calculation_snapshot->>'candidateLots')::integer,0);
  if (select count(*) from public.zakat_assessment_lines where assessment_id=aid)>=expected then raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists trg_zakat_line_snapshot on public.zakat_assessment_lines;
create trigger trg_zakat_line_snapshot before insert or update or delete on public.zakat_assessment_lines for each row execute function public.guard_zakat_line_snapshot();
revoke all on function public.guard_zakat_line_snapshot() from public,anon,authenticated;

create or replace function public.save_zakat_assessment_snapshot(p_assessment jsonb,p_lines jsonb,p_revision_of uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 uid uuid:=auth.uid(); a public.zakat_assessments%rowtype; c public.zakat_hawl_cycles%rowtype;
 m public.zakat_methods%rowtype; prev uuid; item jsonb; lot public.lots%rowtype;
 eligible numeric:=0; due numeric:=0; price numeric; fx numeric; purity numeric; basis numeric; expected_nisab numeric; base_currency text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 if jsonb_typeof(p_lines)<>'array' or coalesce((p_assessment->'calculation_snapshot'->>'schemaVersion')::integer,0)<>2
  or jsonb_array_length(p_lines) is distinct from (p_assessment->'calculation_snapshot'->>'candidateLots')::integer then raise exception 'ASSESSMENT_PAYLOAD_INVALID';end if;
 select * into m from public.zakat_methods where id=(p_assessment->>'method_id')::uuid;
 select profiles.base_currency into base_currency from public.profiles where id=uid;
 if m.id is null or m.zakat_rate is distinct from (p_assessment->>'zakat_rate')::numeric or base_currency is distinct from p_assessment->>'currency' then raise exception 'ASSESSMENT_METHOD_MISMATCH';end if;
 if p_assessment->>'hawl_cycle_id' is not null then
  select * into c from public.zakat_hawl_cycles where id=(p_assessment->>'hawl_cycle_id')::uuid and user_id=uid for update;
  if c.id is null or c.status not in ('OPEN','ACTIVE') then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
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
  price:=(item->>'valuation_price')::numeric;fx:=(item->>'fx_rate')::numeric;purity:=(item->'valuation_snapshot'->>'purity')::numeric;
  basis:=(item->>'quantity')::numeric*price*fx*purity;
  if price is null or price<0 or fx is null or fx<=0 or purity is null or purity<=0 or purity>1 or abs(basis-(item->>'market_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_VALUATION_MISMATCH';end if;
  if (item->>'zakat_amount')::numeric<0 or (item->>'eligible_value')::numeric<0 or (item->>'eligible_value')::numeric>(item->>'market_value')::numeric then raise exception 'ASSESSMENT_LINE_INVALID';end if;
  if abs((item->>'zakat_amount')::numeric-(case when item->>'eligibility_status'='ELIGIBLE' then (item->>'eligible_value')::numeric*m.zakat_rate else 0 end))>0.00000001 then raise exception 'ASSESSMENT_RATE_MISMATCH';end if;
  eligible:=eligible+(item->>'eligible_value')::numeric;due:=due+(item->>'zakat_amount')::numeric;
 end loop;
 if eligible<expected_nisab then eligible:=0;end if;
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

-- Freeze the final prices together with the final assessment, in the same transaction.
create or replace function public.close_zakat_cycle(p_cycle_id uuid,p_final_assessment_id uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;a public.zakat_assessments%rowtype;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.status not in ('OPEN','ACTIVE') then raise exception 'ACTIVE_CYCLE_NOT_FOUND';end if;
 select * into a from public.zakat_assessments where id=p_final_assessment_id and user_id=uid and hawl_cycle_id=c.id;
 if a.id is null or a.status::text in ('DRAFT','CANCELLED') or a.superseded_by is not null or c.assessment_id is distinct from a.id then raise exception 'FINAL_ASSESSMENT_NOT_IN_CYCLE';end if;
 update public.zakat_assessments set assessment_kind='FINAL' where id=a.id and user_id=uid;
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=a.id,final_zakat_due=a.zakat_due,closed_at=now(),assessment_id=a.id,
  snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('finalValuation',a.calculation_snapshot) where id=c.id and user_id=uid;
 return c.id;
end $$;
revoke all on function public.close_zakat_cycle(uuid,uuid) from public,anon;
grant execute on function public.close_zakat_cycle(uuid,uuid) to authenticated;

create or replace function public.guard_closed_zakat_cycle()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.status in ('CLOSED','PAID') then
  if tg_op='DELETE' then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
  if row(new.user_id,new.cycle_no,new.nisab_standard,new.nisab_value_base,new.hawl_start_date,new.hawl_due_date,new.assessment_id,new.final_assessment_id,new.final_zakat_due,new.valuation_date,new.gold_price,new.silver_price,new.price_mode,new.price_source)
   is distinct from row(old.user_id,old.cycle_no,old.nisab_standard,old.nisab_value_base,old.hawl_start_date,old.hawl_due_date,old.assessment_id,old.final_assessment_id,old.final_zakat_due,old.valuation_date,old.gold_price,old.silver_price,old.price_mode,old.price_source)
   or new.snapshot->'finalValuation' is distinct from old.snapshot->'finalValuation'
   or new.status not in ('CLOSED','PAID') then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists trg_closed_zakat_cycle on public.zakat_hawl_cycles;
create trigger trg_closed_zakat_cycle before update or delete on public.zakat_hawl_cycles for each row execute function public.guard_closed_zakat_cycle();
revoke all on function public.guard_closed_zakat_cycle() from public,anon,authenticated;

-- Credit prior snapshot payments by lot within the same cycle, never across cycles.
create or replace function public.allocate_zakat_payment_fifo(p_payment_id uuid)
returns table(assessment_line_id uuid, asset_account_id uuid, allocated_amount numeric, due_date date)
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_remaining numeric;
  v_payment_assessment uuid;
  v_payment_cycle uuid;
  v_payment_date date;
  r record;
  v_open numeric;
  v_take numeric;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select base_amount,assessment_id,hawl_cycle_id,payment_date into v_remaining,v_payment_assessment,v_payment_cycle,v_payment_date
  from public.zakat_payments where id=p_payment_id and user_id=v_user for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment_cycle is null then raise exception 'PAYMENT_CYCLE_REQUIRED'; end if;
  perform 1 from public.zakat_hawl_cycles where id=v_payment_cycle and user_id=v_user for update;
  if not found then raise exception 'PAYMENT_CYCLE_REQUIRED';end if;
  if v_payment_assessment is null then raise exception 'PAYMENT_ASSESSMENT_REQUIRED'; end if;
  if not exists(select 1 from public.zakat_assessments a where a.id=v_payment_assessment and a.user_id=v_user and a.hawl_cycle_id=v_payment_cycle and a.status not in ('CANCELLED','DRAFT')) then raise exception 'ASSESSMENT_NOT_IN_PAYMENT_CYCLE'; end if;
  delete from public.zakat_payment_allocations where payment_id=p_payment_id and user_id=v_user;
  for r in
    select l.id line_id,l.assessment_id,l.lot_id,l.zakat_amount,lots.asset_account_id,coalesce(nullif(l.valuation_snapshot->>'hawlDueDate','')::date,lots.hawl_due_date,a.assessment_date) line_due_date,
      coalesce((select sum(pa.allocated_amount) from public.zakat_payment_allocations pa where pa.lot_id=l.lot_id and pa.hawl_cycle_id=v_payment_cycle),0) already_paid
    from public.zakat_assessment_lines l
    join public.zakat_assessments a on a.id=l.assessment_id and a.user_id=v_user and a.hawl_cycle_id=v_payment_cycle
    left join public.lots lots on lots.id=l.lot_id and lots.user_id=v_user
    where l.assessment_id=v_payment_assessment and l.zakat_amount>0 and a.status not in ('CANCELLED','DRAFT') and coalesce(nullif(l.valuation_snapshot->>'hawlDueDate','')::date,lots.hawl_due_date,a.assessment_date)<=v_payment_date
    order by coalesce(nullif(l.valuation_snapshot->>'hawlDueDate','')::date,lots.hawl_due_date,a.assessment_date),l.id
  loop
    exit when v_remaining<=0;
    v_open:=greatest(0,r.zakat_amount-r.already_paid); if v_open<=0 then continue; end if;
    v_take:=least(v_remaining,v_open);
    insert into public.zakat_payment_allocations(user_id,payment_id,assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,due_date,hawl_cycle_id)
    values(v_user,p_payment_id,r.assessment_id,r.line_id,r.lot_id,r.asset_account_id,v_take,r.line_due_date,v_payment_cycle);
    v_remaining:=v_remaining-v_take;
  end loop;
  return query select pa.assessment_line_id,pa.asset_account_id,pa.allocated_amount,pa.due_date from public.zakat_payment_allocations pa where pa.payment_id=p_payment_id and pa.hawl_cycle_id=v_payment_cycle order by pa.due_date,pa.created_at;
end $$;
revoke all on function public.allocate_zakat_payment_fifo(uuid) from public,anon;
grant execute on function public.allocate_zakat_payment_fifo(uuid) to authenticated;
