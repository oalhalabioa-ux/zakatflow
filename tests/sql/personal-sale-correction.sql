-- Run against disposable Supabase after applying the migrations.
begin;
set local statement_timeout='25s';
do $test$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  original_asset uuid := gen_random_uuid();
  correct_asset uuid := gen_random_uuid();
  bank uuid := gen_random_uuid();
  alternate_bank uuid := gen_random_uuid();
  original_lot uuid := gen_random_uuid();
  correct_lot uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  previous jsonb;
  corrected jsonb;
  previous_id uuid;
  receipt_id uuid;
  corrected_id uuid;
  cash_lot uuid;
  records_before integer;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,owner_id||'@sale-qa.invalid',now()),(outsider_id,outsider_id||'@sale-qa.invalid',now());
  update public.profiles set base_currency='SAR' where id=owner_id;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope) values
    (original_asset,owner_id,'GOLD','Original gold','SAR','PERSONAL'),
    (correct_asset,owner_id,'GOLD','Correct gold','SAR','PERSONAL'),
    (bank,owner_id,'BANK','Bank','SAR','PERSONAL'),
    (alternate_bank,owner_id,'CASH','Cash','SAR','PERSONAL');

  with opening as (
    insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,
      currency,gross_value,base_currency,base_value,created_by)
    values (owner_id,original_asset,'OPENING_BALANCE','2025-01-01',10,'SAR',100,'SAR',100,owner_id),
      (owner_id,correct_asset,'OPENING_BALANCE','2025-01-01',10,'SAR',140,'SAR',140,owner_id)
    returning *
  )
  insert into public.lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,
    original_quantity,remaining_quantity,original_value_base,remaining_value_base)
  select case when asset_account_id=original_asset then original_lot else correct_lot end,
    owner_id,asset_account_id,id,transaction_date,quantity,quantity,base_value,base_value from opening;

  previous:=public.post_sale_with_proceeds(owner_id,original_asset,bank,'2025-02-01',2,40,'SAR','SAR',40);
  previous_id:=(previous->>'sale_transaction_id')::uuid;
  receipt_id:=(previous->>'proceeds_transaction_id')::uuid;
  select id into cash_lot from public.lots where source_transaction_id=receipt_id;
  select count(*) into records_before from public.transactions where user_id=owner_id;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin
    perform public.correct_personal_asset_sale(previous_id,request_id,correct_asset,bank,'2025-02-01',3,30,1,'','Wrong asset');
    raise exception 'CROSS_USER_CORRECTION_SUCCEEDED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_NOT_AVAILABLE' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    perform public.correct_personal_asset_sale(previous_id,request_id,correct_asset,bank,'2025-02-01',11,30,1,'','Wrong asset');
    raise exception 'INSUFFICIENT_QUANTITY_WAS_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_INSUFFICIENT_QUANTITY' then raise; end if;
  end;
  if (select count(*) from public.transactions where user_id=owner_id)<>records_before
    or (select remaining_quantity from public.lots where id=original_lot)<>8
    or (select remaining_quantity from public.lots where id=cash_lot)<>40
  then raise exception 'FAILED_CORRECTION_CHANGED_BALANCES'; end if;

  -- Simulate consumption of proceeds in an isolated subtransaction.
  begin
    update public.lots set remaining_quantity=35,remaining_value_base=35 where id=cash_lot;
    begin
      perform public.correct_personal_asset_sale(previous_id,request_id,correct_asset,bank,'2025-02-01',3,30,1,'','Wrong asset');
      raise exception 'SPENT_RECEIPT_WAS_ACCEPTED';
    exception when raise_exception then
      if sqlerrm<>'SALE_CORRECTION_PROCEEDS_USED' then raise; end if;
    end;
    raise exception 'RESET_RECEIPT_FIXTURE';
  exception when raise_exception then
    if sqlerrm<>'RESET_RECEIPT_FIXTURE' then raise; end if;
  end;

  corrected:=public.correct_personal_asset_sale(previous_id,request_id,correct_asset,alternate_bank,
    '2025-02-02',3,30,1,'corrected notes','Wrong asset');
  corrected_id:=(corrected->>'id')::uuid;
  if (select remaining_quantity from public.lots where id=original_lot)<>10
    or (select remaining_value_base from public.lots where id=original_lot)<>100
    or (select remaining_quantity from public.lots where id=correct_lot)<>7
    or (select remaining_value_base from public.lots where id=correct_lot)<>98
    or (select remaining_quantity from public.lots where id=cash_lot)<>0
    or (select sum(remaining_quantity) from public.lots where asset_account_id=alternate_bank)<>90
    or (corrected->>'realized_gain_base')::numeric<>48
  then raise exception 'CORRECTED_BALANCES_INCORRECT'; end if;
  if not exists (select 1 from public.transactions where id=corrected_id and asset_account_id=correct_asset
     and transaction_date='2025-02-02' and unit_price=30 and gross_value=90 and metadata->>'corrects_sale_id'=previous_id::text)
    or not exists (select 1 from public.transactions where id=previous_id and gross_value=40
      and metadata->>'sale_correction_replacement_id'=corrected_id::text)
    or (select count(*) from public.transactions where reversal_of_transaction_id in(previous_id,receipt_id))<>2
    or (select count(*) from public.audit_logs where entity_id=previous_id and action='CORRECT_PERSONAL_SALE')<>1
  then raise exception 'CORRECTION_TRACE_MISSING'; end if;
  if public.correct_personal_asset_sale(previous_id,request_id,correct_asset,alternate_bank,
      '2025-02-02',3,30,1,'corrected notes','Wrong asset') is distinct from corrected
  then raise exception 'CORRECTION_RETRY_CREATED_NEW_RESULT'; end if;
  begin
    perform public.correct_personal_asset_sale(previous_id,request_id,correct_asset,alternate_bank,
      '2025-02-02',3,31,1,'corrected notes','Wrong asset');
    raise exception 'CHANGED_RETRY_WAS_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_ALREADY_REPLACED' then raise; end if;
  end;
  if (select count(*) from public.transactions where user_id=owner_id)<>records_before+4
  then raise exception 'CORRECTION_DUPLICATED_MOVEMENTS'; end if;

  previous:=public.post_sale_with_proceeds(owner_id,original_asset,bank,'2025-03-01',3,100,'SAR','SAR',100);
  corrected:=public.correct_personal_asset_sale((previous->>'sale_transaction_id')::uuid,gen_random_uuid(),
    original_asset,bank,'2025-03-01',3,33.33333333,1,'date and amount retained','Notes correction');
  corrected_id:=(corrected->>'id')::uuid;
  if not exists (select 1 from public.transactions where id=corrected_id and gross_value=100
      and base_value=100 and quantity=3 and notes='date and amount retained')
  then raise exception 'CORRECTION_ROUNDED_ORIGINAL_AMOUNT'; end if;

  corrected:=public.correct_personal_asset_sale(corrected_id,gen_random_uuid(),
    original_asset,bank,'2025-03-01',3,40,1,'price fixed','Unit price correction');
  if not exists (select 1 from public.transactions where id=(corrected->>'id')::uuid
      and gross_value=120 and unit_price=40 and quantity=3)
  then raise exception 'PRICE_ONLY_CORRECTION_FAILED'; end if;
end;
$test$;
select 'PASS personal sale correction, proceeds, FIFO cost, audit, rollback, isolation and idempotency';
rollback;
