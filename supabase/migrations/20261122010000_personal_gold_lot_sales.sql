-- Ordered release DDL. Privileged entry points start closed.
-- Internal posting primitive. The caller supplies locked, policy-eligible rows
-- read by the server in acquisition_date, created_at, id order.
create or replace function public.plan_asset_sale_lots(
  p_candidates jsonb, p_quantity numeric, p_method text default 'FIFO',
  p_selection jsonb default '[]'::jsonb
) returns table (
  lot_id uuid, allocated_quantity numeric, cost_base numeric,
  quantity_after numeric, cost_after numeric
) language plpgsql immutable security invoker set search_path = '' as $$
declare
  candidate record;
  requested numeric;
  used_count integer := 0;
  needed numeric := p_quantity;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity,8)
     or p_quantity::text in ('NaN','Infinity','-Infinity')
     or p_method is null or p_method not in ('FIFO','MANUAL')
     or jsonb_typeof(p_candidates) is distinct from 'array'
     or jsonb_typeof(p_selection) is distinct from 'array' then
    raise exception 'INVALID_SALE_SELECTION';
  end if;
  if (p_method = 'FIFO' and jsonb_array_length(p_selection) <> 0)
     or (p_method = 'MANUAL' and jsonb_array_length(p_selection) = 0) then
    raise exception 'INVALID_SALE_SELECTION';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_selection) s(id uuid, quantity numeric)
    group by s.id having count(*) <> 1 or s.id is null)
    or exists (select 1 from jsonb_to_recordset(p_candidates) c(id uuid)
    group by c.id having count(*) <> 1 or c.id is null) then
    raise exception 'INVALID_LOT_ID';
  end if;
  for candidate in
    select c.*, s.quantity as selected_quantity, s.id is not null as selected
    from jsonb_array_elements(p_candidates) with ordinality e(item, position)
    cross join lateral jsonb_to_record(e.item) c(id uuid, remaining_quantity numeric, remaining_value_base numeric)
    left join jsonb_to_recordset(p_selection) s(id uuid,quantity numeric) on s.id=c.id
    order by e.position
  loop
    if p_method = 'MANUAL' and not candidate.selected then continue; end if;
    if p_method = 'FIFO' and needed = 0 then exit; end if;
    requested := case when p_method = 'FIFO' then least(needed,candidate.remaining_quantity)
                      else candidate.selected_quantity end;
    if requested is null or requested <= 0 or requested <> round(requested,8)
       or requested::text in ('NaN','Infinity','-Infinity')
       or candidate.remaining_quantity is null or requested > candidate.remaining_quantity
       or requested > needed or candidate.remaining_value_base is null or candidate.remaining_value_base < 0 then
      raise exception 'INVALID_LOT_QUANTITY';
    end if;
    lot_id := candidate.id;
    allocated_quantity := requested;
    quantity_after := candidate.remaining_quantity-requested;
    cost_base := case when quantity_after=0 then candidate.remaining_value_base
      else round(candidate.remaining_value_base*requested/candidate.remaining_quantity,8) end;
    cost_after := candidate.remaining_value_base-cost_base;
    needed := needed-requested;
    used_count := used_count+1;
    return next;
  end loop;
  if needed <> 0 or (p_method='MANUAL' and used_count <> jsonb_array_length(p_selection)) then
    raise exception 'SALE_LOTS_UNAVAILABLE';
  end if;
end $$;
revoke all on function public.plan_asset_sale_lots(jsonb,numeric,text,jsonb) from public, anon, authenticated;

