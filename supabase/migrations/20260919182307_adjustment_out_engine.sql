create or replace function public.post_adjustment_out(
 p_user_id uuid,p_asset_account_id uuid,p_date date,p_quantity numeric,p_value numeric,p_currency text,p_base_currency text,p_base_value numeric,p_notes text default null
) returns uuid language plpgsql security invoker set search_path=''
as $$
declare v_id uuid; v_needed numeric:=p_quantity; v_lot record; v_take numeric; v_cost numeric;
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_quantity<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_asset_account_id and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,metadata,created_by)
 values(p_user_id,p_asset_account_id,'ADJUSTMENT',p_date,p_quantity,upper(p_currency),p_value,upper(p_base_currency),p_base_value,p_notes,jsonb_build_object('adjustment_direction','OUT'),p_user_id) returning id into v_id;
 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
  exit when v_needed<=0; v_take:=least(v_needed,v_lot.remaining_quantity); v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;
  insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_id,v_lot.id,v_take,v_cost,'FIFO');
  update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
  v_needed:=v_needed-v_take;
 end loop;
 return v_id;
end $$;
revoke execute on function public.post_adjustment_out(uuid,uuid,date,numeric,numeric,text,text,numeric,text) from public,anon;
grant execute on function public.post_adjustment_out(uuid,uuid,date,numeric,numeric,text,text,numeric,text) to authenticated;