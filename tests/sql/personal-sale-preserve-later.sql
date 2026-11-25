-- Synthetic QA only. Run in a transaction and roll it back.
do $test$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  original_asset uuid := gen_random_uuid();
  target_asset uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  first_sale jsonb;
  second_sale jsonb;
  replacement jsonb;
  first_id uuid;
  second_id uuid;
  second_receipt uuid;
  request_id uuid := gen_random_uuid();
  first_date date := '2026-11-11';
  second_date date := '2026-11-12';
  later_before jsonb;
  later_after jsonb;
  preview jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,owner_id||'@qa-preserve-sale.invalid',now()),(other_id,other_id||'@qa-preserve-sale.invalid',now());
  update public.profiles set base_currency='SAR' where id=owner_id;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.user_settings(user_id,zakatable_conversion_continuity) values(owner_id,true)
  on conflict(user_id) do update set zakatable_conversion_continuity=true;
  insert into public.asset_accounts(id,user_id,asset_type,name,currency,unit,is_zakatable,ownership_scope,metadata)
  values (original_asset,owner_id,'GOLD','QA original gold','SAR','g',true,'PERSONAL','{"karat":24}'),
         (target_asset,owner_id,'GOLD','QA target gold','SAR','g',true,'PERSONAL','{"karat":24}'),
         (cash,owner_id,'CASH','QA cash','SAR','SAR',true,'PERSONAL','{}');
  with opening as (
    insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,
      currency,gross_value,base_currency,base_value,created_by)
    values (owner_id,original_asset,'OPENING_BALANCE','2026-05-19',100,'SAR',54000,'SAR',54000,owner_id),
           (owner_id,target_asset,'OPENING_BALANCE','2026-05-12',312,'SAR',180000.000336,'SAR',180000.000336,owner_id)
    returning *
  )
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,
    hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
  select owner_id,asset_account_id,id,transaction_date,transaction_date,public.zakat_next_hawl_date(transaction_date,'HIJRI'),
    quantity,quantity,base_value,base_value from opening;

  first_sale:=public.post_sale_with_proceeds(owner_id,original_asset,cash,first_date,50,23981.25,'SAR','SAR',23981.25);
  second_sale:=public.post_sale_with_proceeds(owner_id,target_asset,cash,second_date,260,123484.40,'SAR','SAR',123484.40);
  first_id:=(first_sale->>'sale_transaction_id')::uuid;
  second_id:=(second_sale->>'sale_transaction_id')::uuid;
  second_receipt:=(second_sale->>'proceeds_transaction_id')::uuid;
  set constraints all immediate;

  select jsonb_build_object(
    'vouchers',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where id in (second_id,second_receipt)),
    'numbers',(select jsonb_agg(to_jsonb(v) order by source_id) from public.voucher_numbers v where source_id in(second_id,second_receipt)),
    'allocations',(select jsonb_agg(to_jsonb(a) order by id) from public.transaction_allocations a where transaction_id=second_id),
    'hawl',(select jsonb_agg(to_jsonb(h) order by source_lot_id) from public.gold_receipt_assessment_periods(second_receipt,'HIJRI') h)
  ) into later_before;
  if jsonb_array_length(later_before->'numbers') is distinct from 2
    or jsonb_array_length(later_before->'hawl') is distinct from 1
    or (later_before#>>'{allocations,0,value_base}')::numeric is distinct from 150000.00028
  then raise exception 'LATER_SALE_FIXTURE_INVALID'; end if;

  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if private.can_reassign_personal_gold_sale(first_id,target_asset,first_date) then raise exception 'CROSS_USER_PROOF'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  preview:=public.personal_sale_preflight(first_id,target_asset,cash,first_date);
  if preview->>'structural_block' is not null or (preview->>'preserves_later_allocations')::boolean is distinct from true
  then raise exception 'PRESERVATION_PREFLIGHT_FAILED %', preview; end if;
  begin
    perform public.correct_personal_asset_sale(first_id,request_id,target_asset,cash,first_date,51,479.625,1,'','Cannot change quantity');
    raise exception 'CHANGED_QUANTITY_WAS_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_LATER_MOVEMENTS' then raise; end if;
  end;
  begin
    perform public.post_sale_with_proceeds(owner_id,target_asset,cash,'2026-11-13',3,1200,'SAR','SAR',1200);
    if public.personal_sale_preflight(first_id,target_asset,cash,first_date)->>'structural_block'
      is distinct from 'SALE_CORRECTION_LATER_MOVEMENTS' then raise exception 'STALE_BALANCE_PREFLIGHT_ACCEPTED'; end if;
    begin
      perform public.correct_personal_asset_sale(first_id,request_id,target_asset,cash,first_date,50,479.625,1,'','Stale preview');
      raise exception 'STALE_BALANCE_WAS_ACCEPTED';
    exception when raise_exception then
      if sqlerrm<>'SALE_CORRECTION_LATER_MOVEMENTS' then raise; end if;
    end;
    raise exception 'UNDO_STALE_BALANCE_FIXTURE';
  exception when raise_exception then
    if sqlerrm<>'UNDO_STALE_BALANCE_FIXTURE' then raise; end if;
  end;

  set constraints all deferred;
  replacement:=public.correct_personal_asset_sale(first_id,request_id,target_asset,cash,first_date,50,479.625,1,'','Select the recorded source asset');
  set constraints all immediate;
  if public.correct_personal_asset_sale(first_id,request_id,target_asset,cash,first_date,50,479.625,1,'','Select the recorded source asset')
    is distinct from replacement then raise exception 'REPLAY_CHANGED_RESULT'; end if;
  select jsonb_build_object(
    'vouchers',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where id in (second_id,second_receipt)),
    'numbers',(select jsonb_agg(to_jsonb(v) order by source_id) from public.voucher_numbers v where source_id in(second_id,second_receipt)),
    'allocations',(select jsonb_agg(to_jsonb(a) order by id) from public.transaction_allocations a where transaction_id=second_id),
    'hawl',(select jsonb_agg(to_jsonb(h) order by source_lot_id) from public.gold_receipt_assessment_periods(second_receipt,'HIJRI') h)
  ) into later_after;
  if later_before is distinct from later_after
    or exists(select 1 from public.transactions where reversal_of_transaction_id in(second_id,second_receipt))
    or (select sum(remaining_quantity) from public.lots where asset_account_id=original_asset) is distinct from 100
    or (select sum(remaining_quantity) from public.lots where asset_account_id=target_asset) is distinct from 2
    or (select sum(remaining_value_base) from public.lots where asset_account_id=target_asset) is distinct from 1153.846156
    or (select sum(remaining_value_base) from public.lots where asset_account_id=cash) is distinct from 147465.65
    or not exists(select 1 from public.transactions where id=(replacement->>'sale_transaction_id')::uuid
      and asset_account_id=target_asset and transaction_date=first_date and quantity=50 and base_value=23981.25)
    or not exists (select 1 from public.gold_receipt_assessment_periods((replacement->>'proceeds_transaction_id')::uuid,'HIJRI')
      where period_start='2026-05-12' and remaining_base=23981.25)
    or (select count(*) from public.transactions where reversal_of_transaction_id in(first_id,(first_sale->>'proceeds_transaction_id')::uuid))<>2
  then raise exception 'REPLACEMENT_CHANGED_PROTECTED_HISTORY'; end if;
  reset role;
end;
$test$;
select 'PASS original sale date, later sale/receipt, voucher numbers, FIFO cost, Hawl, stale balance and retry' as result;
