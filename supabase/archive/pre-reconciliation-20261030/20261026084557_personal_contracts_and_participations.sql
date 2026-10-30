-- Personal contract terms are presentation/control over the existing personal ledger.
-- No balance is stored here or added a second time to the financial position.
create table public.personal_contracts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,
 product text not null check(product in('QARD','FINANCING','PARTICIPATION')),side text not null check(side in('RECEIVABLE','PAYABLE')),
 status text not null default 'DRAFT' check(status in('DRAFT','EXECUTING','POSTED','CANCELLED')),
 revision integer not null default 0,terms jsonb not null,principal numeric(24,4) not null check(principal>0),currency text not null,
 asset_id uuid references public.asset_accounts(id),payable_id uuid references public.personal_payables(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,request_id)
);
create unique index personal_contract_asset_once on public.personal_contracts(asset_id)where asset_id is not null and status<>'CANCELLED';
create unique index personal_contract_payable_once on public.personal_contracts(payable_id)where payable_id is not null and status<>'CANCELLED';
create index personal_contract_owner on public.personal_contracts(user_id,id);
create table public.personal_contract_movements(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),contract_id uuid not null references public.personal_contracts(id),
 request_id uuid not null,kind text not null check(kind in('FUND','SETTLE','CHARGE','PROFIT','LOSS','SETTLE_CHARGE')),
 amount numeric(24,4) not null check(amount>0),operation_date date not null,notes text not null,
 asset_id uuid references public.asset_accounts(id),payable_id uuid references public.personal_payables(id),installment_number integer,
 transaction_ids uuid[] not null default '{}',fingerprint text not null,reversed_at timestamptz,created_at timestamptz not null default clock_timestamp(),unique(user_id,request_id)
);
create index personal_contract_movement_owner on public.personal_contract_movements(user_id,contract_id,id);
create index personal_contract_movement_asset on public.personal_contract_movements(asset_id)where asset_id is not null;
create index personal_contract_movement_payable on public.personal_contract_movements(payable_id)where payable_id is not null;
create unique index personal_contract_charge_once on public.personal_contract_movements(contract_id,installment_number)where kind='CHARGE'and reversed_at is null;
alter table public.personal_contracts enable row level security;
alter table public.personal_contract_movements enable row level security;
revoke all on public.personal_contracts,public.personal_contract_movements from public,anon,authenticated;
grant select on public.personal_contracts,public.personal_contract_movements to authenticated;
create policy personal_contract_owner_read on public.personal_contracts for select to authenticated using(user_id=(select auth.uid()));
create policy personal_contract_movement_owner_read on public.personal_contract_movements for select to authenticated using(user_id=(select auth.uid()));

create function private.personal_contract_balance(p_asset uuid,p_payable uuid)returns numeric language sql security invoker set search_path='' as $$
 select case when p_asset is not null then coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=p_asset and user_id=auth.uid()),0)
 else coalesce((select case when d.cancelled_at is not null then 0 else d.amount-coalesce((select sum(p.amount)from public.personal_payable_payments p where p.payable_id=d.id and p.user_id=auth.uid()and not exists(select 1 from public.transactions t where t.user_id=auth.uid()and t.reversal_of_transaction_id=p.transaction_id)),0)end from public.personal_payables d where d.id=p_payable and d.user_id=auth.uid()),0)end;
$$;
revoke all on function private.personal_contract_balance(uuid,uuid)from public,anon,authenticated;

create function private.personal_contract_asset(p_contract uuid,p_type public.asset_type,p_amount numeric,p_date date,p_label text,p_role text)returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.personal_contracts%rowtype;a uuid;t uuid;begin
 select * into strict c from public.personal_contracts where id=p_contract and user_id=auth.uid()and status='EXECUTING';
 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,unit,is_zakatable,metadata)
 values(c.user_id,p_type,p_label,c.currency,'PERSONAL','unit',coalesce((c.terms->>'zakatable')::boolean,true),jsonb_build_object('personal_contract_id',c.id,'contract_role',p_role,'entry_source','PERSONAL_CONTRACT','acquisition_mode','OPENING_BALANCE','purchase_date',p_date,'purchase_value',p_amount,'fx_rate',1,'due_date',c.terms->'schedule'->0->>'due_date'))returning id into a;
 if p_amount>0 then
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,reference,notes,metadata,created_by)
  values(c.user_id,a,'OPENING_BALANCE',p_date,p_amount,c.currency,p_amount,c.currency,p_amount,c.terms->>'reference',c.terms->>'description',jsonb_build_object('personal_contract_id',c.id,'non_cash',true,'contract_role',p_role),c.user_id)returning id into t;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status)
  values(c.user_id,a,t,p_date,p_date,p_date,p_date,p_amount,p_amount,p_amount,p_amount,'ACTIVE');
 end if;return jsonb_build_object('asset_id',a,'transaction_id',t);