-- Called only within the posting transaction after policy and dependency checks.
-- The posting service supplies the complete authorized homogeneous account set.
create function public.apply_personal_sale_lots(
  p_sale_id uuid, p_accounts uuid[], p_method text, p_selection jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  sale public.transactions%rowtype;
  candidates jsonb;
  details jsonb := '[]';
  total numeric := 0;
  allocation record;
  source_id uuid;
begin
  select * into strict sale from public.transactions
    where id=p_sale_id and user_id=auth.uid() and organization_id is null
      and transaction_type='SALE' and reversal_of_transaction_id is null for update;
  if array_length(p_accounts,1) is null or not (sale.asset_account_id=any(p_accounts))
     or array_position(p_accounts,null) is not null
     or exists(select 1 from unnest(p_accounts) a(id) left join public.asset_accounts account
       on account.id=a.id and account.user_id=sale.user_id and account.ownership_scope='PERSONAL'
       and account.organization_id is null and account.currency=sale.currency and account.status='ACTIVE'
       where account.id is null) then raise exception 'SALE_ACCOUNTS_UNAVAILABLE'; end if;
  if exists(select 1 from public.transaction_allocations where transaction_id=sale.id)
    or sale.metadata ? 'lot_selection' then raise exception 'SALE_ALREADY_ALLOCATED'; end if;

  perform 1 from public.lots where user_id=sale.user_id and asset_account_id=any(p_accounts)
    and acquisition_date<=sale.transaction_date and remaining_quantity>0 order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'remaining_quantity',remaining_quantity,
    'remaining_value_base',remaining_value_base) order by acquisition_date,created_at,id),'[]') into candidates
    from public.lots where user_id=sale.user_id and asset_account_id=any(p_accounts)
    and acquisition_date<=sale.transaction_date and remaining_quantity>0 and status<>'CLOSED';
  for allocation in select * from public.plan_asset_sale_lots(candidates,sale.quantity,p_method,p_selection)
  loop
    insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
      values(sale.user_id,sale.id,allocation.lot_id,allocation.allocated_quantity,allocation.cost_base,p_method::public.allocation_method);
    update public.lots set remaining_quantity=allocation.quantity_after, remaining_value_base=allocation.cost_after,
      status=case when allocation.quantity_after=0 then 'CLOSED'::public.lot_status
        else 'PARTIALLY_USED'::public.lot_status end
      where id=allocation.lot_id returning asset_account_id into strict source_id;
    details := details || jsonb_build_array(to_jsonb(allocation)||jsonb_build_object('asset_account_id',source_id));
    total := total+allocation.cost_base;
  end loop;
  details := jsonb_build_object('method',p_method,'allocations',details,'cost_base',total,
    'realized_gain_base',sale.base_value-total);
  update public.transactions set metadata=metadata||jsonb_build_object('lot_selection',details) where id=sale.id;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)
    values(sale.user_id,'transaction',sale.id,'ALLOCATE_SALE_LOTS',details);
  return details;
end $$;
revoke all on function public.apply_personal_sale_lots(uuid,uuid[],text,jsonb) from public, anon, authenticated;

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

-- Read one asset's share of grouped sales. Snapshot fields are written by the
-- posting transaction; later changes to the lots cannot alter the receipt.
create function public.personal_asset_grouped_sales(p_asset_id uuid,p_until date,p_limit integer default 50)
returns table(sale_id uuid,sale_date date,receipt_id uuid,method text,quantity numeric,
  unit_price numeric,currency text,proceeds numeric,cost_base numeric,gain_base numeric,allocations jsonb)
