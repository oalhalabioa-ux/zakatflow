-- Atomic internal transfer engine.
create or replace function public.create_internal_transfer(
 p_user_id uuid,p_source_account uuid,p_destination_account uuid,p_date date,
 p_quantity numeric,p_value numeric,p_currency text,p_notes text default null
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_transfer uuid:=gen_random_uuid(); v_out uuid; v_in uuid; v_needed numeric:=p_quantity;
v_lot record; v_take numeric; v_cost numeric; v_total_cost numeric:=0;
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_source_account=p_destination_account then raise exception 'SOURCE_AND_DESTINATION_MUST_DIFFER'; end if;
 if p_quantity<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_source_account and user_id=p_user_id) or
    not exists(select 1 from public.asset_accounts where id=p_destination_account and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_source_account and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;

 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,transfer_id,created_by)
 values(p_user_id,p_source_account,'TRANSFER_OUT',p_date,p_quantity,upper(p_currency),p_value,upper(p_currency),p_value,p_notes,v_transfer,p_user_id)
 returning id into v_out;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,transfer_id,created_by)
 values(p_user_id,p_destination_account,'TRANSFER_IN',p_date,p_quantity,upper(p_currency),p_value,upper(p_currency),p_value,p_notes,v_transfer,p_user_id)
 returning id into v_in;

 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_source_account and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
   exit when v_needed<=0; v_take:=least(v_needed,v_lot.remaining_quantity);
   v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;
   insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
   values(p_user_id,v_out,v_lot.id,v_take,v_cost,'FIFO');
   update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),
    status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
   insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,
    original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata,organization_id,nisab_reached_date,hawl_cycle,hawl_basis,origin_hawl_start_date,hawl_continuity_source_lot_id,zakatable_pool_entered_date)
   values(p_user_id,p_destination_account,v_in,p_date,v_lot.hawl_start_date,v_lot.hawl_due_date,v_take,v_take,v_cost,v_cost,'ACTIVE',
    jsonb_build_object('source','internal_transfer','transfer_id',v_transfer,'source_lot_id',v_lot.id),v_lot.organization_id,v_lot.nisab_reached_date,v_lot.hawl_cycle,v_lot.hawl_basis,
    coalesce(v_lot.origin_hawl_start_date,v_lot.hawl_start_date),v_lot.id,v_lot.zakatable_pool_entered_date);
   v_total_cost:=v_total_cost+v_cost; v_needed:=v_needed-v_take;
 end loop;
 update public.transactions set base_value=v_total_cost where id in(v_out,v_in);
 return jsonb_build_object('transfer_id',v_transfer,'out_transaction_id',v_out,'in_transaction_id',v_in,'transferred_cost_base',v_total_cost);
end $$;
revoke execute on function public.create_internal_transfer(uuid,uuid,uuid,date,numeric,numeric,text,text) from public,anon;
grant execute on function public.create_internal_transfer(uuid,uuid,uuid,date,numeric,numeric,text,text) to authenticated;
