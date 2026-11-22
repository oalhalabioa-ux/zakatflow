create table private.grouped_sale_reversals(
  sale_id uuid primary key references public.transactions(id), receipt_id uuid not null unique references public.transactions(id),
  owner_id uuid not null, request_id uuid not null, reason text not null, opening_transaction bigint not null,
  result jsonb, unique(owner_id,request_id)
);
alter table private.grouped_sale_reversals enable row level security;
revoke all on private.grouped_sale_reversals from public,anon,authenticated;
-- Candidate only. Guard legacy paths when a voucher uses multiple asset accounts.
create function public.guard_grouped_sale_changes() returns trigger language plpgsql security definer set search_path='' as $$
declare blocker uuid;
begin
  if tg_op='INSERT' then
    if new.reversal_of_transaction_id is not null and exists(
      select 1 from public.transactions reversed
      join public.transactions sale on sale.user_id=reversed.user_id and sale.metadata ? 'lot_sale_request'
        and (reversed.id=sale.id or reversed.metadata->>'sale_transaction_id'=sale.id::text)
      where reversed.id=new.reversal_of_transaction_id
    ) and not exists(select 1 from private.grouped_sale_reversals permitted where permitted.owner_id=new.user_id
      and permitted.opening_transaction=txid_current() and permitted.result is null
      and new.reversal_of_transaction_id in(permitted.sale_id,permitted.receipt_id))
    then raise exception 'GROUPED_SALE_REVERSAL_UNAVAILABLE'; end if;
  elsif old.metadata ? 'lot_sale_request' and new.base_value is distinct from old.base_value then
    if not has_function_privilege('authenticated','public.gold_card_sale(uuid,date,jsonb)','execute') then
      raise exception 'GROUPED_SALE_WRITES_DISABLED'; end if;
    select assessment.id into blocker from public.transaction_allocations alloc
    join public.lots sold on sold.id=alloc.lot_id
    join public.lots related on related.asset_account_id=sold.asset_account_id and related.user_id=sold.user_id
    join public.zakat_assessment_lines line on line.lot_id=related.id
    join public.zakat_assessments assessment on assessment.id=line.assessment_id and assessment.user_id=old.user_id
    where alloc.transaction_id=old.id and assessment.assessment_kind='FINAL'
      and assessment.status<>'CANCELLED' and assessment.assessment_date>=old.transaction_date limit 1;
    if found then raise exception 'SALE_CORRECTION_FINAL_ASSESSMENT' using detail=blocker::text; end if;
    new.metadata:=jsonb_set(new.metadata,'{lot_selection,realized_gain_base}',
      to_jsonb(new.base_value-(old.metadata#>>'{lot_selection,cost_base}')::numeric));
  end if;
  return new;
end $$;
revoke all on function public.guard_grouped_sale_changes() from public,anon,authenticated;
create trigger grouped_sale_reversal_guard before insert on public.transactions
for each row when (new.reversal_of_transaction_id is not null) execute function public.guard_grouped_sale_changes();
create trigger grouped_sale_amount_guard before update of base_value on public.transactions
for each row when (old.metadata ? 'lot_sale_request' and old.base_value is distinct from new.base_value)
execute function public.guard_grouped_sale_changes();

create function public.reverse_grouped_gold_sale(p_sale uuid,p_request uuid,p_revision integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid();
  sale public.transactions%rowtype;
  receipt uuid;
  preflight jsonb;
  blocker uuid;
  prior private.grouped_sale_reversals%rowtype;
  sale_reversal uuid;
  cash_reversal uuid;
  result_data jsonb;
begin
  if uid is null or p_sale is null or p_request is null or p_revision is null or p_revision<0
    or length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'INVALID_REVERSAL'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
  select * into strict sale from public.transactions where id=p_sale and user_id=uid and organization_id is null
    and transaction_type='SALE' and metadata ? 'lot_sale_request' for update;
  if coalesce((sale.metadata#>>'{sale_price_amendment,revision}')::int,0)<>p_revision then raise exception 'SALE_CORRECTION_STALE'; end if;
  select * into prior from private.grouped_sale_reversals where sale_id=p_sale;
  if found then
    if prior.request_id=p_request and prior.reason=trim(p_reason) then return prior.result; end if;
    raise exception 'ALREADY_REVERSED';
  end if;
  receipt:=(sale.metadata#>>'{lot_sale_result,proceeds_transaction_id}')::uuid;
  perform id from public.transactions where id=receipt and user_id=uid for update;
  perform l.id from public.lots l where l.user_id=uid and (l.source_transaction_id=receipt or exists(
    select 1 from public.transaction_allocations a where a.transaction_id=p_sale and a.lot_id=l.id)) order by l.id for update;
  preflight:=public.personal_sale_preflight(p_sale);
  if preflight->>'amount_block' is not null then raise exception '%',preflight->>'amount_block' using detail=(preflight->'movements')::text; end if;
  select later.id into blocker from public.transaction_allocations original
    join public.transaction_allocations next on next.lot_id=original.lot_id
    join public.transactions later on later.id=next.transaction_id
    where original.transaction_id=p_sale and later.user_id=uid
      and (later.transaction_date,later.created_at,later.id)>(sale.transaction_date,sale.created_at,sale.id)
      and not exists(select 1 from public.transactions r where r.reversal_of_transaction_id=later.id)
    order by later.transaction_date,later.created_at,later.id limit 1;
  if found then raise exception 'SALE_CORRECTION_LATER_MOVEMENTS' using detail=blocker::text; end if;
  select assessment.id into blocker from public.transaction_allocations a join public.lots l on l.id=a.lot_id
    join public.zakat_assessment_lines line on line.lot_id=l.id
    join public.zakat_assessments assessment on assessment.id=line.assessment_id and assessment.user_id=uid
    where a.transaction_id=p_sale and assessment.assessment_kind='FINAL' and assessment.status<>'CANCELLED'
      and assessment.assessment_date>=sale.transaction_date limit 1;
  if found then raise exception 'SALE_CORRECTION_FINAL_ASSESSMENT' using detail=blocker::text; end if;
  insert into private.grouped_sale_reversals(sale_id,receipt_id,owner_id,request_id,reason,opening_transaction)
    values(p_sale,receipt,uid,p_request,trim(p_reason),txid_current());
  cash_reversal:=public.reverse_transaction(uid,receipt);
  sale_reversal:=public.reverse_transaction(uid,p_sale);
  result_data:=jsonb_build_object('sale_reversal_id',sale_reversal,'receipt_reversal_id',cash_reversal);
  update public.transactions set metadata=metadata||jsonb_build_object('lifecycle_reversed',true) where id=p_sale;
  update private.grouped_sale_reversals set result=result_data where sale_id=p_sale;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'transaction',p_sale,
    'REVERSE_GROUPED_GOLD_SALE',result_data||jsonb_build_object('reason',trim(p_reason),'request',p_request));
  return result_data;
end $$;
revoke all on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) from public,anon;
revoke execute on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) from authenticated;
