create or replace function private.investment_cash_event_hook()returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare op uuid;
begin
 if new.source_module='INVESTMENTS'and new.status='REVERSED'and old.status='ACTUAL'then raise exception 'INVESTMENT_POSTED_OPERATION_IMMUTABLE';end if;
 if new.source_module='INVESTMENTS'and new.event_type='SETTLEMENT'and new.status='ACTUAL'and old.status<>'ACTUAL'then
  select id into op from public.investment_operations where settlement_event_id=new.id;
  if op is null then raise exception 'INVESTMENT_OPERATION_SOURCE_REQUIRED';end if;
  perform private.investment_apply_posted(op);
 end if;return new;
end $$;
revoke all on function private.investment_cash_event_hook()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_cash_event_hook'and tgrelid='public.financial_events'::regclass)then create trigger investment_cash_event_hook after update of status on public.financial_events for each row execute function private.investment_cash_event_hook();end if;end $$;

create or replace function private.investment_asset_guard()returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare c public.investment_contracts%rowtype;
begin
 if tg_op='DELETE'then
  if old.metadata ? 'investment_id'then raise exception 'INVESTMENT_LINKED_ASSET_IMMUTABLE';end if;return old;
 end if;
 if new.asset_type_code in('DEPOSIT','BOND','SUKUK_BOND')then
  if current_user not in('postgres','supabase_admin')then raise exception 'USE_INVESTMENTS_MODULE';end if;
  select * into c from public.investment_contracts where id=nullif(new.metadata->>'investment_id','')::uuid;
  if c.id is null or c.user_id<>new.user_id or c.organization_id is distinct from new.organization_id or(c.asset_account_id is not null and c.asset_account_id<>new.id)then raise exception 'USE_INVESTMENTS_MODULE';end if;
  if new.metadata->>'investment_status'<>c.status or new.name<>c.terms->>'name' or new.currency<>c.terms->>'currency' or(new.metadata->>'archived'='true'and c.status<>'CANCELLED')then raise exception 'INVESTMENT_LINKED_ASSET_IMMUTABLE';end if;
 end if;
 if tg_op='UPDATE'and old.metadata ? 'investment_id'and(new.metadata->>'investment_id'is distinct from old.metadata->>'investment_id'or new.asset_type_code is distinct from old.asset_type_code)then raise exception 'INVESTMENT_LINKED_ASSET_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function private.investment_asset_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_asset_guard'and tgrelid='public.asset_accounts'::regclass)then create trigger investment_asset_guard before insert or update or delete on public.asset_accounts for each row execute function private.investment_asset_guard();end if;end $$;
create or replace function private.investment_transaction_guard()returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare mid text;oid uuid;
begin
 select metadata->>'investment_id'into mid from public.asset_accounts where id=case when tg_op='DELETE'then old.asset_account_id else new.asset_account_id end;
 if tg_op in('UPDATE','DELETE')and old.metadata->>'source'='INVESTMENTS'then
  if tg_op='UPDATE'and current_user in('postgres','supabase_admin')and(to_jsonb(new)-'quantity')=(to_jsonb(old)-'quantity')and exists(select 1 from public.investment_operations o where o.id=(old.metadata->>'investment_operation_id')::uuid and o.status='APPROVED'and o.kind='FUND')then return new;end if;raise exception 'INVESTMENT_POSTED_OPERATION_IMMUTABLE';end if;
 if tg_op='INSERT'and mid is not null then
  if current_user not in('postgres','supabase_admin')then raise exception 'USE_INVESTMENTS_MODULE';end if;
  oid:=nullif(new.metadata->>'investment_operation_id','')::uuid;
  if not exists(select 1 from public.investment_operations o where o.id=oid and o.contract_id=mid::uuid and o.status='APPROVED')then raise exception 'USE_INVESTMENTS_MODULE';end if;
 end if;return case when tg_op='DELETE'then old else new end;
end $$;
revoke all on function private.investment_transaction_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_transaction_guard'and tgrelid='public.transactions'::regclass)then create trigger investment_transaction_guard before insert or update or delete on public.transactions for each row execute function private.investment_transaction_guard();end if;end $$;

