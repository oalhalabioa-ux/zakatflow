alter table public.personal_contract_movements add column reversal_date date;
create table public.personal_contract_installments(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),contract_id uuid not null references public.personal_contracts(id),
 number integer not null check(number between 1 and 48),amount numeric(24,4)not null check(amount>0),due_date date not null,unique(contract_id,number)
);
create index personal_contract_installment_owner on public.personal_contract_installments(user_id,contract_id);
alter table public.personal_contract_installments enable row level security;
revoke all on public.personal_contract_installments from public,anon,authenticated;
grant select on public.personal_contract_installments to authenticated;
create policy personal_contract_installment_read on public.personal_contract_installments for select to authenticated using(user_id=(select auth.uid()));
create function private.personal_contract_installment_snapshot()returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.status='POSTED'and old.status='EXECUTING'and new.product<>'PARTICIPATION'and not exists(select 1 from public.personal_contract_installments where contract_id=new.id)then
  insert into public.personal_contract_installments(user_id,contract_id,number,amount,due_date)select new.user_id,new.id,v.ordinality,(v.value->>'amount')::numeric,(v.value->>'due_date')::date from jsonb_array_elements(new.terms->'schedule')with ordinality as v(value,ordinality);
 end if;return new;
end$$;
revoke all on function private.personal_contract_installment_snapshot()from public,anon,authenticated;
create trigger personal_contract_installment_snapshot after update on public.personal_contracts for each row execute function private.personal_contract_installment_snapshot();
create or replace function private.personal_contract_command(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();cmd text:=p->>'action';req uuid:=(p->>'request_id')::uuid;c public.personal_contracts%rowtype;m public.personal_contract_movements%rowtype;prior public.personal_contract_movements%rowtype;
 t jsonb:=p->'payload';r jsonb;plan jsonb;item jsonb;ids uuid[]:='{}';aid uuid;pid uuid;tid uuid;cid uuid;mid uuid:=gen_random_uuid();fp text:=md5(p::text);base text;
 principal numeric;amt numeric:=(p->>'amount')::numeric;dt date:=(p->>'date')::date;start_dt date;due date;last_due date;total numeric:=0;balance numeric;freq int;i int;qty numeric;remaining numeric;take numeric;l record;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform set_config('TimeZone','Asia/Riyadh',true);
 if jsonb_typeof(p)is distinct from 'object'or cmd is null or cmd not in('SAVE','EXECUTE','CANCEL','SETTLE','CHARGE','PROFIT','LOSS','SETTLE_CHARGE','REVERSE')or exists(select 1 from jsonb_object_keys(p)k where k not in('action','id','request_id','expected_revision','payload','date','amount','account_id','number','movement_id','reason'))then raise exception 'VALIDATION_FAILED';end if;
 -- Serialize both directions, including links to a pre-existing personal financing.
 perform pg_advisory_xact_lock(hashtextextended('personal-contract:'||uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('personal-financing:'||uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('personal-payable:'||uid::text,0));
 select base_currency into base from public.profiles where id=uid;if base is null then raise exception 'PERSONAL_BASE_CURRENCY_REQUIRED';end if;
 if cmd='SAVE'then
  if req is null or jsonb_typeof(t)is distinct from 'object'or not(t ?& array['product','side','mode','party','reference','description','principal','date','currency','account_id','source_id','schedule','finance','profit_share','zakatable'])or exists(select 1 from jsonb_object_keys(t)k where k not in('product','side','mode','party','reference','description','principal','date','currency','account_id','source_id','schedule','finance','profit_share','zakatable'))then raise exception 'VALIDATION_FAILED';end if;
  principal:=(t->>'principal')::numeric;start_dt:=(t->>'date')::date;
  if coalesce(t->>'product','')not in('QARD','FINANCING','PARTICIPATION')or coalesce(t->>'side','')not in('RECEIVABLE','PAYABLE')or coalesce(t->>'mode','')not in('NEW','OPENING','LINKED')or t->>'currency'is distinct from base or principal is null or principal<=0 or principal>1e12 or principal<>round(principal,4)or principal::text in('NaN','Infinity','-Infinity')or start_dt is null or start_dt>(now()at time zone 'Asia/Riyadh')::date or (t->>'date')!~'^\d{4}-\d{2}-\d{2}$'or length(trim(coalesce(t->>'party','')))not between 1 and 120 or length(trim(coalesce(t->>'reference','')))not between 1 and 120 or length(trim(coalesce(t->>'description','')))not between 3 and 500 or jsonb_typeof(t->'zakatable')is distinct from 'boolean'then raise exception 'VALIDATION_FAILED';end if;
  if t->>'mode'='NEW'and nullif(t->>'account_id','')is null or t->>'mode'='LINKED'and(nullif(t->>'source_id','')is null or t->>'product'='PARTICIPATION')or t->>'mode'<>'LINKED'and nullif(t->>'source_id','')is not null then raise exception 'PERSONAL_CONTRACT_SOURCE_INVALID';end if;
  if jsonb_typeof(t->'schedule')is distinct from 'array'or jsonb_array_length(t->'schedule')not between 1 and 48 then raise exception 'SCHEDULE_INVALID';end if;
  for item in select value from jsonb_array_elements(t->'schedule')loop
   amt:=(item->>'amount')::numeric;due:=(item->>'due_date')::date;
   if jsonb_typeof(item)is distinct from 'object'or exists(select 1 from jsonb_object_keys(item)k where k not in('amount','due_date'))or amt is null or amt<=0 or amt<>round(amt,4)or amt::text in('NaN','Infinity','-Infinity')or due is null or due<start_dt or due<last_due or (item->>'due_date')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'SCHEDULE_INVALID';end if;
   total:=total+amt;last_due:=due;
  end loop;if total<>principal then raise exception 'SCHEDULE_TOTAL_INVALID';end if;
  if (t->>'profit_share')::numeric is null or (t->>'profit_share')::numeric<0 or (t->>'profit_share')::numeric>100 or (t->>'profit_share')::numeric::text in('NaN','Infinity','-Infinity')then raise exception 'VALIDATION_FAILED';end if;
  if t->>'product'='FINANCING'then
   if jsonb_typeof(t->'finance')is distinct from 'object'or not(t->'finance'?&array['annualRate','method','repayment','frequencyMonths','yearDays'])or exists(select 1 from jsonb_object_keys(t->'finance')k where k not in('annualRate','method','repayment','frequencyMonths','yearDays'))or(t->'finance'->>'annualRate')::numeric<=0 then raise exception 'INVALID_FINANCE_TERMS';end if;
   plan:=public.calculate_financing_schedule((t->'finance')||jsonb_build_object('principal',principal,'startDate',start_dt,'firstDueDate',t->'schedule'->0->>'due_date','count',jsonb_array_length(t->'schedule')));
   for i in 0..jsonb_array_length(plan)-1 loop if(plan->i->>'principal')::numeric<>(t->'schedule'->i->>'amount')::numeric or plan->i->>'due_date'is distinct from t->'schedule'->i->>'due_date'then raise exception 'FINANCE_PLAN_MISMATCH';end if;end loop;
  elsif t->'finance' is distinct from 'null'::jsonb then raise exception 'INVALID_FINANCE_TERMS';end if;
  if p->>'id'is null then
   select * into c from public.personal_contracts where user_id=uid and request_id=req;
   if c.id is not null then if c.terms<>t then raise exception 'PERSONAL_CONTRACT_REQUEST_CONFLICT';end if;return to_jsonb(c);end if;
   insert into public.personal_contracts(user_id,request_id,product,side,terms,principal,currency)values(uid,req,t->>'product',t->>'side',t,principal,base)returning * into c;
  else
   select * into c from public.personal_contracts where id=(p->>'id')::uuid and user_id=uid for update;
   if c.id is null then raise exception 'PERSONAL_CONTRACT_ACCESS_DENIED';end if;
   if c.status<>'DRAFT'or c.revision is distinct from(p->>'expected_revision')::int then raise exception 'PERSONAL_CONTRACT_CHANGED';end if;
   update public.personal_contracts set product=t->>'product',side=t->>'side',terms=t,principal=personal_contract_command.principal,currency=base,revision=revision+1,updated_at=now()where id=c.id returning * into c;
  end if;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_contract',c.id,'SAVE',p);return to_jsonb(c);
 end if;
 select * into c from public.personal_contracts where id=(p->>'id')::uuid and user_id=uid for update;
 if c.id is null then raise exception 'PERSONAL_CONTRACT_ACCESS_DENIED';end if;
 if length(trim(coalesce(p->>'reason','')))not between 3 and 500 then raise exception 'VALIDATION_FAILED';end if;
 if c.currency<>base then raise exception 'PERSONAL_CONTRACT_BASE_CURRENCY_CHANGED';end if;
 t:=c.terms;start_dt:=(t->>'date')::date;
 if cmd='CANCEL'then
  if c.status='CANCELLED'then return to_jsonb(c);end if;
  if c.status<>'DRAFT'or c.revision is distinct from(p->>'expected_revision')::int then raise exception 'PERSONAL_CONTRACT_CHANGED';end if;
  update public.personal_contracts set status='CANCELLED',revision=revision+1,updated_at=now()where id=c.id returning * into c;
 elsif cmd='EXECUTE'then
  if c.status='POSTED'then return to_jsonb(c);end if;
  if c.status<>'DRAFT'or c.revision is distinct from(p->>'expected_revision')::int then raise exception 'PERSONAL_CONTRACT_CHANGED';end if;
  update public.personal_contracts set status='EXECUTING'where id=c.id;
  if t->>'mode'='LINKED'then
   if c.side='RECEIVABLE'then
    select id into aid from public.asset_accounts where id=(t->>'source_id')::uuid and user_id=uid and ownership_scope='PERSONAL'and organization_id is null and asset_type='RECEIVABLE'and currency=base and coalesce(metadata->>'archived','false')<>'true'for update;
    if aid is null or exists(select 1 from public.transactions where asset_account_id=aid and user_id=uid and transaction_date>start_dt)or exists(select 1 from public.personal_financings where receivable_id=aid and kind='ADVANCE')then raise exception 'PERSONAL_CONTRACT_SOURCE_INVALID';end if;
   else
    select id into pid from public.personal_payables where id=(t->>'source_id')::uuid and user_id=uid and currency=base and cancelled_at is null and event_date<=start_dt for update;
    if pid is null or exists(select 1 from public.personal_payable_payments where payable_id=pid and payment_date>start_dt)or exists(select 1 from public.personal_financings where payable_id=pid and kind='ADVANCE')then raise exception 'PERSONAL_CONTRACT_SOURCE_INVALID';end if;
   end if;
   if private.personal_contract_balance(aid,pid)<>c.principal then raise exception 'PERSONAL_CONTRACT_SOURCE_CHANGED';end if;
  elsif c.side='RECEIVABLE'then
   r:=private.personal_contract_asset(c.id,case when c.product='PARTICIPATION'then 'OTHER'::public.asset_type else 'RECEIVABLE'::public.asset_type end,case when t->>'mode'='OPENING'then c.principal else 0 end,start_dt,t->>'party','PRINCIPAL');aid:=(r->>'asset_id')::uuid;
   if nullif(r->>'transaction_id','')is not null then ids:=array[(r->>'transaction_id')::uuid];end if;
   update public.personal_contracts set asset_id=aid where id=c.id;
   if t->>'mode'='NEW'then r:=private.personal_contract_cash(c.id,(t->>'account_id')::uuid,aid,null,c.principal,start_dt,c.id,t->>'description','OUTFLOW');select coalesce(array_agg(value::uuid),'{}')into ids from jsonb_array_elements_text(r->'transaction_ids');end if;
  else
   r:=private.personal_payable_command(jsonb_build_object('action','CREATE','request_id',c.id,'party',t->>'party','description',t->>'description','amount',c.principal,'date',start_dt,'due_date',t->'schedule'->0->>'due_date','reference',t->>'reference'));pid:=(r->>'id')::uuid;
   update public.personal_contracts set payable_id=pid where id=c.id;
   if t->>'mode'='NEW'then r:=private.personal_contract_cash(c.id,(t->>'account_id')::uuid,null,null,c.principal,start_dt,c.id,t->>'description','INFLOW');select coalesce(array_agg(value::uuid),'{}')into ids from jsonb_array_elements_text(r->'transaction_ids');end if;
  end if;
  update public.personal_contracts set asset_id=aid,payable_id=pid where id=c.id;
  if c.product<>'PARTICIPATION'then perform private.assign_debt_category(case when aid is not null then 'PERSONAL_RECEIVABLE'else 'PERSONAL_PAYABLE'end,coalesce(aid,pid),case when aid is not null then 'P_AR_LOAN'else 'P_AP_LOAN'end);end if;
  insert into public.personal_contract_movements(user_id,contract_id,request_id,kind,amount,operation_date,notes,transaction_ids,fingerprint)values(uid,c.id,c.id,'FUND',c.principal,start_dt,p->>'reason',ids,md5(('EXECUTE:'||c.id)::text));
  update public.personal_contracts set status='POSTED',revision=revision+1,updated_at=now()where id=c.id returning * into c;
 else
  if req is null or dt is null or dt<start_dt or dt>(now()at time zone 'Asia/Riyadh')::date then raise exception 'VALIDATION_FAILED';end if;
  select * into prior from public.personal_contract_movements where user_id=uid and request_id=req;
  if prior.id is not null then if prior.contract_id<>c.id or prior.fingerprint<>fp then raise exception 'PERSONAL_CONTRACT_REQUEST_CONFLICT';end if;return to_jsonb(prior);end if;
  if exists(select 1 from public.personal_contract_movements where user_id=uid and reversal_request_id=req)and cmd<>'REVERSE'then raise exception 'PERSONAL_CONTRACT_REQUEST_CONFLICT';end if;
  if c.status<>'POSTED'then raise exception 'PERSONAL_CONTRACT_NOT_POSTED';end if;
  if exists(select 1 from public.personal_contract_movements where contract_id=c.id and greatest(operation_date,coalesce(reversal_date,operation_date))>dt)then raise exception 'PERSONAL_CONTRACT_DATE_ORDER';end if;
  update public.personal_contracts set status='EXECUTING'where id=c.id;
  if cmd='REVERSE'then
   if dt<>(now()at time zone 'Asia/Riyadh')::date then raise exception 'REVERSAL_DATE_MUST_BE_TODAY';end if;
   select * into m from public.personal_contract_movements where id=(p->>'movement_id')::uuid and contract_id=c.id and user_id=uid for update;
   if m.id is null then raise exception 'PERSONAL_CONTRACT_ACCESS_DENIED';end if;
   if m.reversed_at is not null then if m.reversal_fingerprint<>fp then raise exception 'PERSONAL_CONTRACT_REQUEST_CONFLICT';end if;update public.personal_contracts set status='POSTED'where id=c.id;return to_jsonb(m);end if;
   if exists(select 1 from public.personal_contract_movements where contract_id=c.id and reversed_at is null and(created_at,id)>(m.created_at,m.id))then raise exception 'PERSONAL_CONTRACT_REVERSE_LATEST_FIRST';end if;
   if m.kind in('CHARGE','PROFIT')and private.personal_contract_balance(m.asset_id,m.payable_id)<>m.amount then raise exception 'PERSONAL_CONTRACT_HAS_SETTLEMENTS';end if;
   if exists(select 1 from public.lots where source_transaction_id=any(m.transaction_ids)and(remaining_quantity<>original_quantity or remaining_value_base<>original_value_base))then raise exception 'SOURCE_LOT_ALREADY_CONSUMED';end if;
   if coalesce(array_length(m.transaction_ids,1),0)>0 then
    for i in reverse array_length(m.transaction_ids,1)..1 loop
     tid:=public.reverse_transaction(uid,m.transaction_ids[i]);
     if exists(select 1 from public.transactions where id=m.transaction_ids[i]and transaction_type in('TRANSFER_IN','ADD','OPENING_BALANCE'))then update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED'where user_id=uid and source_transaction_id=m.transaction_ids[i];end if;
    end loop;
   end if;
   if m.kind='LOSS'and c.payable_id is not null then update public.personal_payables set amount=case when cancel_reason='PERSONAL_CONTRACT_FULL_LOSS'then amount else amount+m.amount end,cancelled_at=null,cancel_reason=null where id=c.payable_id and user_id=uid;end if;
   if m.kind in('CHARGE','PROFIT')and m.payable_id is not null then update public.personal_payables set cancelled_at=now(),cancel_reason=p->>'reason'where id=m.payable_id and user_id=uid;end if;
   if m.kind='FUND'and t->>'mode'<>'LINKED'and c.payable_id is not null then update public.personal_payables set cancelled_at=now(),cancel_reason=p->>'reason'where id=c.payable_id and user_id=uid;end if;
   update public.personal_contract_movements set reversed_at=now(),reversal_date=dt,reversal_request_id=req,reversal_fingerprint=fp where id=m.id returning * into m;
   update public.personal_contracts set status=case when m.kind='FUND'then 'CANCELLED'else 'POSTED'end,revision=revision+1,updated_at=now()where id=c.id returning * into c;
  else
   if cmd='CHARGE'then
    if c.product<>'FINANCING'or(p->>'number')::int is null then raise exception 'INVALID_FINANCE_TERMS';end if;
    plan:=public.calculate_financing_schedule((t->'finance')||jsonb_build_object('principal',c.principal,'startDate',start_dt,'firstDueDate',t->'schedule'->0->>'due_date','count',jsonb_array_length(t->'schedule')));
    item:=plan->((p->>'number')::int-1);due:=(item->>'due_date')::date;amt:=(item->>'finance')::numeric;
    if item is null or due>dt or amt<=0 then raise exception 'FINANCE_PERIOD_NOT_ENDED';end if;
    if exists(select 1 from public.personal_contract_movements where contract_id=c.id and kind='CHARGE'and installment_number=(p->>'number')::int and reversed_at is null)then raise exception 'PERSONAL_CONTRACT_CHARGE_EXISTS';end if;
   elsif cmd='PROFIT'then
    if c.product<>'PARTICIPATION'then raise exception 'PERSONAL_CONTRACT_PRODUCT_INVALID';end if;
    amt:=round(amt*(t->>'profit_share')::numeric/100,4);due:=dt;
   end if;
   if amt is null or amt<=0 or amt>1e12 or amt<>round(amt,4)or amt::text in('NaN','Infinity','-Infinity')then raise exception 'VALIDATION_FAILED';end if;
   if cmd in('CHARGE','PROFIT')then
    if c.side='RECEIVABLE'then r:=private.personal_contract_asset(c.id,'RECEIVABLE',amt,dt,t->>'party',cmd,due);aid:=(r->>'asset_id')::uuid;ids:=array[(r->>'transaction_id')::uuid];
    else r:=private.personal_payable_command(jsonb_build_object('action','CREATE','request_id',req,'party',t->>'party','description',case when cmd='CHARGE'then 'تكلفة تمويل · 'else 'حصة ربح مستحقة · 'end||(t->>'reference'),'amount',amt,'date',dt,'due_date',due,'reference',t->>'reference'));pid:=(r->>'id')::uuid;end if;
    perform private.assign_debt_category(case when aid is not null then 'PERSONAL_RECEIVABLE'else 'PERSONAL_PAYABLE'end,coalesce(aid,pid),case when aid is not null then 'P_AR_OTHER'else 'P_AP_ACCRUAL'end);
   elsif cmd='LOSS'then
    if c.product<>'PARTICIPATION'or amt>private.personal_contract_balance(c.asset_id,c.payable_id)then raise exception 'PERSONAL_CONTRACT_LOSS_INVALID';end if;
    if c.payable_id is not null then update public.personal_payables set cancelled_at=case when amount=amt then now()else cancelled_at end,cancel_reason=case when amount=amt then 'PERSONAL_CONTRACT_FULL_LOSS'else cancel_reason end,amount=case when amount=amt then amount else amount-amt end where id=c.payable_id and user_id=uid;
    else remaining:=amt;qty:=0;for l in select * from public.lots where asset_account_id=c.asset_id and user_id=uid and remaining_quantity>0 and acquisition_date<=dt order by acquisition_date,created_at,id for update loop exit when remaining<=0;take:=least(remaining,l.remaining_value_base);qty:=qty+take*l.remaining_quantity/l.remaining_value_base;remaining:=remaining-take;end loop;if remaining>0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;tid:=public.post_withdrawal(uid,c.asset_id,dt,qty,amt,base,base,amt,p->>'reason','FIFO','WITHDRAWAL');ids:=array[tid];end if;
   else
    aid:=c.asset_id;pid:=c.payable_id;
    if cmd='SETTLE_CHARGE'then select * into m from public.personal_contract_movements where id=(p->>'movement_id')::uuid and contract_id=c.id and user_id=uid and kind in('CHARGE','PROFIT')and reversed_at is null;if m.id is null then raise exception 'PERSONAL_CONTRACT_ACCESS_DENIED';end if;aid:=m.asset_id;pid:=m.payable_id;end if;
    if cmd not in('SETTLE','SETTLE_CHARGE')or amt>private.personal_contract_balance(aid,pid)then raise exception 'PERSONAL_CONTRACT_OVERPAYMENT';end if;
    if cmd='SETTLE'and c.product='FINANCING'then select coalesce(sum((v->>'amount')::numeric),0)into total from jsonb_array_elements(t->'schedule')v where(v->>'due_date')::date<=dt;balance:=private.personal_contract_balance(aid,pid);if amt>greatest(0,total-(c.principal-balance))then raise exception 'FINANCE_EARLY_SETTLEMENT_REQUIRES_AMENDMENT';end if;end if;
    r:=private.personal_contract_cash(c.id,(p->>'account_id')::uuid,aid,pid,amt,dt,req,p->>'reason',case when c.side='RECEIVABLE'then 'INFLOW'else 'OUTFLOW'end);select coalesce(array_agg(value::uuid),'{}')into ids from jsonb_array_elements_text(r->'transaction_ids');
    -- Settlement rows point to the charge only through the source movement id in the audit payload.
    aid:=null;pid:=null;
   end if;
   insert into public.personal_contract_movements(id,user_id,contract_id,request_id,kind,amount,operation_date,notes,asset_id,payable_id,installment_number,transaction_ids,fingerprint)
   values(mid,uid,c.id,req,cmd,amt,dt,p->>'reason',aid,pid,case when cmd='CHARGE'then(p->>'number')::int end,ids,fp)returning * into m;
   update public.personal_contracts set status='POSTED',revision=revision+1,updated_at=now()where id=c.id returning * into c;
  end if;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_contract',c.id,cmd,p||jsonb_build_object('movement_id',m.id));
 return to_jsonb(c);
end $$;
revoke all on function private.personal_contract_command(jsonb)from public,anon;
grant execute on function private.personal_contract_command(jsonb)to authenticated;
