-- Forward only. No acquisition, withdrawal, allocation or lot is rewritten.
create function private.fund_personal_asset_purchase(p_purchase_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  purchase public.transactions%rowtype;
  account public.asset_accounts%rowtype;
  lot public.lots%rowtype;
  withdrawal_id uuid;
  currency_scale integer;
  invoice_total numeric;
  paid numeric(24,8);
  requested numeric;
  unallocated numeric(24,8);
  units numeric(24,8);
  carrying numeric(24,8);
  cash_basis numeric(24,8) := 0;
  asset_basis numeric(24,8);
  evidence jsonb;
begin
  select * into strict purchase from public.transactions
    where id=p_purchase_id and user_id=actor and organization_id is null
      and transaction_type='PURCHASE' for update;
  if purchase.metadata ? 'purchase_funding' then raise exception 'PERSONAL_PURCHASE_ALREADY_FUNDED'; end if;
  select * into account from public.asset_accounts
    where id=nullif(purchase.metadata->>'funding_account_id','')::uuid and user_id=actor
      and ownership_scope='PERSONAL' and organization_id is null and asset_type in ('CASH','BANK')
    for update;
  if not found or account.id=purchase.asset_account_id then
    raise exception 'PERSONAL_PURCHASE_FUNDING_ACCOUNT_INVALID';
  end if;
  select decimals into currency_scale from public.currencies where code=account.currency;
  if currency_scale is null or currency_scale not between 0 and 8 then
    raise exception 'PERSONAL_PURCHASE_FUNDING_PRECISION_INVALID';
  end if;
  invoice_total := purchase.gross_value + (purchase.metadata->>'vat_amount')::numeric;
  requested := nullif(purchase.metadata->>'funding_amount','')::numeric;
  if account.currency=purchase.currency then
    paid := round(invoice_total,currency_scale);
    if requested is not null and requested<>paid then
      raise exception 'PERSONAL_PURCHASE_PAYMENT_MISMATCH';
    end if;
  else
    if requested is null or purchase.metadata->>'funding_currency' is distinct from account.currency then
      raise exception 'PERSONAL_PURCHASE_PAYMENT_REQUIRED';
    end if;
    if requested<=0 or requested>=1e16 or requested<>round(requested,currency_scale) then
      raise exception 'PERSONAL_PURCHASE_PAYMENT_INVALID';
    end if;
    paid := requested;
  end if;
  if paid<=0 then raise exception 'PERSONAL_PURCHASE_PAYMENT_INVALID'; end if;

  perform 1 from public.lots where asset_account_id=account.id and user_id=actor
    and remaining_quantity>0 and acquisition_date<=purchase.transaction_date
    order by acquisition_date,created_at,id for update;
  if coalesce((select sum(remaining_quantity) from public.lots where asset_account_id=account.id
    and user_id=actor and remaining_quantity>0 and acquisition_date<=purchase.transaction_date),0)<paid then
    raise exception 'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS';
  end if;

  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,
    quantity,currency,gross_value,base_currency,base_value,metadata,created_by)
  values(actor,account.id,'WITHDRAWAL',purchase.transaction_date,paid,account.currency,paid,
    purchase.base_currency,0,jsonb_build_object('source','ASSET_PURCHASE',
      'purchase_transaction_id',purchase.id),actor)
  returning id into withdrawal_id;

  unallocated := paid;
  for lot in select * from public.lots where asset_account_id=account.id and user_id=actor
    and remaining_quantity>0 and acquisition_date<=purchase.transaction_date
    order by acquisition_date,created_at,id for update
  loop
    exit when unallocated=0;
    units := least(unallocated,lot.remaining_quantity);
    carrying := case when units=lot.remaining_quantity then lot.remaining_value_base
      else round(lot.remaining_value_base*units/lot.remaining_quantity,8) end;
    if carrying<0 then raise exception 'PERSONAL_PURCHASE_LOT_BASIS_INVALID'; end if;
    insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
      values(actor,withdrawal_id,lot.id,units,carrying,'FIFO');
    update public.lots set remaining_quantity=lot.remaining_quantity-units,
      remaining_value_base=lot.remaining_value_base-carrying,
      status=case when units=lot.remaining_quantity then 'CLOSED'::public.lot_status
        else 'PARTIALLY_USED'::public.lot_status end
      where id=lot.id;
    cash_basis := cash_basis+carrying;
    unallocated := unallocated-units;
  end loop;
  if unallocated<>0 then raise exception 'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS'; end if;

  asset_basis := (purchase.metadata->>'acquisition_cost_base')::numeric;
  evidence := jsonb_build_object('version',1,'withdrawal_id',withdrawal_id,'payment_amount',paid,
    'payment_currency',account.currency,'invoice_gross',invoice_total,'invoice_currency',purchase.currency,
    'base_currency',purchase.base_currency,'asset_basis_base',asset_basis,'cash_basis_base',cash_basis,
    'realized_fx_base',asset_basis-cash_basis,'asset_rate',purchase.metadata->'fx_rate',
    'asset_rate_date',purchase.metadata->'fx_rate_date','asset_rate_source',purchase.metadata->'fx_rate_source',
    'asset_rate_id',purchase.metadata->'fx_rate_id','asset_rate_from',purchase.currency,
    'asset_rate_to',purchase.base_currency,'source_rate_from',purchase.metadata->'fx_source_from',
    'source_rate_to',purchase.metadata->'fx_source_to');
  update public.transactions set base_value=cash_basis,
    metadata=metadata||jsonb_build_object('purchase_funding',evidence)
    where id=withdrawal_id;
  update public.transactions set metadata=metadata||jsonb_build_object('purchase_funding',evidence)
    where id=purchase.id;
  return withdrawal_id;
