create table public.personal_financings(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,
 kind text not null check(kind in('LOAN','ADVANCE')),side text not null check(side in('RECEIVABLE','PAYABLE')),
 party text not null,description text not null,reference text not null,amount numeric(24,4)not null check(amount>0),currency text not null,event_date date not null,due_date date,
 account_id uuid not null references public.asset_accounts(id),receivable_id uuid references public.asset_accounts(id),payable_id uuid references public.personal_payables(id),
 cash_transaction_id uuid not null references public.transactions(id),debt_transaction_id uuid references public.transactions(id),
 state text not null default 'POSTED'check(state in('POSTED','REVERSING','REVERSED')),fingerprint text not null,created_at timestamptz not null default now(),unique(user_id,request_id)
);
alter table public.personal_financings enable row level security;
revoke all on public.personal_financings from public,anon,authenticated;grant select on public.personal_financings to authenticated;
create policy personal_financings_read on public.personal_financings for select to authenticated using(user_id=(select auth.uid()));
create index personal_financings_roots on public.personal_financings(user_id,receivable_id,payable_id);
create function private.personal_financing_command(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();req uuid:=(p->>'request_id')::uuid;f public.personal_financings%rowtype;bank public.asset_accounts%rowtype;
 amt numeric:=(p->>'amount')::numeric;dt date:=(p->>'date')::date;due date:=nullif(p->>'due_date','')::date;base text;side text:=p->>'side';kind text:=p->>'kind';fp text:=md5(p::text);debt uuid;cash_tid uuid;debt_tid uuid;result jsonb;qty numeric:=0;remaining numeric;take numeric;lot record;category text;fid uuid:=gen_random_uuid();
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-financing:'||uid::text,0));
 if p->>'action'='REVERSE'then
  select * into f from public.personal_financings where id=(p->>'id')::uuid and user_id=uid for update;
  if f.id is null then raise exception 'PERSONAL_FINANCING_ACCESS_DENIED';end if;
  if length(trim(coalesce(p->>'reason','')))not between 5 and 500 then raise exception 'VALIDATION_FAILED';end if;
  if f.state='REVERSED'then return jsonb_build_object('id',f.id,'replay',true);end if;
  perform id from public.asset_accounts where id in(f.account_id,f.receivable_id)order by id for update;
  if f.side='RECEIVABLE'then
   if exists(select 1 from public.transactions where asset_account_id=f.receivable_id and id<>f.debt_transaction_id)or exists(select 1 from public.lots where source_transaction_id=f.debt_transaction_id and(remaining_quantity<>original_quantity or remaining_value_base<>original_value_base))then raise exception 'PERSONAL_FINANCING_HAS_SETTLEMENTS';end if;
  elsif exists(select 1 from public.personal_payable_payments where payable_id=f.payable_id)then raise exception 'PERSONAL_FINANCING_HAS_SETTLEMENTS';end if;
  if exists(select 1 from public.transactions where reversal_of_transaction_id in(f.cash_transaction_id,f.debt_transaction_id))then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;
  if f.side='PAYABLE'and exists(select 1 from public.lots where source_transaction_id=f.cash_transaction_id and(remaining_quantity<>original_quantity or remaining_value_base<>original_value_base))then raise exception 'SOURCE_LOT_ALREADY_CONSUMED';end if;
  update public.personal_financings set state='REVERSING'where id=f.id;perform set_config('TimeZone','Asia/Riyadh',true);
  if f.side='RECEIVABLE'then
   perform public.reverse_transaction(uid,f.debt_transaction_id);
   -- Transfers may contain several source lots; all must be closed, never just the first.
   update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED'where user_id=uid and source_transaction_id=f.debt_transaction_id;
   perform public.reverse_transaction(uid,f.cash_transaction_id);
  else
   perform public.reverse_transaction(uid,f.cash_transaction_id);
   perform private.personal_payable_command(jsonb_build_object('action','CANCEL','payable_id',f.payable_id,'reason',p->>'reason'));
  end if;
  update public.personal_financings set state='REVERSED'where id=f.id;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_financing',f.id,'REVERSE',p);
  return jsonb_build_object('id',f.id,'state','REVERSED');
 end if;
 if p->>'action'is distinct from 'FUND'or req is null or kind is null or kind not in('LOAN','ADVANCE')or side is null or side not in('RECEIVABLE','PAYABLE')or amt is null or amt<=0 or amt>1e12 or amt<>round(amt,4)or amt::text in('NaN','Infinity','-Infinity')or dt is null or dt>(now()at time zone 'Asia/Riyadh')::date or due<dt or length(trim(coalesce(p->>'party','')))not between 1 and 120 or length(trim(coalesce(p->>'description','')))not between 3 and 500 or length(trim(coalesce(p->>'reference','')))not between 1 and 120 then raise exception 'VALIDATION_FAILED';end if;
 select * into f from public.personal_financings where user_id=uid and request_id=req;
 if f.id is not null then if f.fingerprint<>fp then raise exception 'PERSONAL_FINANCING_REQUEST_CONFLICT';end if;return jsonb_build_object('id',f.id,'replay',true);end if;
 select base_currency into base from public.profiles where id=uid;
 select * into bank from public.asset_accounts where id=(p->>'account_id')::uuid and user_id=uid and ownership_scope='PERSONAL'and organization_id is null and asset_type in('BANK','CASH')and coalesce(metadata->>'archived','false')<>'true'for update;
 if bank.id is null or bank.currency<>base then raise exception 'PERSONAL_FINANCING_BASE_CURRENCY_ONLY';end if;
 category:=case when side='RECEIVABLE'then case when kind='LOAN'then 'P_AR_LOAN'else 'P_AR_OTHER'end else case when kind='LOAN'then 'P_AP_LOAN'else 'P_AP_OTHER'end end;
 if side='RECEIVABLE'then
  insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,unit,is_zakatable,metadata)values(uid,'RECEIVABLE',trim(p->>'party'),base,'PERSONAL','unit',true,jsonb_build_object('entry_source','PERSONAL_FINANCING','due_date',due,'purchase_date',dt,'financing_kind',kind,'notes',p->>'description'))returning id into debt;
  remaining:=amt;
  for lot in select * from public.lots where user_id=uid and asset_account_id=bank.id and remaining_quantity>0 and acquisition_date<=dt order by acquisition_date,created_at,id for update loop
   exit when remaining<=0;if lot.remaining_value_base<=0 then raise exception 'CASH_LOT_REVIEW_REQUIRED';end if;take:=least(remaining,lot.remaining_value_base);qty:=qty+take*lot.remaining_quantity/lot.remaining_value_base;remaining:=remaining-take;
  end loop;
  if remaining>0 then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
  result:=public.create_internal_transfer(uid,bank.id,debt,dt,qty,amt,base,p->>'description');
  if abs((result->>'transferred_cost_base')::numeric-amt)>0.0001 then raise exception 'PERSONAL_FINANCING_RECONCILIATION_FAILED';end if;
  cash_tid:=(result->>'out_transaction_id')::uuid;debt_tid:=(result->>'in_transaction_id')::uuid;
  insert into public.financial_debt_categories(origin,record_id,owner_id,category,updated_by)values('PERSONAL_RECEIVABLE',debt,uid,category,uid);
 else
  result:=private.personal_payable_command(jsonb_build_object('action','CREATE','request_id',req,'party',p->>'party','description',p->>'description','amount',amt,'date',dt,'due_date',due,'reference',p->>'reference'));debt:=(result->>'id')::uuid;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,reference,notes,metadata,created_by)values(uid,bank.id,'ADD',dt,amt,base,amt,base,amt,p->>'reference',p->>'description',jsonb_build_object('source','PERSONAL_FINANCING','kind',kind,'purpose','FUNDING'),uid)returning id into cash_tid;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)values(uid,bank.id,cash_tid,dt,dt,dt,dt,amt,amt,amt,amt,'ACTIVE',jsonb_build_object('source','PERSONAL_FINANCING'));
  insert into public.financial_debt_categories(origin,record_id,owner_id,category,updated_by)values('PERSONAL_PAYABLE',debt,uid,category,uid);
 end if;
 update public.transactions set reference=p->>'reference',metadata=coalesce(metadata,'{}')||jsonb_build_object('source','PERSONAL_FINANCING','financing_id',fid,'kind',kind)where id in(cash_tid,debt_tid)and user_id=uid;
 insert into public.personal_financings(id,user_id,request_id,kind,side,party,description,reference,amount,currency,event_date,due_date,account_id,receivable_id,payable_id,cash_transaction_id,debt_transaction_id,fingerprint)
 values(fid,uid,req,kind,side,trim(p->>'party'),trim(p->>'description'),trim(p->>'reference'),amt,base,dt,due,bank.id,case when side='RECEIVABLE'then debt end,case when side='PAYABLE'then debt end,cash_tid,debt_tid,fp)returning id into fid;

 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'personal_financing',fid,'FUND',p);
 return jsonb_build_object('id',fid,'state','POSTED');