end $$;
revoke all on function private.personal_contract_asset(uuid,public.asset_type,numeric,date,text,text)from public,anon,authenticated;

create function private.personal_contract_cash(p_contract uuid,p_bank uuid,p_asset uuid,p_payable uuid,p_amount numeric,p_date date,p_req uuid,p_notes text,p_direction text)returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.personal_contracts%rowtype;b public.asset_accounts%rowtype;l record;remaining numeric:=p_amount;take numeric;qty numeric:=0;r jsonb;t uuid;ids uuid[]:='{}';src uuid;dst uuid;begin
 select * into strict c from public.personal_contracts where id=p_contract and user_id=auth.uid()and status='EXECUTING';
 perform id from public.asset_accounts where id in(p_bank,p_asset)and user_id=c.user_id order by id for update;
 select * into b from public.asset_accounts where id=p_bank and user_id=c.user_id and organization_id is null and ownership_scope='PERSONAL'and asset_type in('BANK','CASH')and currency=c.currency and coalesce(metadata->>'archived','false')<>'true';
 if b.id is null then raise exception 'PERSONAL_CONTRACT_BANK_INVALID';end if;
 if p_payable is not null then
  r:=private.personal_payable_command(jsonb_build_object('action','PAY','request_id',p_req,'payable_id',p_payable,'account_id',p_bank,'amount',p_amount,'date',p_date,'notes',p_notes));
  ids:=array[(r->>'transaction_id')::uuid];
 elsif p_asset is null and p_direction='INFLOW'then
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,reference,notes,metadata,created_by)
  values(c.user_id,p_bank,'ADD',p_date,p_amount,c.currency,p_amount,c.currency,p_amount,c.terms->>'reference',p_notes,jsonb_build_object('personal_contract_id',c.id),c.user_id)returning id into t;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status)
  values(c.user_id,p_bank,t,p_date,p_date,p_date,p_date,p_amount,p_amount,p_amount,p_amount,'ACTIVE');ids:=array[t];
 else
  src:=case when p_direction='INFLOW'then p_asset else p_bank end;dst:=case when p_direction='INFLOW'then p_bank else p_asset end;
  for l in select * from public.lots where user_id=c.user_id and asset_account_id=src and remaining_quantity>0 and acquisition_date<=p_date order by acquisition_date,created_at,id for update loop
   exit when remaining<=0;if l.remaining_value_base<=0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;
   take:=least(remaining,l.remaining_value_base);qty:=qty+take*l.remaining_quantity/l.remaining_value_base;remaining:=remaining-take;
  end loop;
  if remaining>0 then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
  if dst is null then t:=public.post_withdrawal(c.user_id,src,p_date,qty,p_amount,c.currency,c.currency,p_amount,p_notes,'FIFO','WITHDRAWAL');ids:=array[t];
  else r:=public.create_internal_transfer(c.user_id,src,dst,p_date,qty,p_amount,c.currency,p_notes);if abs((r->>'transferred_cost_base')::numeric-p_amount)>0.0001 then raise exception 'PERSONAL_CONTRACT_RECONCILIATION_FAILED';end if;ids:=array[(r->>'out_transaction_id')::uuid,(r->>'in_transaction_id')::uuid];end if;
 end if;
 -- PAY returns a protected immutable transaction; its canonical payable link is sufficient.
 if p_payable is null then update public.transactions set reference=c.terms->>'reference',metadata=coalesce(metadata,'{}')||jsonb_build_object('personal_contract_id',c.id)where id=any(ids)and user_id=c.user_id;end if;
 return jsonb_build_object('transaction_ids',to_jsonb(ids));
end $$;
revoke all on function private.personal_contract_cash(uuid,uuid,uuid,uuid,numeric,date,uuid,text,text)from public,anon,authenticated;
alter table public.personal_contract_movements add column reversal_request_id uuid,add column reversal_fingerprint text;
create unique index personal_contract_reversal_once on public.personal_contract_movements(user_id,reversal_request_id)where reversal_request_id is not null;

