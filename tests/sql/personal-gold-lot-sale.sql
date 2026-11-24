-- Run only against an isolated database initialized with the repository migrations.
begin;
do $verify$
declare
  owner_id uuid := gen_random_uuid();
  bank uuid := gen_random_uuid();
  first_asset uuid := gen_random_uuid();
  second_asset uuid := gen_random_uuid();
  wrong_karat uuid := gen_random_uuid();
  lot_id uuid;
  choices jsonb;
  assessment uuid:=gen_random_uuid();
  method_id uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid();
  voucher jsonb;
  retry jsonb;
  request_id uuid := gen_random_uuid();
  sale_id uuid;
  cash_id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id||'@example.invalid',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.asset_accounts(id,user_id,asset_type,name,currency,unit,metadata,ownership_scope)
  values(first_asset,owner_id,'GOLD','QA January','SAR','g','{"karat":18}','PERSONAL'),
        (second_asset,owner_id,'GOLD','QA February','SAR','g','{"karat":18}','PERSONAL'),
        (wrong_karat,owner_id,'GOLD','QA separate group','SAR','g','{"karat":24}','PERSONAL'),
        (bank,owner_id,'BANK','QA proceeds','SAR','unit','{}','PERSONAL');
  with opening as (
    insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,
      currency,gross_value,base_currency,base_value,created_by)
    values(owner_id,first_asset,'OPENING_BALANCE','2025-01-01',4,'SAR',1200,'SAR',1200,owner_id),
          (owner_id,second_asset,'OPENING_BALANCE','2025-02-01',6,'SAR',2040,'SAR',2040,owner_id),
          (owner_id,wrong_karat,'OPENING_BALANCE','2024-01-01',10,'SAR',5000,'SAR',5000,owner_id)
    returning *
  )
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,
    original_quantity,remaining_quantity,original_value_base,remaining_value_base)
  select user_id,asset_account_id,id,transaction_date,quantity,quantity,base_value,base_value from opening;
  select id into strict lot_id from public.lots where asset_account_id=wrong_karat;
  begin
    perform public.post_personal_gold_lot_sale(request_id,18,bank,'2025-03-01',6,400,'MANUAL',
      jsonb_build_array(jsonb_build_object('id',lot_id,'quantity',6)));
    raise exception 'Wrong karat was accepted';
  exception when raise_exception then
    if sqlerrm<>'SALE_LOTS_UNAVAILABLE' then raise; end if;
  end;
  select jsonb_agg(jsonb_build_object('id',id,'quantity',case when asset_account_id=first_asset then 1 else 5 end)
    order by acquisition_date) into choices from public.lots where asset_account_id in(first_asset,second_asset);
  voucher:=public.post_personal_gold_lot_sale(request_id,18,bank,'2025-03-01',6,400,'MANUAL',choices);
  retry:=public.post_personal_gold_lot_sale(request_id,18,bank,'2025-03-01',6,400,'MANUAL',choices);
  sale_id:=(voucher->>'sale_transaction_id')::uuid;
  cash_id:=(voucher->>'proceeds_transaction_id')::uuid;
  if retry is distinct from voucher or (voucher->>'realized_gain_base')::numeric<>400
    or (select count(*) from public.transactions where user_id=owner_id and transaction_type='SALE')<>1
    or (select count(*) from public.transaction_allocations where transaction_id=sale_id)<>2
    or (select count(*) from public.transactions where user_id=owner_id and metadata->>'sale_transaction_id'=sale_id::text)<>1
    or (select sum(remaining_quantity) from public.lots where source_transaction_id=cash_id) is distinct from 2400::numeric
    or (select sum(remaining_value_base) from public.lots where asset_account_id in(first_asset,second_asset)) is distinct from 1240::numeric
  then raise exception 'Manual sale, proceeds or cost mismatch: %',voucher; end if;
  if public.asset_edit_availability(second_asset)->>'asset_registration_can_edit' is distinct from 'false'
    or public.asset_edit_availability(second_asset)->>'asset_market_valuation_can_update' is distinct from 'true'
    or public.asset_edit_availability(second_asset)#>>'{registration_lock,id}' is distinct from sale_id::text then
    raise exception 'Secondary asset lost its registration lock or valuation eligibility'; end if;
  voucher:=public.post_personal_gold_lot_sale(gen_random_uuid(),18,bank,'2025-04-01',2,380);
  if (voucher->>'realized_gain_base')::numeric<>160
    or (select sum(remaining_quantity) from public.lots where asset_account_id=bank) is distinct from 3160::numeric
  then raise exception 'Subsequent FIFO sale mismatch: %',voucher; end if;
  begin
    perform public.post_personal_gold_lot_sale(gen_random_uuid(),18,bank,'2025-03-02',1,410);
    raise exception 'Backdated allocation accepted';
  exception when raise_exception then
    if sqlerrm<>'SALE_LATER_ALLOCATION' then raise; end if;
  end;
  if (select gain_base from public.personal_asset_grouped_sales(first_asset,'2025-03-01') as s where s.sale_id=(retry->>'sale_transaction_id')::uuid) is distinct from 100::numeric then
    raise exception 'First asset gain is not 100'; end if;
  if (select gain_base from public.personal_asset_grouped_sales(second_asset,'2025-03-01')) is distinct from 300::numeric then
    raise exception 'Second asset gain is not 300'; end if;
  begin
    perform public.post_withdrawal(owner_id,bank,'2025-04-02',50,50,'SAR','SAR',50);
    begin
      perform public.reverse_grouped_gold_sale(sale_id,gen_random_uuid(),0,'QA used cash reversal');
      raise exception 'Spent proceeds reversed';
    exception when raise_exception then
      if sqlerrm<>'SALE_CORRECTION_PROCEEDS_USED' then raise; end if;
    end;
    begin
      perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),0,410,'QA used cash amendment');
      raise exception 'Spent proceeds amended';
    exception when raise_exception then
      if sqlerrm<>'SALE_CORRECTION_PROCEEDS_USED' then raise; end if;
    end;
    raise exception 'RESET_CASH_FIXTURE';
  exception when raise_exception then
    if sqlerrm<>'RESET_CASH_FIXTURE' then raise; end if;
  end;
  insert into public.zakat_methods(id,code,name_ar,name_en) values(method_id,'QA481','اختبار','Test');
  insert into public.zakat_assessments(id,user_id,assessment_date,valuation_date,method_id,nisab_standard,
    nisab_quantity,nisab_value_base,zakat_rate,currency,assessment_kind)
    values(assessment,owner_id,'2025-05-01','2025-05-01',method_id,'GOLD',85,100,0.025,'SAR','FINAL');
  insert into public.zakat_assessment_lines(assessment_id,lot_id,quantity,eligibility_status,explanation)
    select assessment,id,remaining_quantity,'ELIGIBLE','Test snapshot' from public.lots where asset_account_id=second_asset;
  begin
    perform public.post_personal_gold_lot_sale(gen_random_uuid(),18,bank,'2025-04-02',1,410);
    raise exception 'Saved assessment was ignored';
  exception when raise_exception then
    if sqlerrm<>'SALE_FINAL_ASSESSMENT' then raise; end if;
  end;
  begin
    perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),0,405,'QA second asset snapshot');
    raise exception 'Secondary asset snapshot ignored by amendment';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_FINAL_ASSESSMENT' then raise; end if;
  end;
  if (select base_value from public.transactions where id=sale_id)<>2400 or
    (select sum(remaining_quantity) from public.lots where asset_account_id=bank)<>3160 then
    raise exception 'Blocked operation changed ledger'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  if exists(select 1 from public.personal_asset_grouped_sales(first_asset,'2025-05-01')) then
    raise exception 'Foreign sale disclosed'; end if;
end $verify$;
rollback;
