create table public.personal_payables(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,
 party text not null check(length(trim(party)) between 1 and 120),description text not null check(length(trim(description)) between 3 and 500),
 amount numeric(24,4) not null check(amount>0 and amount<=1e12),currency text not null references public.currencies(code),
 event_date date not null,due_date date,reference text not null default '',cancelled_at timestamptz,cancel_reason text,
 fingerprint text not null,created_at timestamptz not null default now(),unique(user_id,request_id),unique(id,user_id)
);
create table public.personal_payable_payments(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,
 payable_id uuid not null,account_id uuid not null references public.asset_accounts(id),transaction_id uuid not null unique references public.transactions(id),
 amount numeric(24,4) not null check(amount>0),payment_date date not null,notes text not null,fingerprint text not null,
 created_at timestamptz not null default now(),unique(user_id,request_id),foreign key(payable_id,user_id) references public.personal_payables(id,user_id)
);
create index personal_payables_user_date on public.personal_payables(user_id,event_date);
create index personal_payments_payable on public.personal_payable_payments(user_id,payable_id);
alter table public.personal_payables enable row level security;
alter table public.personal_payable_payments enable row level security;
revoke all on public.personal_payables,public.personal_payable_payments from public,anon,authenticated;
grant select on public.personal_payables,public.personal_payable_payments to authenticated;
create policy personal_payables_read on public.personal_payables for select to authenticated using(user_id=(select auth.uid()));
create policy personal_payable_payments_read on public.personal_payable_payments for select to authenticated using(user_id=(select auth.uid()));

