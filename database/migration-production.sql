-- ZakatFlow production hardening migration
-- Run after database/schema.sql in Supabase SQL editor.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,name,locale)
  values(new.id, coalesce(new.raw_user_meta_data->>'name',''), coalesce(new.raw_user_meta_data->>'locale','ar'))
  on conflict(id) do nothing;
  insert into public.user_settings(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table transactions drop constraint if exists transactions_asset_account_id_fkey;
alter table transactions add constraint transactions_asset_account_id_fkey foreign key(asset_account_id) references asset_accounts(id) on delete restrict;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles for each row execute procedure public.touch_updated_at();
drop trigger if exists assets_touch on asset_accounts;
create trigger assets_touch before update on asset_accounts for each row execute procedure public.touch_updated_at();

-- Create a Lot whenever an incoming wealth transaction is posted.
create or replace function public.create_lot_for_inflow()
returns trigger language plpgsql as $$
declare v_due date;
begin
  if new.transaction_type in ('ADD','OPENING_BALANCE','PURCHASE','TRANSFER_IN','ADJUSTMENT') and new.quantity > 0 and new.gross_value > 0 then
    -- The exact Hijri calculation is completed by the application rules engine.
    -- We store a conservative placeholder due date one calendar year later for Gregorian methods.
    if exists(select 1 from profiles p join zakat_methods m on m.id=p.zakat_method_id where p.id=new.user_id and m.calendar_type='GREGORIAN') then
      v_due := (new.transaction_date + interval '1 year')::date;
    else
      v_due := (new.transaction_date + interval '1 year')::date;
    end if;
    insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status)
    values(new.user_id,new.asset_account_id,new.id,new.transaction_date,new.transaction_date,v_due,new.quantity,new.quantity,new.base_value,new.base_value,'ACTIVE');
  end if;
  return new;
end; $$;

drop trigger if exists transaction_inflow_lot on transactions;
create trigger transaction_inflow_lot after insert on transactions for each row execute procedure public.create_lot_for_inflow();

-- Prevent duplicate reversal of the same original transaction.
create unique index if not exists uq_one_reversal_per_transaction on transactions(reversal_of_transaction_id) where reversal_of_transaction_id is not null;

-- Helpful assessment indexes.
create index if not exists idx_assessment_lines_assessment on zakat_assessment_lines(assessment_id);
create index if not exists idx_notifications_due on notifications(user_id,scheduled_for) where sent_at is null;

-- Atomic withdrawal allocation (FIFO default). Locks candidate Lots to prevent concurrent double spending.
create or replace function public.post_withdrawal(
 p_user_id uuid,p_asset_account_id uuid,p_date date,p_quantity numeric,p_value numeric,p_currency text,p_base_currency text,p_base_value numeric,p_notes text default null,p_allocation_method allocation_method default 'FIFO')
returns uuid language plpgsql security invoker as $$
declare v_tx uuid:=gen_random_uuid(); v_lot record; v_left numeric:=p_quantity; v_take numeric; v_alloc_value numeric; v_tx_unit numeric;
begin
 if p_quantity<=0 then raise exception 'INVALID_QUANTITY'; end if;
 if not exists(select 1 from asset_accounts where id=p_asset_account_id and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0) < p_quantity then raise exception 'INSUFFICIENT_LOT_QUANTITY'; end if;
 insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,created_by)
 values(v_tx,p_user_id,p_asset_account_id,'WITHDRAWAL',p_date,p_quantity,p_currency,p_value,p_base_currency,p_base_value,p_notes,p_user_id);
 v_tx_unit:=case when p_quantity=0 then 0 else p_base_value/p_quantity end;
 for v_lot in select * from lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,id for update loop
   exit when v_left<=0;
   v_take:=least(v_left,v_lot.remaining_quantity);
   v_alloc_value:=v_take*case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base/v_lot.remaining_quantity end;
   insert into transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
   values(p_user_id,v_tx,v_lot.id,v_take,v_alloc_value,p_allocation_method);
   update lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_alloc_value),status=case when remaining_quantity-v_take<=0 then 'CLOSED' else 'PARTIALLY_USED' end where id=v_lot.id;
   v_left:=v_left-v_take;
 end loop;
 return v_tx;
