-- Saved payment-currency quote and native cash debit; no historical backfill.
alter table public.zakat_payments add column if not exists exchange_rate numeric;
alter table public.zakat_payments add column if not exists fx_rate_id uuid references public.fx_rates(id) on delete set null;
alter table public.zakat_payments add column if not exists fx_valuation_date date;
alter table public.zakat_payments add column if not exists fx_source text;
alter table public.zakat_payments add column if not exists fx_organization_id uuid;
alter table public.zakat_payments add column if not exists cash_amount numeric;
alter table public.zakat_payments add column if not exists cash_currency text;
alter table public.zakat_payments add column if not exists cash_book_base numeric;
create or replace function public.write_zakat_payment(p_input jsonb,p_payment_id uuid default null,p_delete boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();old public.zakat_payments%rowtype;p public.zakat_payments%rowtype;c public.zakat_hawl_cycles%rowtype;curr text; account public.asset_accounts%rowtype; l record; remaining numeric; take numeric; qty numeric:=0;tid uuid;req uuid;fp text;aid uuid;fx public.fx_rates%rowtype;fxid uuid;latestid uuid;rate numeric:=1;cashnum numeric;booknum numeric:=0;nativeunit numeric;unchanged boolean;
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
  unchanged:=old.id is not null and row(old.payment_date,old.amount,old.currency,old.base_amount) is not distinct from row((p_input->>'payment_date')::date,(p_input->>'amount')::numeric,p_input->>'currency',(p_input->>'base_amount')::numeric);
  if old.cash_transaction_id is not null and row(old.cash_account_id,old.payment_date,old.amount,old.currency,old.base_amount) is distinct from row(aid,(p_input->>'payment_date')::date,(p_input->>'amount')::numeric,p_input->>'currency',(p_input->>'base_amount')::numeric) then raise exception 'PAYMENT_CASH_FIELDS_LOCKED';end if;
  if old.id is null and(aid is null or req is null)then raise exception 'PAYMENT_CASH_ACCOUNT_REQUIRED';end if;
  if (p_input->>'payment_date')::date>current_date then raise exception 'PAYMENT_FUTURE_DATE';end if;
  if old.cash_transaction_id is null and not(unchanged and aid is null) then
   if p_input->>'currency' not in(curr,'USD') then raise exception 'PAYMENT_CURRENCY_UNSUPPORTED';end if;
   if (p_input->>'amount')::numeric<>round((p_input->>'amount')::numeric,2) then raise exception 'PAYMENT_AMOUNT_PRECISION';end if;
   if p_input->>'currency'<>curr then
    fxid:=nullif(p_input->>'fx_rate_id','')::uuid;
    select * into fx from public.fx_rates fr where fr.id=fxid and fr.rate>0 and fr.valuation_date<=(p_input->>'payment_date')::date and((fr.from_currency='USD'and fr.to_currency=curr)or(fr.to_currency='USD'and fr.from_currency=curr));
    if fx.id is null then raise exception 'PAYMENT_FX_RATE_REQUIRED';end if;
    select fr.id into latestid from public.fx_rates fr where fr.organization_id is not distinct from fx.organization_id and fr.from_currency=fx.from_currency and fr.to_currency=fx.to_currency and fr.rate>0 and fr.valuation_date<=(p_input->>'payment_date')::date order by fr.valuation_date desc,fr.id desc limit 1;
    rate:=round(case when fx.from_currency='USD'then fx.rate else 1/fx.rate end,12);
    if latestid<>fxid or nullif(p_input->>'exchange_rate','') is null or abs((p_input->>'exchange_rate')::numeric-rate)>0.0000000001 then raise exception 'PAYMENT_FX_RATE_CHANGED';end if;
   end if;
   if abs((p_input->>'base_amount')::numeric-round((p_input->>'amount')::numeric*rate,2))>0.00000001 then raise exception 'PAYMENT_FX_AMOUNT_MISMATCH';end if;
  end if;
  if aid is not null and old.cash_transaction_id is null then
   select * into account from public.asset_accounts where id=aid and user_id=uid and ownership_scope='PERSONAL' and organization_id is null and asset_type in('BANK','CASH') and status='ACTIVE' and coalesce(metadata->>'archived','false')<>'true' for update;
   if account.id is null then raise exception 'PAYMENT_CASH_ACCESS_DENIED';end if;
   if account.currency not in(curr,p_input->>'currency')then raise exception 'PAYMENT_CASH_CURRENCY_MISMATCH';end if;
   cashnum:=case when account.currency=curr then(p_input->>'base_amount')::numeric else(p_input->>'amount')::numeric end;
   perform id from public.lots where asset_account_id=aid and user_id=uid and remaining_quantity>0 order by acquisition_date,created_at,id for update;
   remaining:=cashnum;
   for l in select lot.*,tx.gross_value as native_value,tx.quantity as source_quantity,tx.currency as source_currency from public.lots lot left join public.transactions tx on tx.id=lot.source_transaction_id and tx.user_id=uid where lot.asset_account_id=aid and lot.user_id=uid and lot.remaining_quantity>0 and lot.acquisition_date<=(p_input->>'payment_date')::date order by lot.acquisition_date,lot.created_at,lot.id loop
    exit when remaining<=0;
    if coalesce(l.source_quantity,0)<=0 or coalesce(l.native_value,0)<=0 or l.source_currency<>account.currency or l.remaining_value_base<=0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;
    nativeunit:=l.native_value/l.source_quantity;
    take:=least(remaining,l.remaining_quantity*nativeunit);
    qty:=qty+take/nativeunit;booknum:=booknum+(take/nativeunit)*l.remaining_value_base/l.remaining_quantity;remaining:=remaining-take;
   end loop;
   if remaining>0.00000001 then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
   tid:=public.post_withdrawal(uid,aid,(p_input->>'payment_date')::date,qty,cashnum,account.currency,curr,booknum,p_input->>'notes','FIFO','ZAKAT_PAYMENT');
   if abs(coalesce((select sum(value_base) from public.transaction_allocations where transaction_id=tid),0)-booknum)>0.0001 then raise exception 'PAYMENT_CASH_RECONCILIATION_FAILED';end if;
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
   update public.transactions set reference=p.reference,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source','ZAKAT_PAYMENT','zakat_payment_id',p.id,'zakat_payment_request',req,'payment_currency',p.currency,'payment_amount',p.amount,'zakat_settlement_base',p.base_amount,'fx_rate',rate,'fx_rate_id',fxid,'cash_book_base',booknum,'fx_translation_difference',p.base_amount-booknum) where id=tid and user_id=uid;
   update public.zakat_payments set cash_account_id=aid,cash_transaction_id=tid,cash_account_name=account.name,cash_amount=cashnum,cash_currency=account.currency,cash_book_base=booknum where id=p.id and user_id=uid returning * into p;
  end if;
  if old.cash_transaction_id is null and not(unchanged and aid is null) then update public.zakat_payments set exchange_rate=rate,fx_rate_id=fxid,fx_valuation_date=fx.valuation_date,fx_source=fx.source,fx_organization_id=fx.organization_id where id=p.id and user_id=uid returning * into p;end if;
  if old.id is null then update public.zakat_payments set request_id=req,request_fingerprint=fp where id=p.id and user_id=uid returning * into p;end if;
 end if;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(uid,'zakat_payment',coalesce(p.id,old.id),case when p_delete then 'DELETE_AND_REFLOW_FINAL_FIFO' when old.id is null then 'CREATE_FINAL_FIFO_WITH_CREDIT' else 'UPDATE_AND_REFLOW_FINAL_FIFO' end,case when old.id is not null then to_jsonb(old) end,case when not p_delete then to_jsonb(p) end);
 return case when p_delete then jsonb_build_object('ok',true,'id',old.id) else to_jsonb(p) end;
end $$;
revoke all on function public.write_zakat_payment(jsonb,uuid,boolean) from public,anon;
grant execute on function public.write_zakat_payment(jsonb,uuid,boolean) to authenticated;