create function private.personal_contract_command(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();cmd text:=p->>'action';req uuid:=(p->>'request_id')::uuid;c public.personal_contracts%rowtype;m public.personal_contract_movements%rowtype;prior public.personal_contract_movements%rowtype;
 t jsonb:=p->'payload';r jsonb;plan jsonb;item jsonb;ids uuid[]:='{}';aid uuid;pid uuid;tid uuid;cid uuid;mid uuid:=gen_random_uuid();fp text:=md5(p::text);base text;
 principal numeric;amt numeric:=(p->>'amount')::numeric;dt date:=(p->>'date')::date;start_dt date;due date;last_due date;total numeric:=0;balance numeric;freq int;i int;qty numeric;remaining numeric;take numeric;l record;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
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
  if exists(select 1 from public.personal_contract_movements where contract_id=c.id and reversed_at is null and operation_date>dt)then raise exception 'PERSONAL_CONTRACT_DATE_ORDER';end if;
  update public.personal_contracts set status='EXECUTING'where id=c.id;
  if cmd='REVERSE'then
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
   update public.personal_contract_movements set reversed_at=now(),reversal_request_id=req,reversal_fingerprint=fp where id=m.id returning * into m;
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
    if c.side='RECEIVABLE'then r:=private.personal_contract_asset(c.id,'RECEIVABLE',amt,dt,t->>'party',cmd);aid:=(r->>'asset_id')::uuid;ids:=array[(r->>'transaction_id')::uuid];update public.asset_accounts set metadata=metadata||jsonb_build_object('due_date',due)where id=aid;
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
create function public.personal_contract_command(p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.personal_contract_command(p_payload);$$;
revoke all on function public.personal_contract_command(jsonb)from public,anon;
grant execute on function public.personal_contract_command(jsonb)to authenticated;
-- The row lock + transient EXECUTING state gates all financial writes. A caller
-- cannot obtain this state through table grants or a user-set session variable.
create function private.guard_personal_contract_ledger()returns trigger language plpgsql security invoker set search_path='' as $$
declare cid uuid;c public.personal_contracts%rowtype;aid uuid;pid uuid;tx uuid;begin
 if tg_table_name='transactions'then
  if tg_op='INSERT'then aid:=new.asset_account_id;tx:=new.reversal_of_transaction_id;cid:=nullif(new.metadata->>'personal_contract_id','')::uuid;
  else aid:=old.asset_account_id;tx:=old.id;cid:=nullif(old.metadata->>'personal_contract_id','')::uuid;end if;
  if cid is null then select id into cid from public.personal_contracts where asset_id=aid and status<>'CANCELLED'limit 1;end if;
  if cid is null then select m.contract_id into cid from public.personal_contract_movements m where tx=any(m.transaction_ids)limit 1;end if;
  if cid is null then select c0.id into cid from public.personal_payable_payments p0 join public.personal_contracts c0 on c0.payable_id=p0.payable_id where p0.transaction_id=tx and c0.status<>'CANCELLED'limit 1;end if;
 elsif tg_table_name='asset_accounts'then
  if tg_op='UPDATE'and row(new.user_id,new.organization_id,new.ownership_scope,new.asset_type,new.currency,new.metadata->>'archived',new.metadata->>'due_date',new.metadata->>'personal_contract_id',new.metadata->>'contract_role',new.metadata->>'purchase_value',new.metadata->>'quantity')is not distinct from row(old.user_id,old.organization_id,old.ownership_scope,old.asset_type,old.currency,old.metadata->>'archived',old.metadata->>'due_date',old.metadata->>'personal_contract_id',old.metadata->>'contract_role',old.metadata->>'purchase_value',old.metadata->>'quantity')then return new;end if;
  aid:=old.id;cid:=nullif(old.metadata->>'personal_contract_id','')::uuid;
 elsif tg_table_name='lots'then
  if tg_op='UPDATE'and row(new.user_id,new.asset_account_id,new.source_transaction_id,new.acquisition_date,new.original_quantity,new.remaining_quantity,new.original_value_base,new.remaining_value_base)is not distinct from row(old.user_id,old.asset_account_id,old.source_transaction_id,old.acquisition_date,old.original_quantity,old.remaining_quantity,old.original_value_base,old.remaining_value_base)then return new;end if;
  if tg_op='INSERT'then aid:=new.asset_account_id;else aid:=old.asset_account_id;end if;
 elsif tg_table_name='personal_payable_payments'then
  if tg_op='INSERT'then pid:=new.payable_id;else pid:=old.payable_id;end if;
 else pid:=old.id;
 end if;
 if cid is null then select id into cid from public.personal_contracts where(asset_id=aid or payable_id=pid)and status<>'CANCELLED'limit 1;end if;
 if cid is null then select contract_id into cid from public.personal_contract_movements where(asset_id=aid or payable_id=pid)and reversed_at is null limit 1;end if;
 if cid is not null then
  select * into c from public.personal_contracts where id=cid;
  if c.status<>'EXECUTING'or current_user<>'postgres'or c.user_id is distinct from auth.uid()then raise exception 'PERSONAL_CONTRACT_USE_SOURCE';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_personal_contract_ledger()from public,anon,authenticated;
create trigger personal_contract_transaction_guard before insert or update or delete on public.transactions for each row execute function private.guard_personal_contract_ledger();
create trigger personal_contract_asset_guard before update or delete on public.asset_accounts for each row execute function private.guard_personal_contract_ledger();
create trigger personal_contract_lot_guard before insert or update or delete on public.lots for each row execute function private.guard_personal_contract_ledger();
create trigger personal_contract_payable_guard before update or delete on public.personal_payables for each row execute function private.guard_personal_contract_ledger();
create trigger personal_contract_payment_guard before insert or update or delete on public.personal_payable_payments for each row execute function private.guard_personal_contract_ledger();