language sql stable security invoker set search_path='' as $$
  select sale.id,sale.transaction_date,receipt.id,sale.metadata#>>'{lot_selection,method}',
    sum(a.quantity),sale.unit_price,sale.currency,sum(a.quantity)*sale.unit_price,
    sum(a.value_base),sum(a.quantity)*sale.unit_price-sum(a.value_base),
    jsonb_agg(jsonb_build_object('lot_id',lot.id,'quantity',a.quantity,'cost_base',a.value_base,
      'quantity_after',snap.item->'quantity_after','cost_after',snap.item->'cost_after')
      order by lot.acquisition_date,lot.created_at,lot.id)
  from public.asset_accounts asset
  join public.lots lot on lot.asset_account_id=asset.id and lot.user_id=asset.user_id
  join public.transaction_allocations a on a.lot_id=lot.id and a.user_id=asset.user_id
  join public.transactions sale on sale.id=a.transaction_id and sale.user_id=asset.user_id
  join public.transactions receipt on receipt.id::text=sale.metadata#>>'{lot_sale_result,proceeds_transaction_id}'
    and receipt.user_id=sale.user_id and receipt.transfer_id=sale.transfer_id
    and receipt.metadata->>'sale_transaction_id'=sale.id::text
  join lateral jsonb_array_elements(sale.metadata#>'{lot_selection,allocations}') snap(item)
    on snap.item->>'lot_id'=lot.id::text
  where asset.id=p_asset_id and asset.user_id=auth.uid() and asset.ownership_scope='PERSONAL'
    and asset.organization_id is null and sale.organization_id is null and sale.transaction_type='SALE'
    and sale.currency=sale.base_currency and sale.metadata ? 'lot_sale_request'
    and sale.transaction_date<=p_until
  group by sale.id,receipt.id order by sale.transaction_date desc,sale.created_at desc,sale.id desc
  limit greatest(0,least(coalesce(p_limit,50),200))
$$;
revoke all on function public.personal_asset_grouped_sales(uuid,date,integer) from public,anon;
grant execute on function public.personal_asset_grouped_sales(uuid,date,integer) to authenticated;

create table private.grouped_sale_reversals(
  sale_id uuid primary key references public.transactions(id), receipt_id uuid not null unique references public.transactions(id),
  owner_id uuid not null, request_id uuid not null, reason text not null, opening_transaction bigint not null,
  result jsonb, unique(owner_id,request_id)
);
alter table private.grouped_sale_reversals enable row level security;
revoke all on private.grouped_sale_reversals from public,anon,authenticated;
-- Candidate only. Guard legacy paths when a voucher uses multiple asset accounts.
create function public.guard_grouped_sale_changes() returns trigger language plpgsql security definer set search_path='' as $$
declare blocker uuid;
begin
  if tg_op='INSERT' then
    if new.reversal_of_transaction_id is not null and exists(
      select 1 from public.transactions reversed
      join public.transactions sale on sale.user_id=reversed.user_id and sale.metadata ? 'lot_sale_request'
        and (reversed.id=sale.id or reversed.metadata->>'sale_transaction_id'=sale.id::text)
      where reversed.id=new.reversal_of_transaction_id
    ) and not exists(select 1 from private.grouped_sale_reversals permitted where permitted.owner_id=new.user_id
      and permitted.opening_transaction=txid_current() and permitted.result is null
      and new.reversal_of_transaction_id in(permitted.sale_id,permitted.receipt_id))
    then raise exception 'GROUPED_SALE_REVERSAL_UNAVAILABLE'; end if;
  elsif old.metadata ? 'lot_sale_request' and new.base_value is distinct from old.base_value then
    if not has_function_privilege('authenticated','public.gold_card_sale(uuid,date,jsonb)','execute') then
      raise exception 'GROUPED_SALE_WRITES_DISABLED'; end if;
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
revoke all on function public.guard_grouped_sale_changes() from public,anon,authenticated;
create trigger grouped_sale_reversal_guard before insert on public.transactions
for each row when (new.reversal_of_transaction_id is not null) execute function public.guard_grouped_sale_changes();
create trigger grouped_sale_amount_guard before update of base_value on public.transactions
for each row when (old.metadata ? 'lot_sale_request' and old.base_value is distinct from new.base_value)
execute function public.guard_grouped_sale_changes();

create function public.reverse_grouped_gold_sale(p_sale uuid,p_request uuid,p_revision integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid();
  sale public.transactions%rowtype;
  receipt uuid;
  preflight jsonb;
  blocker uuid;
  prior private.grouped_sale_reversals%rowtype;
  sale_reversal uuid;
  cash_reversal uuid;
  result_data jsonb;
begin
  if uid is null or p_sale is null or p_request is null or p_revision is null or p_revision<0
    or length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'INVALID_REVERSAL'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
  select * into strict sale from public.transactions where id=p_sale and user_id=uid and organization_id is null
    and transaction_type='SALE' and metadata ? 'lot_sale_request' for update;
  if coalesce((sale.metadata#>>'{sale_price_amendment,revision}')::int,0)<>p_revision then raise exception 'SALE_CORRECTION_STALE'; end if;
  select * into prior from private.grouped_sale_reversals where sale_id=p_sale;
  if found then
    if prior.request_id=p_request and prior.reason=trim(p_reason) then return prior.result; end if;
    raise exception 'ALREADY_REVERSED';
  end if;
  receipt:=(sale.metadata#>>'{lot_sale_result,proceeds_transaction_id}')::uuid;
  perform id from public.transactions where id=receipt and user_id=uid for update;
  perform l.id from public.lots l where l.user_id=uid and (l.source_transaction_id=receipt or exists(
    select 1 from public.transaction_allocations a where a.transaction_id=p_sale and a.lot_id=l.id)) order by l.id for update;
  preflight:=public.personal_sale_preflight(p_sale);
  if preflight->>'amount_block' is not null then raise exception '%',preflight->>'amount_block' using detail=(preflight->'movements')::text; end if;
  select later.id into blocker from public.transaction_allocations original
    join public.transaction_allocations next on next.lot_id=original.lot_id
    join public.transactions later on later.id=next.transaction_id
    where original.transaction_id=p_sale and later.user_id=uid
      and (later.transaction_date,later.created_at,later.id)>(sale.transaction_date,sale.created_at,sale.id)
      and not exists(select 1 from public.transactions r where r.reversal_of_transaction_id=later.id)
    order by later.transaction_date,later.created_at,later.id limit 1;
  if found then raise exception 'SALE_CORRECTION_LATER_MOVEMENTS' using detail=blocker::text; end if;
  select assessment.id into blocker from public.transaction_allocations a join public.lots l on l.id=a.lot_id
    join public.zakat_assessment_lines line on line.lot_id=l.id
    join public.zakat_assessments assessment on assessment.id=line.assessment_id and assessment.user_id=uid
    where a.transaction_id=p_sale and assessment.assessment_kind='FINAL' and assessment.status<>'CANCELLED'
      and assessment.assessment_date>=sale.transaction_date limit 1;
  if found then raise exception 'SALE_CORRECTION_FINAL_ASSESSMENT' using detail=blocker::text; end if;
  insert into private.grouped_sale_reversals(sale_id,receipt_id,owner_id,request_id,reason,opening_transaction)
    values(p_sale,receipt,uid,p_request,trim(p_reason),txid_current());
  cash_reversal:=public.reverse_transaction(uid,receipt);
  sale_reversal:=public.reverse_transaction(uid,p_sale);
  result_data:=jsonb_build_object('sale_reversal_id',sale_reversal,'receipt_reversal_id',cash_reversal);
  update public.transactions set metadata=metadata||jsonb_build_object('lifecycle_reversed',true) where id=p_sale;
  update private.grouped_sale_reversals set result=result_data where sale_id=p_sale;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'transaction',p_sale,
    'REVERSE_GROUPED_GOLD_SALE',result_data||jsonb_build_object('reason',trim(p_reason),'request',p_request));
  return result_data;
end $$;
revoke all on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) from public,anon;
revoke execute on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) from authenticated;

-- Candidate for isolated QA. One authorized entry point for group selection and posting.
create function public.gold_card_sale(p_asset uuid,p_date date,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid();
  asset public.asset_accounts%rowtype;
  candidates jsonb;
  banks jsonb;
  planned jsonb;
  posted jsonb;
  history jsonb;
  price numeric;
  qty numeric;
  method text;
  key uuid;
begin
  select a.* into strict asset from public.asset_accounts a join public.profiles p on p.id=a.user_id
    where a.id=p_asset and a.user_id=uid and a.ownership_scope='PERSONAL' and a.organization_id is null
    and a.asset_type='GOLD' and a.unit='g' and a.currency=p.base_currency and a.status='ACTIVE'
    and a.metadata->>'karat' in ('9','10','12','14','18','20','21','22','23','24');
  if p_date is null or p_date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'INVALID_SALE_DATE'; end if;
  if p_payload ? 'expected' then
    key:=(p_payload->>'request')::uuid;
    posted:=public.post_personal_gold_lot_sale(key,(asset.metadata->>'karat')::int,
      (p_payload->>'bank')::uuid,p_date,(p_payload->>'quantity')::numeric,(p_payload->>'price')::numeric,
      p_payload->>'method',p_payload->'selection');
    -- On mismatch raising here unwinds the entire sale, linked receipt, lots and audit.
    if posted->'allocations' is distinct from p_payload->'expected' then raise exception 'SALE_PREVIEW_CHANGED'; end if;
    if not exists(select 1 from public.transactions where id=(posted->>'sale_transaction_id')::uuid and metadata ? 'lot_source_vouchers') then
      select jsonb_object_agg(l.id::text,jsonb_build_object('asset',a.name,'date',l.acquisition_date,
        'source',coalesce(v.document_number,t.reference,t.id::text))) into history
      from public.transaction_allocations allocation join public.lots l on l.id=allocation.lot_id
      join public.asset_accounts a on a.id=l.asset_account_id join public.transactions t on t.id=l.source_transaction_id
      left join public.voucher_numbers v on v.source_table='transactions' and v.source_id=t.id
      where allocation.transaction_id=(posted->>'sale_transaction_id')::uuid;
      update public.transactions set metadata=metadata||jsonb_build_object('lot_source_vouchers',history)
        where id=(posted->>'sale_transaction_id')::uuid and user_id=uid;
    end if;
    return posted;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'asset',a.name,'date',l.acquisition_date,
    'source',coalesce(v.document_number,t.reference,t.id::text),'remaining_quantity',l.remaining_quantity,
    'remaining_value_base',l.remaining_value_base,'asset_account_id',a.id) order by l.acquisition_date,l.created_at,l.id),'[]')
    into candidates from public.asset_accounts a join public.lots l on l.asset_account_id=a.id and l.user_id=uid
    join public.transactions t on t.id=l.source_transaction_id and t.user_id=uid
    left join public.voucher_numbers v on v.source_table='transactions' and v.source_id=t.id
    where a.user_id=uid and a.ownership_scope='PERSONAL' and a.organization_id is null and a.status='ACTIVE'
    and a.asset_type='GOLD' and a.currency=asset.currency and a.unit='g'
    and a.metadata->>'karat'=asset.metadata->>'karat' and l.acquisition_date<=p_date and l.remaining_quantity>0 and l.status<>'CLOSED';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into banks
    from public.asset_accounts where user_id=uid and ownership_scope='PERSONAL' and organization_id is null
      and currency=asset.currency and status='ACTIVE' and asset_type in ('BANK','CASH');
  if p_payload is null then return jsonb_build_object('lots',candidates,'banks',banks,'currency',asset.currency,'karat',asset.metadata->>'karat'); end if;
  qty:=(p_payload->>'quantity')::numeric; price:=(p_payload->>'price')::numeric; method:=p_payload->>'method';
  if price is null or not(price>0 and price<1e16) then raise exception 'INVALID_SALE'; end if;
  select jsonb_agg(to_jsonb(plan)||jsonb_build_object('asset_account_id',source.item->'asset_account_id') order by source.position)
    into planned from public.plan_asset_sale_lots(candidates,qty,method,p_payload->'selection') plan
    join jsonb_array_elements(candidates) with ordinality source(item,position) on source.item->>'id'=plan.lot_id::text;
  return jsonb_build_object('allocations',planned,'gross',round(qty*price,8),
    'cost',(select sum((a->>'cost_base')::numeric) from jsonb_array_elements(planned) a));
