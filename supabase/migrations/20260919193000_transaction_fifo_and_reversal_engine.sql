-- Transaction engine: FIFO outflows and auditable reversals.
-- Applied to production on 2026-09-19. Kept in source control for reproducible environments.

create or replace function public.post_withdrawal(
  p_user_id uuid, p_asset_account_id uuid, p_date date, p_quantity numeric,
  p_value numeric, p_currency text, p_base_currency text, p_base_value numeric,
  p_notes text default null,
  p_allocation_method public.allocation_method default 'FIFO',
  p_transaction_type public.transaction_type default 'WITHDRAWAL'
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_tx uuid; v_needed numeric := p_quantity; v_take numeric;
  v_lot record; v_alloc_value numeric;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then raise exception 'UNAUTHORIZED'; end if;
  if p_quantity <= 0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  if p_transaction_type not in ('WITHDRAWAL','SALE','TRANSFER_OUT','ZAKAT_PAYMENT') then raise exception 'INVALID_OUTFLOW_TYPE'; end if;
  if not exists(select 1 from public.asset_accounts a where a.id=p_asset_account_id and a.user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
  if coalesce((select sum(l.remaining_quantity) from public.lots l where l.user_id=p_user_id and l.asset_account_id=p_asset_account_id and l.remaining_quantity>0),0) < p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
  if p_allocation_method <> 'FIFO' then raise exception 'ONLY_FIFO_IS_CURRENTLY_SUPPORTED'; end if;

  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,created_by)
  values(p_user_id,p_asset_account_id,p_transaction_type,p_date,p_quantity,upper(p_currency),p_value,upper(p_base_currency),p_base_value,p_notes,p_user_id)
  returning id into v_tx;

  for v_lot in
    select l.id,l.remaining_quantity,l.remaining_value_base
    from public.lots l
    where l.user_id=p_user_id and l.asset_account_id=p_asset_account_id and l.remaining_quantity>0
    order by l.acquisition_date,l.created_at,l.id for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed,v_lot.remaining_quantity);
    v_alloc_value := case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;
    insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
    values(p_user_id,v_tx,v_lot.id,v_take,v_alloc_value,p_allocation_method);
    update public.lots set
      remaining_quantity=remaining_quantity-v_take,
      remaining_value_base=greatest(0,remaining_value_base-v_alloc_value),
      status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end
    where id=v_lot.id;
    v_needed := v_needed-v_take;
  end loop;
  return v_tx;
end;
$$;

create or replace function public.reverse_transaction(p_user_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_orig public.transactions%rowtype; v_rev uuid; v_alloc record; v_source_lot public.lots%rowtype;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then raise exception 'UNAUTHORIZED'; end if;
  select * into v_orig from public.transactions where id=p_transaction_id and user_id=p_user_id for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if v_orig.transaction_type='REVERSAL' then raise exception 'CANNOT_REVERSE_REVERSAL'; end if;
  if exists(select 1 from public.transactions where user_id=p_user_id and reversal_of_transaction_id=p_transaction_id) then raise exception 'ALREADY_REVERSED'; end if;

  if v_orig.transaction_type in ('SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT') then
    for v_alloc in select * from public.transaction_allocations where user_id=p_user_id and transaction_id=p_transaction_id order by created_at,id loop
      update public.lots set
        remaining_quantity=remaining_quantity+v_alloc.quantity,
        remaining_value_base=remaining_value_base+v_alloc.value_base,
        status=case when remaining_quantity+v_alloc.quantity>=original_quantity then 'ACTIVE'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end
      where id=v_alloc.lot_id and user_id=p_user_id;
    end loop;
  elsif v_orig.transaction_type in ('OPENING_BALANCE','ADD','PURCHASE','TRANSFER_IN') then
    select * into v_source_lot from public.lots where user_id=p_user_id and source_transaction_id=p_transaction_id for update;
    if found then
      if v_source_lot.remaining_quantity<>v_source_lot.original_quantity then raise exception 'SOURCE_LOT_ALREADY_CONSUMED'; end if;
      update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED' where id=v_source_lot.id;
    end if;
  end if;

  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,reference,notes,reversal_of_transaction_id,metadata,created_by,organization_id,entity_id)
  values(p_user_id,v_orig.asset_account_id,'REVERSAL',current_date,v_orig.quantity,v_orig.unit_price,v_orig.currency,v_orig.gross_value,v_orig.base_currency,v_orig.base_value,v_orig.reference,coalesce(v_orig.notes,'')||case when v_orig.notes is null then '' else E'\n' end||'Reversal',v_orig.id,jsonb_build_object('reverses_transaction_id',v_orig.id),p_user_id,v_orig.organization_id,v_orig.entity_id)
  returning id into v_rev;
  return v_rev;
end;
$$;

revoke execute on function public.post_withdrawal(uuid,uuid,date,numeric,numeric,text,text,numeric,text,public.allocation_method,public.transaction_type) from public, anon;
grant execute on function public.post_withdrawal(uuid,uuid,date,numeric,numeric,text,text,numeric,text,public.allocation_method,public.transaction_type) to authenticated;
revoke execute on function public.reverse_transaction(uuid,uuid) from public, anon;
grant execute on function public.reverse_transaction(uuid,uuid) to authenticated;
