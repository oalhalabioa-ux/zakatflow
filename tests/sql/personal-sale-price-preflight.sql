begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid();
  outsider_id uuid:=gen_random_uuid();
  asset uuid:=gen_random_uuid();
  other_asset uuid:=gen_random_uuid();
  bank uuid:=gen_random_uuid();
  cash uuid:=gen_random_uuid();
  sale jsonb;
  later jsonb;
  sale_id uuid;
  receipt_id uuid;
  cash_lot uuid;
  allocations jsonb;
  result jsonb;
  eligibility jsonb;
  request_id uuid:=gen_random_uuid();
  assessment uuid:=gen_random_uuid();
  method uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,owner_id||'@price.invalid',now()),(outsider_id,outsider_id||'@price.invalid',now());
  update public.profiles set base_currency='SAR' where id=owner_id;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope) values
    (asset,owner_id,'GOLD','Gold','USD','PERSONAL'),
    (other_asset,owner_id,'GOLD','Other gold','USD','PERSONAL'),
    (bank,owner_id,'BANK','SAR account','SAR','PERSONAL'),(cash,owner_id,'BANK','USD account','USD','PERSONAL');
  with opening as (
    insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,
      currency,gross_value,base_currency,base_value,created_by)
    values (owner_id,asset,'OPENING_BALANCE','2025-01-01',10,'USD',100,'SAR',375,owner_id),
           (owner_id,other_asset,'OPENING_BALANCE','2025-01-01',10,'USD',100,'SAR',375,owner_id)
    returning *
  )
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,
    original_quantity,remaining_quantity,original_value_base,remaining_value_base)
  select owner_id,asset_account_id,id,transaction_date,quantity,quantity,base_value,base_value from opening;

  sale:=public.post_sale_with_proceeds(owner_id,asset,bank,'2025-02-01',2,40,'USD','SAR',150);
  later:=public.post_sale_with_proceeds(owner_id,asset,cash,'2025-02-02',3,90,'USD','SAR',337.5);
  sale_id:=(sale->>'sale_transaction_id')::uuid;
  receipt_id:=(sale->>'proceeds_transaction_id')::uuid;
  select id into cash_lot from public.lots where source_transaction_id=receipt_id;
  select jsonb_agg(to_jsonb(a) order by id) into allocations from public.transaction_allocations a
    where transaction_id in(sale_id,(later->>'sale_transaction_id')::uuid);

  eligibility:=public.personal_sale_preflight(sale_id);
  if eligibility->>'amount_block' is not null or eligibility->>'structural_block' is distinct from 'SALE_CORRECTION_LATER_MOVEMENTS'
    or eligibility#>>'{movements,0,id}' is distinct from later->>'sale_transaction_id'
    or eligibility#>>'{movements,0,same_lot}' is distinct from 'true'
  then raise exception 'BAD_PREFLIGHT: %',eligibility; end if;
  if public.personal_sale_preflight(sale_id,other_asset,bank,'2025-02-01')->>'structural_block'
     is distinct from 'SALE_CORRECTION_LATER_MOVEMENTS'
  then raise exception 'ASSET_CHANGE_PREFLIGHT_MISSED_BLOCKER'; end if;
  if public.personal_sale_preflight(sale_id,asset,bank,'2025-01-31')->>'structural_block'
     is distinct from 'SALE_CORRECTION_LATER_MOVEMENTS'
  then raise exception 'DATE_CHANGE_PREFLIGHT_MISSED_BLOCKER'; end if;

  begin
    perform public.correct_personal_asset_sale(sale_id,gen_random_uuid(),asset,bank,'2025-02-01',2,30,3.75,null,'Reprice older sale');
    raise exception 'OLD_ROUTE_DID_NOT_REPRODUCE';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_LATER_MOVEMENTS' then raise; end if;
  end;
  begin
    perform public.correct_personal_asset_sale(sale_id,gen_random_uuid(),asset,bank,'2025-02-01',1,30,3.75,null,'Quantity edit');
    raise exception 'QUANTITY_GUARD_LOST';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_LATER_MOVEMENTS' then raise; end if;
  end;

  if (select sum(remaining_quantity) from public.lots where asset_account_id=asset)<>5
    or (select remaining_value_base from public.lots where id=cash_lot)<>150
  then raise exception 'BAD_STARTING_BALANCES'; end if;
  result:=public.amend_personal_sale_price(sale_id,request_id,0,30,'Reprice older sale');
  if result->>'id'<>sale_id::text or (result->>'gain_base')::numeric<>150
    or (select gross_value from public.transactions where id=sale_id)<>60
    or (select base_value from public.transactions where id=receipt_id)<>225
    or (select remaining_quantity from public.lots where id=cash_lot)<>225
    or (select sum(remaining_quantity) from public.lots where asset_account_id=asset)<>5
    or (select sum(remaining_value_base) from public.lots where asset_account_id=asset)<>187.5
    or allocations is distinct from (select jsonb_agg(to_jsonb(a) order by id) from public.transaction_allocations a
      where transaction_id in(sale_id,(later->>'sale_transaction_id')::uuid))
  then raise exception 'REPRICE_CHANGED_FIFO_OR_WRONG_BALANCE: %',result; end if;
  if public.amend_personal_sale_price(sale_id,request_id,0,30,'Reprice older sale') is distinct from result
    or (select count(*) from public.audit_logs where entity_id=sale_id and action='AMEND_PERSONAL_SALE_PRICE')<>1
  then raise exception 'PRICE_RETRY_NOT_IDEMPOTENT'; end if;
  begin
    perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),0,29,'Stale page save');
    raise exception 'STALE_PRICE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_STALE' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  if public.personal_sale_preflight(sale_id)->>'amount_block' is distinct from 'SALE_CORRECTION_NOT_AVAILABLE'
    or public.personal_sale_preflight(sale_id)->'movements' is distinct from '[]'::jsonb
  then raise exception 'FOREIGN_PREFLIGHT_DISCLOSED_MOVEMENTS'; end if;
  begin
    perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),1,35,'Foreign review');
    raise exception 'FOREIGN_PRICE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_NOT_AVAILABLE' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    update public.lots set remaining_quantity=200,remaining_value_base=200 where id=cash_lot;
    begin
      perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),1,35,'Proceeds used');
      raise exception 'SPENT_PRICE_ACCEPTED';
    exception when raise_exception then
      if sqlerrm<>'SALE_CORRECTION_PROCEEDS_USED' then raise; end if;
    end;
    raise exception 'RESET_FIXTURE';
  exception when raise_exception then
    if sqlerrm<>'RESET_FIXTURE' then raise; end if;
  end;

  reset role;
  insert into public.zakat_methods(id,code,name_ar,name_en) values(method,'QA_471','QA 471','QA 471');
  insert into public.zakat_assessments(id,user_id,assessment_date,valuation_date,method_id,nisab_standard,
    nisab_quantity,nisab_value_base,zakat_rate,currency,assessment_kind)
  values(assessment,owner_id,'2025-03-01','2025-03-01',method,'GOLD',85,100,0.025,'SAR','FINAL');
  insert into public.zakat_assessment_lines(assessment_id,lot_id,quantity,eligibility_status,explanation)
    values(assessment,cash_lot,225,'ELIGIBLE','Test final snapshot');
  set local role authenticated;
  begin
    perform public.amend_personal_sale_price(sale_id,gen_random_uuid(),1,35,'Final assessment');
    raise exception 'FINAL_ZAKAT_PRICE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'SALE_CORRECTION_FINAL_ASSESSMENT' then raise; end if;
  end;
  if (select gross_value from public.transactions where id=sale_id)<>60
    or (select remaining_quantity from public.lots where id=cash_lot)<>225
  then raise exception 'BLOCKED_PRICE_CHANGED_BALANCE'; end if;
end;
$test$;
select 'PASS historical sale repriced: USD 40 to 60; SAR bank 150 to 225; asset units 5 to 5, cost 187.50 to 187.50, original/later FIFO rows unchanged';
rollback;
