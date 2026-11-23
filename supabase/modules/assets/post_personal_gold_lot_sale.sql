-- Internal candidate, limited to base-currency personal gold sold by the gram.
create function public.post_personal_gold_lot_sale(p_request uuid,p_karat integer,p_bank uuid,
  p_date date,p_quantity numeric,p_unit_price numeric,p_method text default 'FIFO',
  p_selection jsonb default '[]') returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid := auth.uid();
  accounts uuid[];
  currency_code text;
  gross numeric(24,8);
  sale_id uuid;
  receipt_id uuid;
  link uuid := gen_random_uuid();
  input jsonb := jsonb_build_array(p_karat,p_bank,p_date,p_quantity,p_unit_price,p_method,p_selection);
  prior jsonb;
  result jsonb;
begin
  if uid is null or p_request is null or p_bank is null or p_date is null
    or p_date>(now() at time zone 'Asia/Riyadh')::date or p_karat not between 1 and 24 or p_karat is null
    or p_quantity is null or not(p_quantity>0 and p_quantity<1e16 and round(p_quantity,8)=p_quantity)
    or p_unit_price is null or not(p_unit_price>0 and p_unit_price<1e16 and round(p_unit_price,8)=p_unit_price)
  then raise exception 'INVALID_SALE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
  select metadata into prior from public.transactions where user_id=uid and transaction_type='SALE'
    and metadata->>'lot_sale_request'=p_request::text;
  if found then
    if prior->'lot_sale_input' is distinct from input then raise exception 'SALE_REQUEST_CONFLICT'; end if;
    return prior->'lot_sale_result';
  end if;
  select base_currency into strict currency_code from public.profiles where id=uid;
  perform 1 from public.asset_accounts where id=p_bank and user_id=uid and ownership_scope='PERSONAL'
    and organization_id is null and status='ACTIVE' and currency=currency_code and asset_type in ('BANK','CASH') for update;
  if not found then raise exception 'SALE_BANK_UNAVAILABLE'; end if;
  select array_agg(id order by id) into accounts from (
    select id from public.asset_accounts where user_id=uid and ownership_scope='PERSONAL' and organization_id is null
    and asset_type='GOLD' and status='ACTIVE' and currency=currency_code and unit='g'
    and metadata->>'karat'=p_karat::text order by id for update
  ) eligible;
  if accounts is null then raise exception 'SALE_ACCOUNTS_UNAVAILABLE'; end if;
  if exists(select 1 from public.zakat_assessment_lines line join public.lots lot on lot.id=line.lot_id
    join public.zakat_assessments assessment on assessment.id=line.assessment_id
    where assessment.user_id=uid and assessment.assessment_kind='FINAL' and assessment.status<>'CANCELLED'
      and assessment.assessment_date>=p_date and lot.asset_account_id=any(array_append(accounts,p_bank))) then
    raise exception 'SALE_FINAL_ASSESSMENT'; end if;
  if exists(select 1 from public.transaction_allocations a join public.lots l on l.id=a.lot_id
    join public.transactions t on t.id=a.transaction_id where l.asset_account_id=any(accounts)
      and t.transaction_date>p_date) then raise exception 'SALE_LATER_ALLOCATION'; end if;
  gross:=round(p_quantity*p_unit_price,8);
  if gross<=0 then raise exception 'INVALID_SALE'; end if;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,
    currency,gross_value,base_currency,base_value,transfer_id,created_by,metadata)
  values(uid,accounts[1],'SALE',p_date,p_quantity,p_unit_price,currency_code,gross,currency_code,gross,link,uid,
    jsonb_build_object('lot_sale_request',p_request,'lot_sale_input',input,'proceeds_account_id',p_bank)) returning id into sale_id;
  result:=public.apply_personal_sale_lots(sale_id,accounts,p_method,p_selection);
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,
    currency,gross_value,base_currency,base_value,transfer_id,created_by,metadata)
  values(uid,p_bank,'ADD',p_date,gross,1,currency_code,gross,currency_code,gross,link,uid,
    jsonb_build_object('source','sale_proceeds','sale_transaction_id',sale_id)) returning id into receipt_id;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,
    remaining_quantity,original_value_base,remaining_value_base,status,metadata)
  values(uid,p_bank,receipt_id,p_date,gross,gross,gross,gross,'ACTIVE',jsonb_build_object('source','sale_proceeds','sale_transaction_id',sale_id));
  result:=result||jsonb_build_object('sale_transaction_id',sale_id,'proceeds_transaction_id',receipt_id);
  update public.transactions set asset_account_id=(result#>>'{allocations,0,asset_account_id}')::uuid,
    metadata=metadata||jsonb_build_object('lot_sale_result',result) where id=sale_id;
  return result;
end $$;
revoke all on function public.post_personal_gold_lot_sale(uuid,integer,uuid,date,numeric,numeric,text,jsonb) from public,anon,authenticated;
