-- Candidate only. Guard legacy paths when a voucher uses multiple asset accounts.
create function public.guard_grouped_sale_changes() returns trigger language plpgsql security invoker set search_path='' as $$
declare blocker uuid;
begin
  if tg_op='INSERT' then
    if new.reversal_of_transaction_id is not null and exists(
      select 1 from public.transactions reversed
      join public.transactions sale on sale.user_id=reversed.user_id and sale.metadata ? 'lot_sale_request'
        and (reversed.id=sale.id or reversed.metadata->>'sale_transaction_id'=sale.id::text)
      where reversed.id=new.reversal_of_transaction_id
    ) then raise exception 'GROUPED_SALE_REVERSAL_UNAVAILABLE'; end if;
  elsif old.metadata ? 'lot_sale_request' and new.base_value is distinct from old.base_value then
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
create trigger grouped_sale_change_guard before insert or update of base_value on public.transactions
for each row execute function public.guard_grouped_sale_changes();