end;
$$;
revoke all on function private.fund_personal_asset_purchase(uuid) from public,anon;
grant execute on function private.fund_personal_asset_purchase(uuid) to authenticated;

-- Reverse the recorded allocation, including any eight-place residual, without a quote lookup.
create function private.reverse_personal_asset_purchase_funding(p_purchase_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  purchase public.transactions%rowtype;
  funding public.transactions%rowtype;
  allocation record;
  allocation_quantity numeric := 0;
  allocation_basis numeric := 0;
  reversal_id uuid;
  restored_rows integer;
begin
  select * into strict purchase from public.transactions
    where id=p_purchase_id and user_id=actor and transaction_type='PURCHASE'
      and organization_id is null and metadata->'purchase_funding'->>'version'='1' for update;
  -- The purchase function and reversal both serialize on the cash account before its lots.
  select * into strict funding from public.transactions
    where id=(purchase.metadata->'purchase_funding'->>'withdrawal_id')::uuid
      and user_id=actor and organization_id is null and transaction_type='WITHDRAWAL'
      and metadata->>'source'='ASSET_PURCHASE'
      and metadata->>'purchase_transaction_id'=purchase.id::text
      and metadata->'purchase_funding'=purchase.metadata->'purchase_funding';
  perform 1 from public.asset_accounts where id=funding.asset_account_id and user_id=actor
    and organization_id is null and ownership_scope='PERSONAL' for update;
  if not found then raise exception 'PERSONAL_PURCHASE_FUNDING_ACCOUNT_INVALID'; end if;
  if exists(select 1 from public.transactions where reversal_of_transaction_id=funding.id) then
    raise exception 'PERSONAL_PURCHASE_FUNDING_ALREADY_REVERSED';
  end if;
  for allocation in select a.* from public.transaction_allocations a
    join public.lots l on l.id=a.lot_id
    where a.transaction_id=funding.id and a.user_id=actor and l.asset_account_id=funding.asset_account_id
      and l.user_id=actor
    order by l.acquisition_date,l.created_at,l.id for update of l
  loop
    update public.lots set remaining_quantity=remaining_quantity+allocation.quantity,
      remaining_value_base=remaining_value_base+allocation.value_base,
      status=case when remaining_quantity+allocation.quantity=original_quantity then 'ACTIVE'::public.lot_status
        else 'PARTIALLY_USED'::public.lot_status end
      where id=allocation.lot_id and remaining_quantity+allocation.quantity<=original_quantity
        and remaining_value_base+allocation.value_base<=original_value_base;
    get diagnostics restored_rows=row_count;
    if restored_rows<>1 then raise exception 'PERSONAL_PURCHASE_FUNDING_ALLOCATION_INVALID'; end if;
    allocation_quantity := allocation_quantity+allocation.quantity;
    allocation_basis := allocation_basis+allocation.value_base;
  end loop;
  if allocation_quantity<>funding.quantity or allocation_basis<>funding.base_value then
    raise exception 'PERSONAL_PURCHASE_FUNDING_ALLOCATION_INVALID';
  end if;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,
    quantity,currency,gross_value,base_currency,base_value,reference,reversal_of_transaction_id,metadata,created_by)
  values(actor,funding.asset_account_id,'REVERSAL',current_date,funding.quantity,funding.currency,
    funding.gross_value,funding.base_currency,funding.base_value,funding.reference,funding.id,
    jsonb_build_object('reverses_transaction_id',funding.id,'purchase_transaction_id',purchase.id,
      'purchase_funding',funding.metadata->'purchase_funding'),actor)
  returning id into reversal_id;
  return reversal_id;
