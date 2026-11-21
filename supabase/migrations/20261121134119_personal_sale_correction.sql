create function public.correct_personal_asset_sale(
  p_sale_id uuid, p_request_id uuid, p_asset_id uuid, p_destination_id uuid,
  p_date date, p_quantity numeric, p_unit_price numeric, p_fx_rate numeric,
  p_notes text, p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid := auth.uid();
  original public.transactions%rowtype;
  receipt public.transactions%rowtype;
  target public.asset_accounts%rowtype;
  destination public.asset_accounts%rowtype;
  deposit_lot public.lots%rowtype;
  base_currency text;
  gross numeric(24,8);
  base_amount numeric(24,8);
  input jsonb;
  result jsonb;
  replacement_id uuid;
  sale_reversal uuid;
  receipt_reversal uuid;
  first_date date;
begin
  if uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_sale_id is null or p_request_id is null or p_asset_id is null or p_destination_id is null
     or p_asset_id = p_destination_id or p_date is null or p_date > (now() at time zone 'Asia/Riyadh')::date
     or p_quantity is null or not (p_quantity > 0 and p_quantity < 1e16) or round(p_quantity,8) <> p_quantity
     or p_unit_price is null or not (p_unit_price > 0 and p_unit_price < 1e16) or round(p_unit_price,8) <> p_unit_price
     or p_fx_rate is null or not (p_fx_rate > 0 and p_fx_rate < 1e16)
     or length(coalesce(p_notes,'')) > 2000 or length(trim(coalesce(p_reason,''))) not between 5 and 500
  then raise exception 'SALE_CORRECTION_INVALID'; end if;

  -- Serialize with final Zakat snapshots and concurrent corrections of this sale.
  perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
  select * into original from public.transactions where id=p_sale_id and user_id=uid for update;
  if not found or original.organization_id is not null or original.transaction_type <> 'SALE'
     or original.reversal_of_transaction_id is not null
     or original.metadata->>'asset_deleted' = 'true'
     or original.metadata ?| array['investment_id','financial_event_id','personal_contract_id']
  then raise exception 'SALE_CORRECTION_NOT_AVAILABLE'; end if;

  input := jsonb_build_object('asset_id',p_asset_id,'destination_id',p_destination_id,'date',p_date,
    'quantity',p_quantity,'unit_price',p_unit_price,'fx_rate',p_fx_rate,'notes',p_notes,'reason',trim(p_reason));
  if original.metadata ? 'sale_correction' then
    if original.metadata#>>'{sale_correction,request_id}' = p_request_id::text
       and original.metadata#>'{sale_correction,input}' = input
    then return original.metadata#>'{sale_correction,result}'; end if;
    raise exception 'SALE_CORRECTION_ALREADY_REPLACED';
  end if;

  select * into receipt from public.transactions
    where user_id=uid and organization_id is null and transfer_id=original.transfer_id
      and transaction_type='ADD' and metadata->>'source'='sale_proceeds'
      and metadata->>'sale_transaction_id'=original.id::text for update;
  if not found or receipt.asset_account_id::text is distinct from original.metadata->>'proceeds_account_id'
     or receipt.metadata->>'asset_deleted' = 'true' or receipt.base_value <> original.base_value
     or (select count(*) from public.transactions where user_id=uid and transfer_id=original.transfer_id) <> 2
  then raise exception 'SALE_CORRECTION_PROCEEDS_LINK'; end if;

  if exists(select 1 from public.transactions where user_id=uid and reversal_of_transaction_id in(original.id,receipt.id))
  then raise exception 'SALE_CORRECTION_ALREADY_REPLACED'; end if;

  perform id from public.asset_accounts
    where user_id=uid and organization_id is null and ownership_scope='PERSONAL'
      and id in(original.asset_account_id,receipt.asset_account_id,p_asset_id,p_destination_id)
    order by id for update;
  if (select count(*) from public.asset_accounts
      where user_id=uid and organization_id is null and ownership_scope='PERSONAL'
        and id in(original.asset_account_id,receipt.asset_account_id)) <> 2
  then raise exception 'SALE_CORRECTION_NOT_AVAILABLE'; end if;

  select * into target from public.asset_accounts where id=p_asset_id and user_id=uid
    and organization_id is null and ownership_scope='PERSONAL' and status='ACTIVE'
    and metadata->>'archived' is distinct from 'true' and not (metadata ? 'investment_id');
  select * into destination from public.asset_accounts where id=p_destination_id and user_id=uid
    and organization_id is null and ownership_scope='PERSONAL' and status='ACTIVE'
    and metadata->>'archived' is distinct from 'true' and asset_type in('CASH','BANK');
  select p.base_currency into base_currency from public.profiles p where p.id=uid;
  if target.id is null or destination.id is null or base_currency is null
     or original.base_currency <> base_currency or destination.currency not in(target.currency,base_currency)
     or (target.currency=base_currency and p_fx_rate<>1)
  then raise exception 'SALE_CORRECTION_ACCOUNT_OR_CURRENCY'; end if;

  gross := case when p_quantity=original.quantity
      and p_unit_price=coalesce(original.unit_price,round(original.gross_value/nullif(original.quantity,0),8))
    then original.gross_value else round(p_quantity*p_unit_price,8) end;
  base_amount := case when gross=original.gross_value and target.currency=original.currency
      and p_fx_rate=round(original.base_value/nullif(original.gross_value,0),12)
    then original.base_value else round(gross*p_fx_rate,8) end;
  if gross <= 0 or base_amount <= 0 then raise exception 'SALE_CORRECTION_INVALID'; end if;

  -- Lock inventory before checking downstream use. The two existing posting functions
  -- then run in the same transaction as these checks, reversals and the audit record.
  perform id from public.lots where user_id=uid
    and asset_account_id in(original.asset_account_id,receipt.asset_account_id,p_asset_id,p_destination_id)
    order by id for update;
  select * into deposit_lot from public.lots where user_id=uid and source_transaction_id=receipt.id;
  if not found or deposit_lot.asset_account_id <> receipt.asset_account_id
    or (select count(*) from public.lots where user_id=uid and source_transaction_id=receipt.id) <> 1
  then raise exception 'SALE_CORRECTION_PROCEEDS_LINK'; end if;
  if deposit_lot.remaining_quantity <> deposit_lot.original_quantity
     or deposit_lot.remaining_value_base <> deposit_lot.original_value_base
  then raise exception 'SALE_CORRECTION_PROCEEDS_USED'; end if;
  if (select coalesce(sum(quantity),0) from public.transaction_allocations
      where user_id=uid and transaction_id=original.id) <> original.quantity
  then raise exception 'SALE_CORRECTION_ALLOCATION_LINK'; end if;

  first_date := least(p_date,original.transaction_date);
  if exists(
    select 1 from public.transactions movement
    join public.transaction_allocations allocation on allocation.transaction_id=movement.id and allocation.user_id=uid
    where movement.user_id=uid and movement.id<>original.id
      and movement.asset_account_id in(original.asset_account_id,p_asset_id)
      and movement.transaction_date>=first_date and movement.reversal_of_transaction_id is null
      and not exists(select 1 from public.transactions reversal where reversal.user_id=uid and reversal.reversal_of_transaction_id=movement.id)
      and (p_date<>original.transaction_date or movement.asset_account_id<>original.asset_account_id
        or (movement.transaction_date,movement.created_at,movement.id)>(original.transaction_date,original.created_at,original.id))
  ) then raise exception 'SALE_CORRECTION_LATER_MOVEMENTS'; end if;

  if exists(
    select 1 from public.zakat_assessment_lines line
    join public.zakat_assessments assessment on assessment.id=line.assessment_id and assessment.user_id=uid
    join public.lots lot on lot.id=line.lot_id and lot.user_id=uid
    where assessment.assessment_kind='FINAL' and assessment.status::text<>'CANCELLED'
      and assessment.assessment_date>=first_date
      and lot.asset_account_id in(original.asset_account_id,receipt.asset_account_id,p_asset_id,p_destination_id)
  ) then raise exception 'SALE_CORRECTION_FINAL_ASSESSMENT'; end if;

  receipt_reversal := public.reverse_transaction(uid,receipt.id);
  sale_reversal := public.reverse_transaction(uid,original.id);

  -- The FIFO sale routine operates on current lots. Require sufficient quantity
  -- dated on or before the corrected sale to prevent consuming a future lot.
  if (select coalesce(sum(remaining_quantity),0) from public.lots
      where user_id=uid and asset_account_id=p_asset_id and acquisition_date<=p_date) < p_quantity
  then raise exception 'SALE_CORRECTION_INSUFFICIENT_QUANTITY'; end if;

  result := public.post_sale_with_proceeds(uid,p_asset_id,p_destination_id,p_date,p_quantity,gross,
    target.currency,base_currency,base_amount,p_notes);
  replacement_id := (result->>'sale_transaction_id')::uuid;
  result := result||jsonb_build_object('id',replacement_id,'reversed_sale_id',sale_reversal,
    'reversed_proceeds_id',receipt_reversal);

  update public.transactions set transaction_date=original.transaction_date,
    metadata=metadata||jsonb_build_object('sale_correction_reversal',true,'sale_correction_replacement_id',replacement_id)
    where user_id=uid and id in(sale_reversal,receipt_reversal);
  update public.transactions set unit_price=p_unit_price,reference=original.reference,
    metadata=metadata||jsonb_build_object('corrects_sale_id',original.id,'fx_rate',p_fx_rate,
      'cost_basis_base',result->'cost_basis_base','realized_gain_base',result->'realized_gain_base')
    where user_id=uid and id=replacement_id;
  update public.transactions set metadata=metadata||jsonb_build_object('sale_correction_replacement_id',replacement_id)
    where user_id=uid and id in(original.id,receipt.id);
  update public.transactions set metadata=metadata||jsonb_build_object('sale_correction',
    jsonb_build_object('request_id',p_request_id,'input',input,'result',result))
    where user_id=uid and id=original.id;

  insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
    values(uid,'transaction',original.id,'CORRECT_PERSONAL_SALE',to_jsonb(original),
      input||result);
  return result;
end;
$$;

revoke all on function public.correct_personal_asset_sale(uuid,uuid,uuid,uuid,date,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function public.correct_personal_asset_sale(uuid,uuid,uuid,uuid,date,numeric,numeric,numeric,text,text) to authenticated;
