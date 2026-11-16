alter table public.zakat_assessments add column if not exists cycle_number integer not null default 1 check (cycle_number >= 1);

create or replace function public.update_zakat_payment_and_reallocate(p_payment_id uuid,p_payment_date date,p_amount numeric,p_base_amount numeric,p_beneficiary text default null,p_reference text default null,p_notes text default null)
returns public.zakat_payments
language plpgsql security invoker set search_path=public as $$
declare v_user uuid:=auth.uid(); v_row public.zakat_payments;begin
 if v_user is null then raise exception 'UNAUTHORIZED'; end if;
 if p_amount<=0 or p_base_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 update public.zakat_payments set payment_date=p_payment_date,amount=p_amount,base_amount=p_base_amount,beneficiary=p_beneficiary,reference=p_reference,notes=p_notes where id=p_payment_id and user_id=v_user returning * into v_row;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 perform public.allocate_zakat_payment_fifo(p_payment_id);
 return v_row;
end $$;
revoke all on function public.update_zakat_payment_and_reallocate(uuid,date,numeric,numeric,text,text,text) from public;
grant execute on function public.update_zakat_payment_and_reallocate(uuid,date,numeric,numeric,text,text,text) to authenticated;