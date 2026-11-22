create or replace function public.correct_personal_asset_sale(
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
      -- A transaction on a different destination asset before the proposed sale
      -- precedes its FIFO effect. Keep the conservative guard for every other movement.
      and not (movement.asset_account_id=p_asset_id and p_asset_id<>original.asset_account_id
        and movement.transaction_date<p_date
        and not exists (
          select 1 from public.transaction_allocations dependent
          join public.lots lot on lot.id=dependent.lot_id
          join public.transactions entry on entry.id=dependent.transaction_id
          where dependent.user_id=uid and entry.user_id=uid and
            ((lot.asset_account_id=p_asset_id and entry.transaction_date>=p_date)
             or (lot.asset_account_id in(original.asset_account_id,receipt.asset_account_id,p_destination_id)
                 and entry.id<>original.id and entry.transaction_date>=least(p_date,original.transaction_date)))
        ))
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

-- Additive. Rollback after reverting the application: drop amend_personal_sale_price,
-- then personal_sale_preflight (see the function signatures below).
create or replace function public.personal_sale_preflight(
  p_sale_id uuid, p_asset_id uuid default null, p_destination_id uuid default null,
  p_date date default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  uid uuid := auth.uid();
  sale public.transactions%rowtype;
  receipt public.transactions%rowtype;
  deposit public.lots%rowtype;
  target public.asset_accounts%rowtype;
  bank public.asset_accounts%rowtype;
  base text;
  since date;
  common_block text;
  price_block text;
  structural_block text;
  movements jsonb := '[]'::jsonb;
  cash_movements jsonb;
begin
  if uid is null then raise exception 'UNAUTHORIZED'; end if;
  select * into sale from public.transactions where id=p_sale_id and user_id=uid;
  if not found or sale.organization_id is not null or sale.transaction_type<>'SALE'
    or sale.reversal_of_transaction_id is not null or sale.quantity<=0 or sale.gross_value<=0 or sale.base_value<=0
    or sale.metadata->>'asset_deleted'='true'
    or sale.metadata ?| array['investment_id','financial_event_id','personal_contract_id']
  then return jsonb_build_object('amount_block','SALE_CORRECTION_NOT_AVAILABLE',
    'structural_block','SALE_CORRECTION_NOT_AVAILABLE','movements',movements); end if;

  select * into receipt from public.transactions where user_id=uid and organization_id is null
    and transfer_id=sale.transfer_id and transaction_type='ADD' and metadata->>'source'='sale_proceeds'
    and metadata->>'sale_transaction_id'=sale.id::text;
  select * into deposit from public.lots where user_id=uid and source_transaction_id=receipt.id;
  select p.base_currency into base from public.profiles p where p.id=uid;

  if sale.metadata ? 'sale_correction' or exists(
    select 1 from public.transactions where user_id=uid and reversal_of_transaction_id in(sale.id,receipt.id)
  ) then common_block:='SALE_CORRECTION_ALREADY_REPLACED';
  elsif receipt.id is null or deposit.id is null or deposit.asset_account_id<>receipt.asset_account_id
    or receipt.asset_account_id::text is distinct from sale.metadata->>'proceeds_account_id'
    or receipt.metadata->>'asset_deleted'='true' or receipt.base_value<>sale.base_value
    or receipt.base_currency<>sale.base_currency or receipt.transaction_date<>sale.transaction_date
    or deposit.acquisition_date<>receipt.transaction_date or deposit.original_quantity<>receipt.quantity
    or deposit.original_value_base<>receipt.base_value
    or receipt.quantity<>(case when receipt.currency=sale.base_currency then sale.base_value else sale.gross_value end)
    or receipt.gross_value<>receipt.quantity or receipt.unit_price is distinct from 1
    or (select count(*) from public.transactions where user_id=uid and transfer_id=sale.transfer_id)<>2
    or (select count(*) from public.lots where user_id=uid and source_transaction_id=receipt.id)<>1
  then common_block:='SALE_CORRECTION_PROCEEDS_LINK';
  elsif deposit.remaining_quantity<>deposit.original_quantity or deposit.remaining_value_base<>deposit.original_value_base
    or exists(select 1 from public.transaction_allocations where user_id=uid and lot_id=deposit.id)
    or exists(select 1 from public.lots where user_id=uid and hawl_continuity_source_lot_id=deposit.id)
  then common_block:='SALE_CORRECTION_PROCEEDS_USED';
  elsif (select coalesce(sum(quantity),0) from public.transaction_allocations where user_id=uid and transaction_id=sale.id)<>sale.quantity
  then common_block:='SALE_CORRECTION_ALLOCATION_LINK';
  end if;

  if common_block is not null then
    if common_block='SALE_CORRECTION_PROCEEDS_USED' then
      select coalesce(jsonb_agg(to_jsonb(blocker)),'[]'::jsonb) into movements from (
        select distinct m.id,m.transaction_date as date,m.transaction_type as type
        from public.transaction_allocations a join public.transactions m on m.id=a.transaction_id and m.user_id=uid
        where a.user_id=uid and a.lot_id=deposit.id order by date,id limit 12
      ) blocker;
    end if;
    return jsonb_build_object('amount_block',common_block,'structural_block',common_block,'movements',movements);
  end if;

  p_asset_id:=coalesce(p_asset_id,sale.asset_account_id);
  p_destination_id:=coalesce(p_destination_id,receipt.asset_account_id);
  p_date:=coalesce(p_date,sale.transaction_date);
  since:=least(p_date,sale.transaction_date);
  select * into target from public.asset_accounts where id=p_asset_id and user_id=uid and organization_id is null
    and ownership_scope='PERSONAL' and status='ACTIVE' and metadata->>'archived' is distinct from 'true'
    and not (metadata ? 'investment_id');
  select * into bank from public.asset_accounts where id=p_destination_id and user_id=uid and organization_id is null
    and ownership_scope='PERSONAL' and status='ACTIVE' and metadata->>'archived' is distinct from 'true'
    and asset_type in('CASH','BANK');
  if target.id is null or bank.id is null or target.id=bank.id or base is distinct from sale.base_currency
    or bank.currency not in(target.currency,base)
  then structural_block:='SALE_CORRECTION_ACCOUNT_OR_CURRENCY'; end if;

  -- The price path keeps the existing accounts, currency, date and allocation rows.
  if base is distinct from sale.base_currency or receipt.currency not in(sale.currency,sale.base_currency)
    or (sale.currency=sale.base_currency and sale.gross_value<>sale.base_value)
    or not exists(select 1 from public.asset_accounts where id=sale.asset_account_id and user_id=uid
      and organization_id is null and ownership_scope='PERSONAL' and currency=sale.currency
      and asset_type not in('BANK','CASH','RECEIVABLE'))
    or not exists(select 1 from public.asset_accounts where id=receipt.asset_account_id and user_id=uid
      and organization_id is null and ownership_scope='PERSONAL' and currency=receipt.currency and asset_type in('BANK','CASH'))
  then price_block:='SALE_CORRECTION_ACCOUNT_OR_CURRENCY'; end if;

  if exists(
    select 1 from public.zakat_assessment_lines line
    join public.zakat_assessments a on a.id=line.assessment_id and a.user_id=uid
    join public.lots l on l.id=line.lot_id and l.user_id=uid
    where a.assessment_kind='FINAL' and a.status::text<>'CANCELLED' and a.assessment_date>=sale.transaction_date
      and l.asset_account_id in(sale.asset_account_id,receipt.asset_account_id)
  ) then price_block:=coalesce(price_block,'SALE_CORRECTION_FINAL_ASSESSMENT'); end if;

  if structural_block is null and exists(
    select 1 from public.zakat_assessment_lines line
    join public.zakat_assessments a on a.id=line.assessment_id and a.user_id=uid
    join public.lots l on l.id=line.lot_id and l.user_id=uid
    where a.assessment_kind='FINAL' and a.status::text<>'CANCELLED' and a.assessment_date>=since
      and l.asset_account_id in(sale.asset_account_id,receipt.asset_account_id,p_asset_id,p_destination_id)
  ) then structural_block:='SALE_CORRECTION_FINAL_ASSESSMENT'; end if;

  select coalesce(jsonb_agg(to_jsonb(blocker)),'[]'::jsonb) into movements from (
    select m.id,m.transaction_date as date,m.transaction_type as type,
      exists(select 1 from public.transaction_allocations next
        join public.transaction_allocations prev on prev.lot_id=next.lot_id and prev.user_id=uid
        where next.transaction_id=m.id and next.user_id=uid and prev.transaction_id=sale.id) as same_lot
    from public.transactions m
    where m.user_id=uid and m.organization_id is null and m.id<>sale.id
      and m.asset_account_id in(sale.asset_account_id,p_asset_id) -- A transaction on a different destination asset before the proposed sale
      -- precedes its FIFO effect. Keep the conservative guard for every other movement.
      and not (m.asset_account_id=p_asset_id and p_asset_id<>sale.asset_account_id
        and m.transaction_date<p_date
        and not exists (
          select 1 from public.transaction_allocations dependent
          join public.lots lot on lot.id=dependent.lot_id
          join public.transactions entry on entry.id=dependent.transaction_id
          where dependent.user_id=uid and entry.user_id=uid and
            ((lot.asset_account_id=p_asset_id and entry.transaction_date>=p_date)
             or (lot.asset_account_id in(sale.asset_account_id,receipt.asset_account_id,p_destination_id)
                 and entry.id<>sale.id and entry.transaction_date>=least(p_date,sale.transaction_date)))
        ))
      and m.transaction_date>=since
      and m.reversal_of_transaction_id is null
      and exists(select 1 from public.transaction_allocations a where a.user_id=uid and a.transaction_id=m.id)
      and not exists(select 1 from public.transactions r where r.user_id=uid and r.reversal_of_transaction_id=m.id)
      and (p_date<>sale.transaction_date or m.asset_account_id<>sale.asset_account_id
        or (m.transaction_date,m.created_at,m.id)>(sale.transaction_date,sale.created_at,sale.id))
    order by m.transaction_date,m.created_at,m.id limit 12
  ) blocker;
  if jsonb_array_length(movements)>0 then
    structural_block:=coalesce(structural_block,'SALE_CORRECTION_LATER_MOVEMENTS');
  end if;

  -- This lot may remain intact even if a historically newer cash lot was allocated.
  -- Increasing the receipt would change historical cash FIFO in that case.
  if price_block is null then
    select coalesce(jsonb_agg(to_jsonb(blocker)),'[]'::jsonb) into cash_movements from (
      select m.id,m.transaction_date as date,m.transaction_type as type,false as same_lot
      from public.transactions m
      where m.user_id=uid and m.organization_id is null and m.asset_account_id=receipt.asset_account_id
        and m.transaction_date>=receipt.transaction_date and m.reversal_of_transaction_id is null
        and not exists(select 1 from public.transactions r where r.user_id=uid and r.reversal_of_transaction_id=m.id)
        and exists(select 1 from public.transaction_allocations a join public.lots l on l.id=a.lot_id and l.user_id=uid
          where a.user_id=uid and a.transaction_id=m.id
            and (l.acquisition_date,l.created_at,l.id)>(deposit.acquisition_date,deposit.created_at,deposit.id))
      order by m.transaction_date,m.created_at,m.id limit 12
    ) blocker having count(*)>0;
    if cash_movements is not null then
      price_block:='SALE_CORRECTION_CASH_FIFO';
      structural_block:=coalesce(structural_block,price_block);
      return jsonb_build_object('amount_block',price_block,'structural_block',structural_block,'movements',cash_movements);
    end if;
  end if;
  return jsonb_build_object('amount_block',price_block,'structural_block',structural_block,'movements',coalesce(movements,'[]'::jsonb));
end;
$$;