end $$;
revoke all on function private.personal_financing_command(jsonb)from public,anon;grant execute on function private.personal_financing_command(jsonb)to authenticated;
create function public.personal_financing_command(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.personal_financing_command(p_payload);$$;
revoke all on function public.personal_financing_command(jsonb)from public,anon;grant execute on function public.personal_financing_command(jsonb)to authenticated;
-- Prevent partial generic reversals, editing cash history or cancellation of funded debt.
create function private.guard_personal_financing()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare t uuid;begin
 if tg_table_name='personal_payables'then
  if new.cancelled_at is distinct from old.cancelled_at and exists(select 1 from public.personal_financings where payable_id=old.id and state='POSTED')then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;return new;
 end if;
 if tg_op='INSERT'then t:=new.reversal_of_transaction_id;else t:=old.id;end if;
 if exists(select 1 from public.personal_financings where(cash_transaction_id=t or debt_transaction_id=t)and(state<>'REVERSING'or current_user<>'postgres'))then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;
 if tg_op='DELETE'then return old;end if;return new;end $$;
revoke all on function private.guard_personal_financing()from public,anon,authenticated;
create trigger personal_financing_cash_guard before insert or update or delete on public.transactions for each row execute function private.guard_personal_financing();
create trigger personal_financing_payable_guard before update on public.personal_payables for each row execute function private.guard_personal_financing();

create function private.guard_personal_financing_asset()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if exists(select 1 from public.personal_financings where receivable_id=old.id)then
  if tg_op='DELETE'then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;
  if row(new.user_id,new.organization_id,new.asset_type,new.currency,new.ownership_scope,new.metadata->>'archived',new.metadata->>'due_date')is distinct from row(old.user_id,old.organization_id,old.asset_type,old.currency,old.ownership_scope,old.metadata->>'archived',old.metadata->>'due_date')then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;end $$;
revoke all on function private.guard_personal_financing_asset()from public,anon,authenticated;
create trigger personal_financing_asset_guard before update or delete on public.asset_accounts for each row execute function private.guard_personal_financing_asset();