end; $$;

create or replace function public.reverse_transaction(p_user_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security invoker as $$
declare v_orig transactions%rowtype; v_new uuid:=gen_random_uuid(); v_alloc record; v_type transaction_type;
begin
 select * into v_orig from transactions where id=p_transaction_id and user_id=p_user_id for update;
 if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
 if v_orig.reversal_of_transaction_id is not null then raise exception 'ALREADY_REVERSAL'; end if;
 if exists(select 1 from transactions where reversal_of_transaction_id=p_transaction_id) then raise exception 'ALREADY_REVERSED'; end if;
 if v_orig.transaction_type in ('ADD','OPENING_BALANCE','PURCHASE','TRANSFER_IN','ADJUSTMENT') then
   v_type:='WITHDRAWAL';
   insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,reversal_of_transaction_id,created_by)
   values(v_new,p_user_id,v_orig.asset_account_id,v_type,current_date,v_orig.quantity,v_orig.currency,v_orig.gross_value,v_orig.base_currency,v_orig.base_value,'Reversal of '||p_transaction_id,p_transaction_id,p_user_id);
   -- allocate the reversal against the same source Lots first
   for v_alloc in select * from transaction_allocations where transaction_id=p_transaction_id order by created_at for update loop
     if v_alloc.quantity>0 then
       insert into transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_new,v_alloc.lot_id,v_alloc.quantity,v_alloc.value_base,v_alloc.allocation_method);
       update lots set remaining_quantity=remaining_quantity-v_alloc.quantity,remaining_value_base=greatest(0,remaining_value_base-v_alloc.value_base),status=case when remaining_quantity-v_alloc.quantity<=0 then 'CLOSED' else 'PARTIALLY_USED' end where id=v_alloc.lot_id;
     end if;
   end loop;
 else
   v_type:='ADD';
   for v_alloc in select * from transaction_allocations where transaction_id=p_transaction_id order by created_at for update loop
     update lots set remaining_quantity=remaining_quantity+v_alloc.quantity,remaining_value_base=remaining_value_base+v_alloc.value_base,status='ACTIVE' where id=v_alloc.lot_id;
   end loop;
   insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,reversal_of_transaction_id,created_by)
   values(v_new,p_user_id,v_orig.asset_account_id,v_type,current_date,v_orig.quantity,v_orig.currency,v_orig.gross_value,v_orig.base_currency,v_orig.base_value,'Reversal of '||p_transaction_id,p_transaction_id,p_user_id);
 end if;
 return v_new;
end; $$;

create or replace function public.post_withdrawal(
 p_user_id uuid,p_asset_account_id uuid,p_date date,p_quantity numeric,p_value numeric,p_currency text,p_base_currency text,p_base_value numeric,p_notes text default null,p_allocation_method allocation_method default 'FIFO',p_transaction_type transaction_type default 'WITHDRAWAL')
returns uuid language plpgsql security invoker as $$
declare v_tx uuid:=gen_random_uuid(); v_lot record; v_left numeric:=p_quantity; v_take numeric; v_alloc_value numeric;
begin
 if p_quantity<=0 then raise exception 'INVALID_QUANTITY'; end if;
 if p_transaction_type not in ('WITHDRAWAL','SALE') then raise exception 'INVALID_WITHDRAWAL_TYPE'; end if;
 if not exists(select 1 from asset_accounts where id=p_asset_account_id and user_id=p_user_id) then raise exception 'ASSET_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0) < p_quantity then raise exception 'INSUFFICIENT_LOT_QUANTITY'; end if;
 insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,created_by)
 values(v_tx,p_user_id,p_asset_account_id,p_transaction_type,p_date,p_quantity,p_currency,p_value,p_base_currency,p_base_value,p_notes,p_user_id);
 for v_lot in select * from lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,id for update loop
   exit when v_left<=0;
   v_take:=least(v_left,v_lot.remaining_quantity);
   v_alloc_value:=v_take*case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base/v_lot.remaining_quantity end;
   insert into transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_tx,v_lot.id,v_take,v_alloc_value,p_allocation_method);
   update lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_alloc_value),status=case when remaining_quantity-v_take<=0 then 'CLOSED' else 'PARTIALLY_USED' end where id=v_lot.id;
   v_left:=v_left-v_take;
 end loop;
 return v_tx;