create or replace function private.investment_refresh_forecasts(p_contract_id uuid)returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c public.investment_contracts%rowtype;t jsonb;k text;v_amount numeric;fx numeric;
begin
 select * into c from public.investment_contracts where id=p_contract_id;
 if c.organization_id is null or c.status not in('ACTIVE','CLOSED')then return;end if;
 if auth.uid()is null or not public.has_organization_permission(c.organization_id,'assets.edit')then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;fx:=(t->>'fx_rate')::numeric;
 foreach k in array array['INCOME','REDEEM']loop
  if(k='REDEEM'and c.status='CLOSED')or exists(select 1 from public.investment_operations o where o.contract_id=c.id and o.kind=k and o.status<>'CANCELLED')then continue;end if;
  v_amount:=case when k='REDEEM'then(t->>'face_value')::numeric else(case when t->>'instrument'='DEPOSIT'then(t->>'principal')::numeric else(t->>'face_value')::numeric end)*(t->>'annual_rate')::numeric/100*((t->>'maturity_date')::date-(t->>'start_date')::date)/case when t->>'interest_basis'='ACT_360'then 360 else 365 end end;
  if v_amount<=0 or exists(select 1 from public.liquidity_flows f where f.organization_id=c.organization_id and f.source_module='INVESTMENTS'and f.source_event_key='investment:'||c.id||':forecast:'||k)then continue;end if;
  insert into public.liquidity_flows(organization_id,entity_id,direction,flow_type,title,counterparty,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
  values(c.organization_id,nullif(t->>'entity_id','')::uuid,'INFLOW','INVESTMENT',k||' / '||(t->>'name'),t->>'party_name',(t->>'maturity_date')::date,v_amount,t->>'currency',v_amount*fx,'EXPECTED','MANUAL',t->>'reference','INVESTMENTS',c.id,'investment:'||c.id||':forecast:'||k);
 end loop;
end $$;
revoke all on function private.investment_refresh_forecasts(uuid)from public,anon,authenticated;

create or replace function private.investment_lot_guard()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.asset_accounts a where a.id in(case when tg_op<>'INSERT'then old.asset_account_id end,case when tg_op<>'DELETE'then new.asset_account_id end)and a.metadata ? 'investment_id')and current_user not in('postgres','supabase_admin')then raise exception 'USE_INVESTMENTS_MODULE';end if;
 return case when tg_op='DELETE'then old else new end;
end $$;
revoke all on function private.investment_lot_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_lot_guard'and tgrelid='public.lots'::regclass)then create trigger investment_lot_guard before insert or update or delete on public.lots for each row execute function private.investment_lot_guard();end if;end $$;

-- Capital movement must finalize cash and the asset ledger in the same transaction.
-- Income recognition may remain ACTUAL before collection, with its explicit receivable outstanding.
create or replace function private.investment_atomic_finalization_guard()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.investment_operations%rowtype;
begin
 if new.source_module='INVESTMENTS'and new.status='ACTUAL'then
  select * into o from public.investment_operations where recognition_event_id=new.id;
  if o.id is null and new.event_type<>'SETTLEMENT'then raise exception 'INVESTMENT_OPERATION_SOURCE_REQUIRED';end if;
  if o.id is not null and o.kind in('FUND','REDEEM')and o.status<>'POSTED'then raise exception 'INVESTMENT_CAPITAL_REQUIRES_ATOMIC_CASH_PATH';end if;
 end if;return new;
end $$;
revoke all on function private.investment_atomic_finalization_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_atomic_finalization_guard'and tgrelid='public.financial_events'::regclass)then create constraint trigger investment_atomic_finalization_guard after update on public.financial_events deferrable initially deferred for each row execute function private.investment_atomic_finalization_guard();end if;end $$;

create or replace function private.investment_flow_source_guard()returns trigger language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
 if current_user not in('postgres','supabase_admin')and((tg_op<>'INSERT'and old.source_module='INVESTMENTS')or(tg_op<>'DELETE'and new.source_module='INVESTMENTS'))then raise exception 'INVESTMENT_FLOW_MANAGE_FROM_SOURCE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.investment_flow_source_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_flow_source_guard'and tgrelid='public.liquidity_flows'::regclass)then create trigger investment_flow_source_guard before insert or update or delete on public.liquidity_flows for each row execute function private.investment_flow_source_guard();end if;end $$;
create or replace function private.investment_settlement_source_guard()returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if exists(select 1 from public.financial_event_obligations ob join public.investment_operations o on o.recognition_event_id=ob.event_id where ob.id=new.obligation_id and o.settlement_event_id<>new.application_event_id)then raise exception 'INVESTMENT_SETTLE_FROM_SOURCE';end if;
 return new;
end $$;
revoke all on function private.investment_settlement_source_guard()from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='investment_settlement_source_guard'and tgrelid='public.financial_event_obligation_allocations'::regclass)then create trigger investment_settlement_source_guard before insert or update on public.financial_event_obligation_allocations for each row execute function private.investment_settlement_source_guard();end if;end $$;
