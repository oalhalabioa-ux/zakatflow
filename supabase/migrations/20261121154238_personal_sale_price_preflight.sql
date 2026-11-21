-- Additive. Rollback after reverting the application: drop amend_personal_sale_price,
-- then personal_sale_preflight (see the function signatures below).
create function public.personal_sale_preflight(
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
      and m.asset_account_id in(sale.asset_account_id,p_asset_id) and m.transaction_date>=since
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

create function public.amend_personal_sale_price(
  p_sale_id uuid, p_request_id uuid, p_expected_revision integer, p_unit_price numeric, p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid := auth.uid();
  sale public.transactions%rowtype;
  receipt public.transactions%rowtype;
  deposit public.lots%rowtype;
  eligibility jsonb;
  revision integer;
  request jsonb;
  before_values jsonb;
  after_values jsonb;
  gross numeric(24,8);
  base_amount numeric(24,8);
  cash_amount numeric(24,8);
  cost numeric;
  exchange_rate numeric;
begin
  if uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_sale_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0
    or p_unit_price is null or not (p_unit_price>0 and p_unit_price<1e16)
    or round(p_unit_price,8)<>p_unit_price or length(trim(coalesce(p_reason,''))) not between 5 and 500
  then raise exception 'SALE_CORRECTION_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
  select * into sale from public.transactions where id=p_sale_id and user_id=uid and organization_id is null for update;
  if not found then raise exception 'SALE_CORRECTION_NOT_AVAILABLE'; end if;
  request:=jsonb_build_object('id',p_request_id,'revision',p_expected_revision,'unit_price',p_unit_price,'reason',trim(p_reason));
  if sale.metadata#>>'{sale_price_amendment,request,id}'=p_request_id::text then
    if sale.metadata#>'{sale_price_amendment,request}'=request then return sale.metadata#>'{sale_price_amendment,result}'; end if;
    raise exception 'SALE_CORRECTION_STALE';
  end if;
  revision:=coalesce((sale.metadata#>>'{sale_price_amendment,revision}')::integer,0);
  if revision<>p_expected_revision then raise exception 'SALE_CORRECTION_STALE'; end if;

  select * into receipt from public.transactions where user_id=uid and organization_id is null
    and transfer_id=sale.transfer_id and transaction_type='ADD' and metadata->>'source'='sale_proceeds'
    and metadata->>'sale_transaction_id'=sale.id::text for update;
  perform id from public.asset_accounts where user_id=uid and id in(sale.asset_account_id,receipt.asset_account_id)
    order by id for update;
  perform id from public.lots where user_id=uid and asset_account_id=receipt.asset_account_id order by id for update;
  eligibility:=public.personal_sale_preflight(p_sale_id);
  if eligibility->>'amount_block' is not null then raise exception '%',eligibility->>'amount_block'; end if;
  select * into strict deposit from public.lots where user_id=uid and source_transaction_id=receipt.id;

  if p_unit_price=coalesce(sale.unit_price,round(sale.gross_value/sale.quantity,8))
  then raise exception 'SALE_CORRECTION_PRICE_UNCHANGED'; end if;
  gross:=round(sale.quantity*p_unit_price,8);
  exchange_rate:=coalesce((sale.metadata#>>'{sale_price_amendment,result,exchange_rate}')::numeric,
    sale.base_value/sale.gross_value);
  base_amount:=round(gross*exchange_rate,8);
  cash_amount:=case when receipt.currency=sale.base_currency then base_amount else gross end;
  if gross<=0 or base_amount<=0 then raise exception 'SALE_CORRECTION_INVALID'; end if;
  select sum(value_base) into cost from public.transaction_allocations where user_id=uid and transaction_id=sale.id;
  before_values:=jsonb_build_object('unit_price',sale.unit_price,'sale_amount',sale.gross_value,
    'base_amount',sale.base_value,'receipt_amount',receipt.gross_value,'gain_base',sale.base_value-cost);
  after_values:=jsonb_build_object('id',sale.id,'receipt_id',receipt.id,'cash_lot_id',deposit.id,
    'unit_price',p_unit_price,'sale_amount',gross,'base_amount',base_amount,'receipt_amount',cash_amount,
    'gain_base',base_amount-cost,'cost_basis_base',cost,'exchange_rate',exchange_rate,'reason',trim(p_reason),'revision',revision+1);

  update public.transactions set gross_value=gross,base_value=base_amount,unit_price=p_unit_price,
    metadata=metadata||jsonb_build_object('fx_rate',exchange_rate,'cost_basis_base',cost,'realized_gain_base',base_amount-cost,
      'sale_price_amendment',jsonb_build_object('request',request,'revision',revision+1,'result',after_values))
    where user_id=uid and id=sale.id;
  update public.transactions set quantity=cash_amount,gross_value=cash_amount,base_value=base_amount
    where user_id=uid and id=receipt.id;
  update public.lots set original_quantity=cash_amount,remaining_quantity=cash_amount,
    original_value_base=base_amount,remaining_value_base=base_amount where user_id=uid and id=deposit.id;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
    values(uid,'transaction',sale.id,'AMEND_PERSONAL_SALE_PRICE',before_values,after_values);
  return after_values;
end;
$$;

revoke all on function public.personal_sale_preflight(uuid,uuid,uuid,date) from public,anon;
grant execute on function public.personal_sale_preflight(uuid,uuid,uuid,date) to authenticated;
revoke all on function public.amend_personal_sale_price(uuid,uuid,integer,numeric,text) from public,anon;
grant execute on function public.amend_personal_sale_price(uuid,uuid,integer,numeric,text) to authenticated;