end; $$;

-- Transfer-in Lots are created explicitly so the original Hawl/acquisition date is preserved.
create or replace function public.create_lot_for_inflow()
returns trigger language plpgsql as $$
declare v_due date;
begin
  if new.transaction_type in ('ADD','OPENING_BALANCE','PURCHASE','ADJUSTMENT') and new.quantity > 0 and new.gross_value > 0 then
    v_due := (new.transaction_date + interval '1 year')::date;
    insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status)
    values(new.user_id,new.asset_account_id,new.id,new.transaction_date,new.transaction_date,v_due,new.quantity,new.quantity,new.base_value,new.base_value,'ACTIVE');
  end if;
  return new;
end; $$;

drop trigger if exists transaction_inflow_lot on transactions;
create trigger transaction_inflow_lot after insert on transactions for each row execute procedure public.create_lot_for_inflow();

create or replace function public.create_internal_transfer(p_user_id uuid,p_source_account uuid,p_destination_account uuid,p_date date,p_quantity numeric,p_value numeric,p_currency text,p_notes text default null)
returns uuid language plpgsql security invoker as $$
declare v_transfer uuid:=gen_random_uuid(); v_out uuid:=gen_random_uuid(); v_in uuid:=gen_random_uuid(); v_lot record; v_left numeric:=p_quantity; v_take numeric; v_alloc numeric;
begin
 if not exists(select 1 from asset_accounts where id=p_source_account and user_id=p_user_id) then raise exception 'SOURCE_ACCOUNT_NOT_FOUND'; end if;
 if not exists(select 1 from asset_accounts where id=p_destination_account and user_id=p_user_id) then raise exception 'DESTINATION_ACCOUNT_NOT_FOUND'; end if;
 if coalesce((select sum(remaining_quantity) from lots where user_id=p_user_id and asset_account_id=p_source_account and remaining_quantity>0),0) < p_quantity then raise exception 'INSUFFICIENT_SOURCE_LOTS'; end if;
 insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,notes,created_by) values(v_out,p_user_id,p_source_account,'TRANSFER_OUT',p_date,p_quantity,p_currency,p_value,p_currency,p_value,v_transfer,p_notes,p_user_id);
 insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,notes,created_by) values(v_in,p_user_id,p_destination_account,'TRANSFER_IN',p_date,p_quantity,p_currency,p_value,p_currency,p_value,v_transfer,p_notes,p_user_id);
 for v_lot in select * from lots where user_id=p_user_id and asset_account_id=p_source_account and remaining_quantity>0 order by acquisition_date,id for update loop
   exit when v_left<=0; v_take:=least(v_left,v_lot.remaining_quantity); v_alloc:=v_take*case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base/v_lot.remaining_quantity end;
   insert into transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_out,v_lot.id,v_take,v_alloc,'FIFO');
   update lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_alloc),status=case when remaining_quantity-v_take<=0 then 'CLOSED' else 'PARTIALLY_USED' end where id=v_lot.id;
   insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
   values(p_user_id,p_destination_account,v_in,v_lot.acquisition_date,v_lot.hawl_start_date,v_lot.hawl_due_date,v_take,v_take,v_alloc,v_alloc,'ACTIVE',jsonb_build_object('transferred_from_lot',v_lot.id));
   v_left:=v_left-v_take;
 end loop;
 insert into transfers(id,user_id,transfer_date,source_transaction_id,destination_transaction_id,source_asset_account_id,destination_asset_account_id,quantity,source_value,destination_value,currency,notes) values(v_transfer,p_user_id,p_date,v_out,v_in,p_source_account,p_destination_account,p_quantity,p_value,p_value,p_currency,p_notes);
 return v_transfer;
end; $$;
