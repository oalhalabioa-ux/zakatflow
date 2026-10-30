create or replace function public.post_sale_with_proceeds(
 p_user_id uuid,p_asset_account_id uuid,p_destination_account_id uuid,p_date date,p_quantity numeric,p_sale_value numeric,p_currency text,p_base_currency text,p_base_value numeric,p_notes text default null
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_sale uuid;v_cash uuid;v_needed numeric:=p_quantity;v_lot record;v_take numeric;v_cost numeric;v_cost_total numeric:=0;v_transfer uuid:=gen_random_uuid();
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_quantity<=0 or p_sale_value<0 then raise exception 'INVALID_SALE'; end if;
 if p_asset_account_id=p_destination_account_id then raise exception 'DESTINATION_MUST_DIFFER'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_asset_account_id and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_destination_account_id and user_id=p_user_id and asset_type in ('CASH','BANK')) then raise exception 'DESTINATION_MUST_BE_CASH_OR_BANK'; end if;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,transfer_id,metadata,created_by)
 values(p_user_id,p_asset_account_id,'SALE',p_date,p_quantity,upper(p_currency),p_sale_value,upper(p_base_currency),p_base_value,p_notes,v_transfer,jsonb_build_object('proceeds_account_id',p_destination_account_id),p_user_id) returning id into v_sale;
 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
  exit when v_needed<=0;v_take:=least(v_needed,v_lot.remaining_quantity);v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;v_cost_total:=v_cost_total+v_cost;
  insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_sale,v_lot.id,v_take,v_cost,'FIFO');
  update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
  v_needed:=v_needed-v_take;
 end loop;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,notes,transfer_id,metadata,created_by)
 values(p_user_id,p_destination_account_id,'ADD',p_date,p_base_value,1,upper(p_base_currency),p_base_value,upper(p_base_currency),p_base_value,p_notes,v_transfer,jsonb_build_object('source','sale_proceeds','sale_transaction_id',v_sale),p_user_id) returning id into v_cash;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
 values(p_user_id,p_destination_account_id,v_cash,p_date,p_base_value,p_base_value,p_base_value,p_base_value,'ACTIVE',jsonb_build_object('source','sale_proceeds','sale_transaction_id',v_sale));
 return jsonb_build_object('sale_transaction_id',v_sale,'proceeds_transaction_id',v_cash,'realized_gain_base',p_base_value-v_cost_total,'cost_basis_base',v_cost_total,'transfer_id',v_transfer);
end $$;
revoke execute on function public.post_sale_with_proceeds(uuid,uuid,uuid,date,numeric,numeric,text,text,numeric,text) from public,anon;
grant execute on function public.post_sale_with_proceeds(uuid,uuid,uuid,date,numeric,numeric,text,text,numeric,text) to authenticated;

create or replace function public.post_asset_disposal(
 p_user_id uuid,p_asset_account_id uuid,p_date date,p_quantity numeric,p_notes text default null
) returns uuid language plpgsql security invoker set search_path=''
as $$
declare v_id uuid;v_needed numeric:=p_quantity;v_lot record;v_take numeric;v_cost numeric;
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_quantity<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_asset_account_id and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,metadata,created_by)
 select p_user_id,id,'ADJUSTMENT',p_date,p_quantity,currency,0,currency,0,p_notes,jsonb_build_object('adjustment_direction','OUT','reason','DISPOSAL_ZERO_VALUE'),p_user_id from public.asset_accounts where id=p_asset_account_id returning id into v_id;
 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
  exit when v_needed<=0;v_take:=least(v_needed,v_lot.remaining_quantity);v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;
  insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_id,v_lot.id,v_take,v_cost,'FIFO');
  update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
  v_needed:=v_needed-v_take;
 end loop;
 return v_id;
end $$;
revoke execute on function public.post_asset_disposal(uuid,uuid,date,numeric,text) from public,anon;
grant execute on function public.post_asset_disposal(uuid,uuid,date,numeric,text) to authenticated;