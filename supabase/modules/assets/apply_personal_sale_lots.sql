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
