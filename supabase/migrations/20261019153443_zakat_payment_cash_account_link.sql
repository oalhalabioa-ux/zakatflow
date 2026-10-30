-- Connect personal zakat payments to the existing cash FIFO ledger atomically.
-- Existing payments stay historical and are never backfilled with cash movements.
alter table public.zakat_payments add column if not exists cash_account_id uuid references public.asset_accounts(id);
alter table public.zakat_payments add column if not exists cash_transaction_id uuid references public.transactions(id);
alter table public.zakat_payments add column if not exists cash_account_name text;
alter table public.zakat_payments add column if not exists request_id uuid;
alter table public.zakat_payments add column if not exists request_fingerprint text;
create unique index if not exists zakat_payments_cash_transaction_unique on public.zakat_payments(cash_transaction_id) where cash_transaction_id is not null;
create unique index if not exists zakat_payments_request_unique on public.zakat_payments(user_id,request_id) where request_id is not null;
create or replace function public.write_zakat_payment(p_input jsonb,p_payment_id uuid default null,p_delete boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();old public.zakat_payments%rowtype;p public.zakat_payments%rowtype;c public.zakat_hawl_cycles%rowtype;curr text; account public.asset_accounts%rowtype; l record; remaining numeric; take numeric; qty numeric:=0;tid uuid;req uuid;fp text;aid uuid;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform set_config('TimeZone','Asia/Riyadh',true);
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 req:=nullif(p_input->>'request_id','')::uuid;fp:=md5((p_input-'request_id')::text);
 if p_payment_id is null and not p_delete and req is not null then
  select * into p from public.zakat_payments where user_id=uid and request_id=req;
  if p.id is not null then if p.request_fingerprint is distinct from fp then raise exception 'PAYMENT_REQUEST_CONFLICT';end if;return to_jsonb(p);end if;
  if exists(select 1 from public.transactions where user_id=uid and metadata->>'zakat_payment_request'=req::text)then raise exception 'PAYMENT_REQUEST_REVERSED';end if;
 end if;
 if p_payment_id is not null then
  select * into old from public.zakat_payments where id=p_payment_id and user_id=uid for update;
  if old.id is null then raise exception 'PAYMENT_NOT_FOUND';end if;
 end if;
 if p_delete then
  if old.id is null then raise exception 'PAYMENT_ID_REQUIRED';end if;
  delete from public.zakat_payment_allocations pa using public.zakat_payments q where pa.payment_id=q.id and pa.user_id=uid and q.user_id=uid and q.payment_date>=old.payment_date;
  delete from public.zakat_payments where id=old.id and user_id=uid;
  if old.cash_transaction_id is not null then perform public.reverse_transaction(uid,old.cash_transaction_id);end if;
 else
  select * into c from public.zakat_hawl_cycles where id=(p_input->>'hawl_cycle_id')::uuid and user_id=uid;
  if c.id is null then raise exception 'PAYMENT_CYCLE_REQUIRED';end if;
  if c.final_assessment_id is null then raise exception 'CYCLE_NOT_FINALIZED';end if;
  if coalesce((c.snapshot->>'historical_settled')::boolean,false) then raise exception 'HISTORICAL_CYCLE_ALREADY_SETTLED';end if;
  if coalesce((p_input->>'amount')::numeric,0)<=0 or coalesce((p_input->>'base_amount')::numeric,0)<=0 or p_input->>'payment_date' is null then raise exception 'PAYMENT_AMOUNT_INVALID';end if;
  select base_currency into curr from public.profiles where id=uid;
  if length(p_input->>'currency')<>3 or ((p_input->>'currency')=curr and (p_input->>'amount')::numeric is distinct from (p_input->>'base_amount')::numeric) then raise exception 'PAYMENT_CURRENCY_INVALID';end if;
  aid:=nullif(p_input->>'cash_account_id','')::uuid;
  if old.cash_transaction_id is not null and row(old.cash_account_id,old.payment_date,old.amount,old.currency,old.base_amount) is distinct from row(aid,(p_input->>'payment_date')::date,(p_input->>'amount')::numeric,p_input->>'currency',(p_input->>'base_amount')::numeric) then raise exception 'PAYMENT_CASH_FIELDS_LOCKED';end if;
  if old.id is null and(aid is null or req is null)then raise exception 'PAYMENT_CASH_ACCOUNT_REQUIRED';end if;
  if (p_input->>'payment_date')::date>current_date then raise exception 'PAYMENT_FUTURE_DATE';end if;
  if aid is not null and old.cash_transaction_id is null then
   select * into account from public.asset_accounts where id=aid and user_id=uid and ownership_scope='PERSONAL' and organization_id is null and asset_type in('BANK','CASH') and status='ACTIVE' and coalesce(metadata->>'archived','false')<>'true' for update;
   if account.id is null then raise exception 'PAYMENT_CASH_ACCESS_DENIED';end if;
   if account.currency<>curr or p_input->>'currency'<>curr then raise exception 'PAYMENT_CASH_BASE_CURRENCY_ONLY';end if;
   perform id from public.lots where asset_account_id=aid and user_id=uid and remaining_quantity>0 order by acquisition_date,created_at,id for update;
   remaining:=(p_input->>'base_amount')::numeric;
   for l in select * from public.lots where asset_account_id=aid and user_id=uid and remaining_quantity>0 and acquisition_date<=(p_input->>'payment_date')::date order by acquisition_date,created_at,id loop
    exit when remaining<=0;
    if l.remaining_value_base<=0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;
    take:=least(remaining,l.remaining_value_base);qty:=qty+take*l.remaining_quantity/l.remaining_value_base;remaining:=remaining-take;
   end loop;
   if remaining>0 then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
   tid:=public.post_withdrawal(uid,aid,(p_input->>'payment_date')::date,qty,(p_input->>'amount')::numeric,curr,curr,(p_input->>'base_amount')::numeric,p_input->>'notes','FIFO','ZAKAT_PAYMENT');
   if abs(coalesce((select sum(value_base) from public.transaction_allocations where transaction_id=tid),0)-(p_input->>'base_amount')::numeric)>0.0001 then raise exception 'PAYMENT_CASH_RECONCILIATION_FAILED';end if;
  end if;
  -- Reflow later payments if chronology or amount changes. Earlier posted
  -- allocations remain untouched, including the user's original payment.
  delete from public.zakat_payment_allocations pa using public.zakat_payments q where pa.payment_id=q.id and pa.user_id=uid and q.user_id=uid and q.payment_date>=least(coalesce(old.payment_date,(p_input->>'payment_date')::date),(p_input->>'payment_date')::date);
  if old.id is null then
   insert into public.zakat_payments(user_id,assessment_id,hawl_cycle_id,payment_date,amount,currency,base_amount,beneficiary,reference,notes) values(uid,c.final_assessment_id,c.id,(p_input->>'payment_date')::date,(p_input->>'amount')::numeric,p_input->>'currency',(p_input->>'base_amount')::numeric,p_input->>'beneficiary',p_input->>'reference',p_input->>'notes') returning * into p;
  else
   update public.zakat_payments set assessment_id=c.final_assessment_id,hawl_cycle_id=c.id,payment_date=(p_input->>'payment_date')::date,amount=(p_input->>'amount')::numeric,currency=p_input->>'currency',base_amount=(p_input->>'base_amount')::numeric,beneficiary=p_input->>'beneficiary',reference=p_input->>'reference',notes=p_input->>'notes' where id=old.id and user_id=uid returning * into p;
  end if;
  if tid is not null then
   update public.transactions set reference=p.reference,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source','ZAKAT_PAYMENT','zakat_payment_id',p.id,'zakat_payment_request',req) where id=tid and user_id=uid;
   update public.zakat_payments set cash_account_id=aid,cash_transaction_id=tid,cash_account_name=account.name where id=p.id and user_id=uid returning * into p;
  end if;
  if old.id is null then update public.zakat_payments set request_id=req,request_fingerprint=fp where id=p.id and user_id=uid returning * into p;end if;
 end if;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(uid,'zakat_payment',coalesce(p.id,old.id),case when p_delete then 'DELETE_AND_REFLOW_FINAL_FIFO' when old.id is null then 'CREATE_FINAL_FIFO_WITH_CREDIT' else 'UPDATE_AND_REFLOW_FINAL_FIFO' end,case when old.id is not null then to_jsonb(old) end,case when not p_delete then to_jsonb(p) end);
 return case when p_delete then jsonb_build_object('ok',true,'id',old.id) else to_jsonb(p) end;
end $$;
revoke all on function public.write_zakat_payment(jsonb,uuid,boolean) from public,anon;
grant execute on function public.write_zakat_payment(jsonb,uuid,boolean) to authenticated;

create or replace function public.reverse_transaction(p_user_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_orig public.transactions%rowtype; v_rev uuid; v_alloc record; v_source_lot public.lots%rowtype;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then raise exception 'UNAUTHORIZED'; end if;
  select * into v_orig from public.transactions where id=p_transaction_id and user_id=p_user_id for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if exists(select 1 from public.zakat_payments where user_id=p_user_id and cash_transaction_id=p_transaction_id)then raise exception 'ZAKAT_REVERSE_FROM_PAYMENTS';end if;
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