-- Only the atomic writer may append the private user's liability/payment ledger.
-- Cash exits use the existing FIFO engine, without corporate events or an expense.
create or replace function private.personal_payable_command(p_payload jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();cmd text;req uuid;debt public.personal_payables%rowtype;prior public.personal_payable_payments%rowtype;account public.asset_accounts%rowtype;
 base text;amt numeric;dt date;pid uuid;tid uuid;paid numeric;remaining numeric;qty numeric:=0;take numeric;l record;fp text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'VALIDATION_FAILED';end if;
 cmd:=p_payload->>'action';req:=(p_payload->>'request_id')::uuid;fp:=md5(p_payload::text);
 if cmd is null or cmd not in('CREATE','PAY','CANCEL','REVERSE_PAYMENT') or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('action','request_id','party','description','amount','date','due_date','reference','payable_id','account_id','notes','reason','payment_id')) then raise exception 'VALIDATION_FAILED';end if;
 select base_currency into base from public.profiles where id=uid;if base is null then raise exception 'PERSONAL_BASE_CURRENCY_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-payable:'||uid::text,0));
 if cmd in('CREATE','PAY') then
  amt:=(p_payload->>'amount')::numeric;dt:=(p_payload->>'date')::date;
  if req is null or amt is null or amt<=0 or amt>1e12 or amt<>round(amt,4) or amt::text in('NaN','Infinity','-Infinity') or dt is null or dt>(now() at time zone 'Asia/Riyadh')::date then raise exception 'VALIDATION_FAILED';end if;
 end if;
 if cmd='CREATE' then
  select * into debt from public.personal_payables where user_id=uid and request_id=req;
  if debt.id is not null then if debt.fingerprint<>fp then raise exception 'PERSONAL_PAYABLE_REQUEST_CONFLICT';end if;return jsonb_build_object('id',debt.id,'idempotent_replay',true);end if;
  if length(trim(coalesce(p_payload->>'party',''))) not between 1 and 120 or length(trim(coalesce(p_payload->>'description',''))) not between 3 and 500 or length(coalesce(p_payload->>'reference',''))>120 then raise exception 'VALIDATION_FAILED';end if;
  insert into public.personal_payables(user_id,request_id,party,description,amount,currency,event_date,due_date,reference,fingerprint)
  values(uid,req,trim(p_payload->>'party'),trim(p_payload->>'description'),amt,base,dt,nullif(p_payload->>'due_date','')::date,coalesce(p_payload->>'reference',''),fp) returning * into debt;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_payable',debt.id,'OPEN',p_payload);
  return jsonb_build_object('id',debt.id,'idempotent_replay',false);
 end if;
 select * into debt from public.personal_payables where id=(p_payload->>'payable_id')::uuid and user_id=uid for update;
 if debt.id is null then raise exception 'PERSONAL_PAYABLE_ACCESS_DENIED';end if;
 if cmd='REVERSE_PAYMENT' then
  if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception 'VALIDATION_FAILED';end if;
  select * into prior from public.personal_payable_payments where id=(p_payload->>'payment_id')::uuid and payable_id=debt.id and user_id=uid;
  if prior.id is null then raise exception 'PERSONAL_PAYABLE_ACCESS_DENIED';end if;
  perform id from public.asset_accounts where id=prior.account_id and user_id=uid for update;
  select id into tid from public.transactions where reversal_of_transaction_id=prior.transaction_id and user_id=uid;
  if tid is null then perform set_config('TimeZone','Asia/Riyadh',true);tid:=public.reverse_transaction(uid,prior.transaction_id);end if;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_payable',debt.id,'REVERSE_PAYMENT',p_payload||jsonb_build_object('reversal_transaction_id',tid));
  return jsonb_build_object('id',prior.id,'reversal_transaction_id',tid);
 end if;
 if cmd='CANCEL' then
  if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception 'VALIDATION_FAILED';end if;
  if exists(select 1 from public.personal_payable_payments where payable_id=debt.id) then raise exception 'PERSONAL_PAYABLE_HAS_PAYMENTS';end if;
  update public.personal_payables set cancelled_at=coalesce(cancelled_at,now()),cancel_reason=p_payload->>'reason' where id=debt.id;
  return jsonb_build_object('id',debt.id,'cancelled',true);
 end if;
 select * into prior from public.personal_payable_payments where user_id=uid and request_id=req;
 if prior.id is not null then if prior.fingerprint<>fp then raise exception 'PERSONAL_PAYABLE_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'transaction_id',prior.transaction_id,'idempotent_replay',true);end if;
 if debt.cancelled_at is not null or dt<debt.event_date or debt.currency<>base or length(trim(coalesce(p_payload->>'notes',''))) not between 3 and 500 then raise exception 'PERSONAL_PAYABLE_PAYMENT_INVALID';end if;
 select coalesce(sum(p.amount),0) into paid from public.personal_payable_payments p where p.payable_id=debt.id and not exists(select 1 from public.transactions t where t.user_id=uid and t.reversal_of_transaction_id=p.transaction_id);
 if amt>debt.amount-paid then raise exception 'PERSONAL_PAYABLE_OVERPAYMENT';end if;
 select * into account from public.asset_accounts where id=(p_payload->>'account_id')::uuid and user_id=uid and ownership_scope='PERSONAL' and organization_id is null and asset_type in('BANK','CASH') and coalesce(metadata->>'archived','false')<>'true' for update;
 if account.id is null then raise exception 'PERSONAL_CASH_ACCESS_DENIED';end if;
 if account.currency<>base then raise exception 'PERSONAL_PAYABLE_BASE_CURRENCY_ONLY';end if;
 -- Lock all available lots before computing the FIFO quantity and valuation.
 perform id from public.lots where asset_account_id=account.id and user_id=uid and remaining_quantity>0 order by acquisition_date,created_at,id for update;
 remaining:=amt;
 for l in select * from public.lots where asset_account_id=account.id and user_id=uid and remaining_quantity>0 and acquisition_date<=dt order by acquisition_date,created_at,id loop
  exit when remaining<=0;
  if l.remaining_value_base<=0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;
  take:=least(remaining,l.remaining_value_base);qty:=qty+take*l.remaining_quantity/l.remaining_value_base;remaining:=remaining-take;
 end loop;
 if remaining>0 then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
 tid:=public.post_withdrawal(uid,account.id,dt,qty,amt,base,base,amt,p_payload->>'notes','FIFO','WITHDRAWAL');
 if abs(coalesce((select sum(value_base) from public.transaction_allocations where transaction_id=tid),0)-amt)>0.0001 then raise exception 'PERSONAL_PAYABLE_CASH_RECONCILIATION_FAILED';end if;
 pid:=gen_random_uuid();
 update public.transactions set reference=debt.reference,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source','PERSONAL_PAYABLE','personal_payable_id',debt.id,'personal_payable_payment_id',pid) where id=tid;
 insert into public.personal_payable_payments(id,user_id,request_id,payable_id,account_id,transaction_id,amount,payment_date,notes,fingerprint)values(pid,uid,req,debt.id,account.id,tid,amt,dt,trim(p_payload->>'notes'),fp);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_payable',debt.id,'PAY',p_payload||jsonb_build_object('transaction_id',tid));
 return jsonb_build_object('id',pid,'transaction_id',tid,'remaining',debt.amount-paid-amt,'idempotent_replay',false);
end $$;
revoke all on function private.personal_payable_command(jsonb) from public,anon;
grant execute on function private.personal_payable_command(jsonb) to authenticated;
create or replace function public.personal_payable_command(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.personal_payable_command(p_payload);$$;
revoke all on function public.personal_payable_command(jsonb) from public,anon;
grant execute on function public.personal_payable_command(jsonb) to authenticated;

-- Generic reversal remains possible through the existing FIFO reversal engine.
-- Reports derive whether a payment was reversed from its real reversal transaction.
create or replace function private.guard_personal_payable_cash()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.personal_payable_payments where (transaction_id=old.id or transaction_id=old.reversal_of_transaction_id) and user_id=auth.uid()) then raise exception 'PERSONAL_PAYABLE_CASH_IMMUTABLE_USE_REVERSAL';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_personal_payable_cash() from public,anon,authenticated;
create trigger guard_personal_payable_cash before update or delete on public.transactions for each row execute function private.guard_personal_payable_cash();