end $$;
revoke all on function public.gold_card_sale(uuid,date,jsonb) from public,anon;
revoke execute on function public.gold_card_sale(uuid,date,jsonb) from authenticated;

-- Extend the registration lock to every asset consumed by a grouped sale.
create or replace function public.asset_edit_availability(p_asset_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  asset public.asset_accounts;
  actor uuid := auth.uid();
  initial_id uuid;
  movement public.transactions;
  assessment_id uuid;
  assessment_date date;
  linked_operation record;
  registered_scope boolean;
  can_write boolean;
  valuation_mode text;
  reason jsonb;
  book jsonb;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into asset from public.asset_accounts where id = p_asset_id;
  if not found or (asset.ownership_scope = 'PERSONAL' and asset.user_id is distinct from actor)
     or (asset.ownership_scope = 'ORGANIZATION'
       and public.has_organization_permission(asset.organization_id, 'assets.view') is not true) then
    raise exception 'ASSET_NOT_FOUND';
  end if;

  registered_scope := asset.status = 'ACTIVE' and asset.metadata->>'archived' is distinct from 'true'
    and not (asset.metadata ?| array['investment_id','register_source','financing_contract_id','personal_contract_id'])
    and asset.metadata->>'acquisition_mode' is distinct from 'INVESTMENT';
  can_write := registered_scope and (asset.ownership_scope = 'PERSONAL'
    or public.has_organization_permission(asset.organization_id, 'assets.edit') is true);

  if can_write and (asset.asset_type in ('GOLD','SILVER','STOCK','REAL_ESTATE','INVENTORY')
     or (asset.asset_type = 'OTHER' and asset.asset_class_code in ('PPE','INTANGIBLE'))) then
    -- The saved quote's source and derived-value flag do not authorize refresh.
    valuation_mode := 'MANUAL';
  end if;

  if can_write then
    -- Only the first opening or purchase can be the registration transaction.
    -- A backdated subsequent movement still locks registration.
    select id into initial_id from public.transactions
      where asset_account_id = asset.id and transaction_type in ('OPENING_BALANCE','PURCHASE')
      order by (metadata->>'source' = 'ATOMIC_ASSET_ACQUISITION') desc nulls last, created_at, id
      limit 1;
    select * into movement from public.transactions
      where asset_account_id = asset.id and id is distinct from initial_id
      order by created_at, id limit 1;
    if not found and asset.ownership_scope='PERSONAL' then
      -- Grouped sales have one header but every allocated source asset is registered as sold.
      select t.* into movement from public.lots l
      join public.transaction_allocations a on a.lot_id=l.id and a.user_id=actor
      join public.transactions t on t.id=a.transaction_id and t.user_id=actor
      where l.asset_account_id=asset.id and l.user_id=actor and t.metadata ? 'lot_sale_request'
      order by t.created_at,t.id limit 1;
    end if;
    if movement.id is not null then
      reason := jsonb_build_object('code','MOVEMENT','id',movement.id,'date',movement.transaction_date,
        'reference',coalesce(movement.metadata->>'document_sequence',movement.reference),
        'operation',coalesce(movement.metadata->>'operation',movement.transaction_type::text));
    else
      select c.financial_event_id, c.operation, c.operation_date into linked_operation
      from public.asset_lifecycle_commands c
      where c.asset_account_id = asset.id and c.financial_event_id is not null
      order by c.created_at, c.id limit 1;
      if found then
        reason := jsonb_build_object('code','LIFECYCLE','id',linked_operation.financial_event_id,
          'operation',linked_operation.operation,'date',linked_operation.operation_date);
      end if;
    end if;

    if reason is null and asset.ownership_scope = 'PERSONAL' then
      select a.id, a.assessment_date into assessment_id, assessment_date
      from public.zakat_assessment_lines line
      join public.zakat_assessments a on a.id = line.assessment_id and a.status <> 'CANCELLED'
      left join public.lots lot on lot.id = line.lot_id
      where a.user_id = actor and (lot.asset_account_id = asset.id or line.valuation_snapshot->>'assetId' = asset.id::text)
      order by a.created_at, a.id limit 1;
    elsif reason is null and asset.ownership_scope = 'ORGANIZATION' then
      select s.id, s.assessment_date into assessment_id, assessment_date
      from public.corporate_zakat_sources s
      where s.organization_id = asset.organization_id and s.entries @> jsonb_build_array(
        jsonb_build_object('id',asset.id,'source','ASSET_BOOK_OR_SAVED_VALUE'))
      order by s.created_at, s.id limit 1;
    end if;
    if reason is null and assessment_id is not null then
      reason := jsonb_build_object('code','ZAKAT','date',assessment_date);
    end if;
  else
    reason := jsonb_build_object('code','ACCESS');
  end if;

  if asset.ownership_scope = 'ORGANIZATION' and asset.asset_class_code in ('PPE','INTANGIBLE') then
    book := private.financial_opening_asset_book(asset.organization_id,asset.id,
      (statement_timestamp() at time zone 'Asia/Riyadh')::date);
    if book->>'known' = 'true' and book->>'issue' is null then
      book := book || jsonb_build_object('net', (book->>'gross')::numeric - (book->>'depreciation')::numeric);
    else
      book := null;
    end if;
  end if;

  return jsonb_build_object('asset_registration_can_edit', can_write and reason is null,
    'asset_market_valuation_can_update', valuation_mode is not null,
    'valuation_mode', valuation_mode, 'registration_lock', reason, 'book', book);
end;
$$;