end;
$$;
revoke all on function private.reverse_personal_asset_purchase_funding(uuid) from public,anon;
grant execute on function private.reverse_personal_asset_purchase_funding(uuid) to authenticated;

-- Keep the existing organization acquisition and all unrelated reversal branches intact.
do $migration$
declare
  target record;
  definition text;
  funding_start integer;
  funding_end integer;
begin
  for target in select * from (values
    ('public.create_asset_with_acquisition(jsonb,uuid)'::regprocedure,'9c23fabd8c57f90054fdbfd1e5926b4a'),
    ('public.purchase_existing_asset(uuid,jsonb,uuid)'::regprocedure,'2c165d576d366bdedacdd26a591d9cae')
  ) as contracts(signature,fingerprint)
  loop
    definition := pg_get_functiondef(target.signature);
    if md5(definition)<>target.fingerprint then raise exception 'PERSONAL_PURCHASE_SOURCE_CHANGED: %',target.signature; end if;
    funding_start := strpos(definition,$anchor$ if mode='PURCHASE' and scope='PERSONAL' then$anchor$);
    funding_end := strpos(definition,$anchor$ elsif mode='PURCHASE' then$anchor$);
    if funding_start=0 or funding_end<=funding_start then raise exception 'PERSONAL_PURCHASE_SOURCE_CHANGED'; end if;
    definition := overlay(definition placing $body$ if mode='PURCHASE' and scope='PERSONAL' then
  wid:=private.fund_personal_asset_purchase(tid);
$body$ from funding_start for funding_end-funding_start);
    definition := replace(definition,'fund public.asset_accounts%rowtype;','');
    definition := replace(definition,'remaining numeric;take numeric;tq numeric;totalq numeric:=0;l record;',
      'base_scale integer;asset_scale integer;asset_basis numeric;net_base numeric;');
    definition := replace(definition,$old$ cost:=net+vat*(case when scope='PERSONAL' then 1 else 1-recover/100 end);$old$,$body$ if mode='PURCHASE' and scope='PERSONAL' then
  select decimals into asset_scale from public.currencies where code=p_asset->>'currency';
  select decimals into base_scale from public.currencies where code=base;
  if asset_scale is null or base_scale is null or asset_scale not between 0 and 8 or base_scale not between 0 and 8
     or net in ('NaN','Infinity','-Infinity') or vat in ('NaN','Infinity','-Infinity')
     or fx in ('NaN','Infinity','-Infinity') then
    raise exception 'PERSONAL_PURCHASE_PRECISION_INVALID';
  end if;
  net:=round(net,asset_scale);
  vat:=round(vat,asset_scale);
  if net<=0 or coalesce((m->>'fx_rate_date')::date,dt)>dt then raise exception 'ASSET_ACQUISITION_INVALID'; end if;
  m:=m||jsonb_build_object('vat_amount',vat,'purchase_value',net,
    'fx_rate_date',coalesce((m->>'fx_rate_date')::date,dt),
    'fx_rate_source',case when p_asset->>'currency'=base then 'BASE_CURRENCY'
      else coalesce(nullif(m->>'fx_rate_source',''),'MANUAL') end);
 end if;
 cost:=net+vat*(case when scope='PERSONAL' then 1 else 1-recover/100 end);
 asset_basis:=cost*fx;
 net_base:=net*fx;
 if mode='PURCHASE' and scope='PERSONAL' then
  asset_basis:=round(asset_basis,base_scale);
  net_base:=round(net_base,base_scale);
 end if;$body$);
    definition := replace(definition,$old$'acquisition_cost_base',cost*fx$old$,$new$'acquisition_cost_base',asset_basis$new$);
    definition := replace(definition,'a.currency,net,base,net*fx,','a.currency,net,base,net_base,');
    definition := replace(definition,'dt,qty,qty,cost*fx,cost*fx,','dt,qty,qty,asset_basis,asset_basis,');
    definition := replace(definition,$old$'cost_base',cost*fx$old$,$new$'cost_base',asset_basis$new$);
    execute definition;
  end loop;

  definition := pg_get_functiondef('public.reverse_transaction(uuid,uuid)'::regprocedure);
  if md5(definition)<>'c55781745bc46b0387661ddfe003d911' then
    raise exception 'PERSONAL_PURCHASE_REVERSAL_SOURCE_CHANGED';
  end if;
  definition := replace(definition,'v_source_lot public.lots%rowtype;',
    'v_source_lot public.lots%rowtype; v_funding_reversal uuid; v_funded_purchase boolean;');
  definition := replace(definition,$old$  if exists(select 1 from public.transactions where user_id=p_user_id and reversal_of_transaction_id=p_transaction_id) then raise exception 'ALREADY_REVERSED'; end if;$old$,$body$  v_funded_purchase:=v_orig.organization_id is null and v_orig.transaction_type='PURCHASE'
    and coalesce(v_orig.metadata->'purchase_funding'->>'version'='1',false);
  if v_orig.transaction_type='WITHDRAWAL' and v_orig.metadata->'purchase_funding'->>'version'='1' then
    raise exception 'REVERSE_FROM_PERSONAL_PURCHASE';
  end if;
  select id into v_rev from public.transactions where user_id=p_user_id and reversal_of_transaction_id=p_transaction_id;
  if found then
    if v_funded_purchase then return v_rev; end if;
    raise exception 'ALREADY_REVERSED';
  end if;$body$);
  definition := replace(definition,$old$    if found then
      if v_source_lot.remaining_quantity<>v_source_lot.original_quantity then raise exception 'SOURCE_LOT_ALREADY_CONSUMED'; end if;$old$,$body$    if not found and v_funded_purchase then raise exception 'SOURCE_LOT_REQUIRED'; end if;
    if found then
      if v_source_lot.remaining_quantity<>v_source_lot.original_quantity then raise exception 'SOURCE_LOT_ALREADY_CONSUMED'; end if;$body$);
  definition := replace(definition,$old$  insert into public.transactions(user_id,$old$,$body$  if v_funded_purchase then
    v_funding_reversal := private.reverse_personal_asset_purchase_funding(v_orig.id);
  end if;
  insert into public.transactions(user_id,$body$);
  definition := replace(definition,$old$jsonb_build_object('reverses_transaction_id',v_orig.id),p_user_id$old$,$body$jsonb_build_object('reverses_transaction_id',v_orig.id) ||
    case when v_funded_purchase then jsonb_build_object('funding_reversal_id',v_funding_reversal)
         else '{}'::jsonb end,p_user_id$body$);
  definition := replace(definition,$old$  return v_rev;
end;$old$,$body$  if v_funded_purchase then
    insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)
    values(p_user_id,'transaction',v_rev,'PERSONAL_PURCHASE_FUNDING_REVERSED',
      jsonb_build_object('purchase_id',v_orig.id,'funding_reversal_id',v_funding_reversal));
  end if;
  return v_rev;
end;$body$);
  execute definition;
end;
$migration$;
