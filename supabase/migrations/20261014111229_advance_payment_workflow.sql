-- The public entry point preserves caller identity. The private atomic writer is
-- privileged only because balance/settlement columns are intentionally not client writable.
create or replace function private.post_advance_request_atomic(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
 e public.financial_events%rowtype;l public.financial_event_lines%rowtype;
 a public.financial_event_obligations%rowtype;o public.financial_event_obligations%rowtype;
 ae public.financial_events%rowtype;oe public.financial_events%rowtype;
 bank public.liquidity_accounts%rowtype;f public.liquidity_flows%rowtype;
 m jsonb;kind text;ctype text;sid uuid;fid uuid;remaining numeric;original_sid uuid;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 select * into e from public.financial_events where id=p_event_id;
 if e.id is null or e.source_module<>'ADVANCE_WORKSPACE' then raise exception 'ADVANCE_REQUEST_REQUIRED';end if;
 if not public.financial_core_can(e.organization_id,'financial_core.view') or not public.financial_core_can(e.organization_id,'financial_core.post') or not public.effective_organization_permission(e.organization_id,'liquidity.edit',null,null) then raise exception 'ADVANCE_POST_DENIED';end if;
 -- Shared with the existing cash writer/reversals; serialize changes within an organization.
 perform pg_advisory_xact_lock(hashtextextended(e.organization_id::text||'|PHASE2B_CASH_WRITE',0));
 select * into e from public.financial_events where id=p_event_id for update;
 if e.status='ACTUAL' and exists(select 1 from public.financial_event_command_registry where financial_event_id=e.id and command_type in('ADVANCE_CASH','ADVANCE_APPLICATION')) then return jsonb_build_object('eventId',e.id,'status','ACTUAL','idempotent_replay',true);end if;
 if e.status<>'COMMITTED' or not public.financial_event_has_valid_approval(e.id) then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if (select count(*) from public.financial_event_lines where event_id=e.id)<>1 then raise exception 'ADVANCE_LINE_INVALID';end if;
 select * into l from public.financial_event_lines where event_id=e.id and organization_id=e.organization_id;
 select classification_type into ctype from public.financial_classifications where id=l.classification_id and organization_id=e.organization_id and active;
 if ctype is null then raise exception 'ADVANCE_CLASSIFICATION_REQUIRED';end if;
 if l.amount is null or l.amount<=0 or l.amount::text in('NaN','Infinity','-Infinity') or l.exchange_rate is null or l.exchange_rate<=0 or l.exchange_rate::text in('NaN','Infinity','-Infinity') or l.base_amount is null or l.base_amount<=0 or l.base_amount::text in('NaN','Infinity','-Infinity') or round(l.amount*l.exchange_rate,4)<>l.base_amount or l.vat_amount<>0 or l.vat_rate<>0 or l.vat_treatment<>'OUT_OF_SCOPE' then raise exception 'ADVANCE_AMOUNT_INVALID';end if;
 if not public.effective_organization_permission(e.organization_id,'liquidity.settle',l.base_amount,e.base_currency) then raise exception 'ADVANCE_POST_DENIED';end if;
 if e.event_date>(now() at time zone 'Asia/Riyadh')::date or e.counterparty_id is null or not exists(select 1 from public.liquidity_counterparties where id=e.counterparty_id and organization_id=e.organization_id and active) then raise exception 'ADVANCE_PARTY_OR_DATE_INVALID';end if;
 if e.entity_id is not null and not exists(select 1 from public.organization_entities where id=e.entity_id and organization_id=e.organization_id and active) then raise exception 'ADVANCE_ENTITY_MISMATCH';end if;
 if e.base_currency<>(select base_currency from public.organizations where id=e.organization_id) or(l.currency=e.base_currency and l.exchange_rate<>1) then raise exception 'ADVANCE_CURRENCY_INVALID';end if;
 if(select count(*) from public.financial_event_links where event_id=e.id and link_type='OTHER' and metadata->>'purpose'='ADVANCE_REQUEST')<>1 then raise exception 'ADVANCE_INSTRUCTION_INVALID';end if;
 select metadata into m from public.financial_event_links where event_id=e.id and organization_id=e.organization_id and link_type='OTHER' and metadata->>'purpose'='ADVANCE_REQUEST';kind:=m->>'kind';
 if kind='RECORD' then
  if e.event_type<>'SETTLEMENT' or(select count(*) from public.financial_event_obligations where event_id=e.id)<>1 then raise exception 'ADVANCE_OBLIGATION_INVALID';end if;
  select * into a from public.financial_event_obligations where event_id=e.id and organization_id=e.organization_id for update;
  if a.adjusts_obligation_id is not null or a.obligation_type not in('SUPPLIER_ADVANCE','CUSTOMER_ADVANCE') or a.currency<>l.currency or a.base_currency<>e.base_currency or a.exchange_rate<>l.exchange_rate or a.settleable_amount<>l.amount or a.settleable_base_amount<>l.base_amount then raise exception 'ADVANCE_OBLIGATION_INVALID';end if;
  if(a.obligation_type='SUPPLIER_ADVANCE' and (l.cash_direction<>'OUTFLOW' or ctype<>'ASSET'))or(a.obligation_type='CUSTOMER_ADVANCE' and(l.cash_direction<>'INFLOW' or ctype<>'LIABILITY')) then raise exception 'ADVANCE_SIDE_INVALID';end if;
  select * into bank from public.liquidity_accounts where id=(m->>'account_id')::uuid and organization_id=e.organization_id and active for update;
  if bank.id is null or bank.currency<>l.currency or(bank.entity_id is not null and bank.entity_id is distinct from e.entity_id) then raise exception 'ADVANCE_ACCOUNT_MISMATCH';end if;
  if l.cash_direction='OUTFLOW' and bank.current_balance-coalesce(bank.restricted_balance,0)-coalesce(bank.uncleared_balance,0)<l.amount then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
  insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,payload_fingerprint,created_by,posted_by)
  values(e.organization_id,e.entity_id,bank.id,l.cash_direction,e.event_date,l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount,e.source_module,e.source_event_key,e.id,encode(extensions.digest(e.id::text||m::text,'sha256'),'hex'),auth.uid(),auth.uid()) returning id into sid;
  insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key,settled_amount,settlement_status)
  values(e.organization_id,e.entity_id,bank.id,l.cash_direction,'OPERATING',e.description,e.counterparty_id,e.event_date,l.amount,l.currency,l.base_amount,'ACTUAL','MANUAL',coalesce(m->>'reference',''),e.source_module,e.id,e.source_event_key,l.amount,'SETTLED') returning id into fid;
  insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount) values(e.organization_id,sid,fid,e.id,'PAYMENT',l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount);
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id) values(e.organization_id,e.id,'CASH_FLOW','liquidity_flows',fid),(e.organization_id,e.id,'CASH_SETTLEMENT','liquidity_settlements',sid);
  update public.liquidity_accounts set current_balance=current_balance+case when l.cash_direction='INFLOW' then l.amount else -l.amount end,current_balance_base=current_balance_base+case when l.cash_direction='INFLOW' then l.base_amount else -l.base_amount end,updated_at=now() where id=bank.id;
  insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason) values(e.organization_id,sid,null,'POSTED',auth.uid(),'Advance cash executed');
 elsif kind='APPLY' then
  if e.event_type<>'ADJUSTMENT' or l.cash_direction<>'NON_CASH' or exists(select 1 from public.financial_event_obligations where event_id=e.id) then raise exception 'ADVANCE_APPLICATION_INVALID';end if;
  -- Stable lock order shared with ordinary payments. Recheck every balance under lock.
  perform id from public.financial_event_obligations where id in((m->>'advance_id')::uuid,(m->>'obligation_id')::uuid) order by id for update;
  select * into a from public.financial_event_obligations where id=(m->>'advance_id')::uuid and organization_id=e.organization_id;
  select * into o from public.financial_event_obligations where id=(m->>'obligation_id')::uuid and organization_id=e.organization_id;
  if a.id is null or o.id is null or a.adjusts_obligation_id is not null or o.adjusts_obligation_id is not null or not((a.obligation_type='SUPPLIER_ADVANCE' and o.obligation_type='PAYABLE')or(a.obligation_type='CUSTOMER_ADVANCE' and o.obligation_type='RECEIVABLE')) or ctype<>o.obligation_type then raise exception 'ADVANCE_SIDE_INVALID';end if;
  select * into ae from public.financial_events where id=a.event_id;select * into oe from public.financial_events where id=o.event_id;
  if ae.status<>'ACTUAL' or oe.status<>'ACTUAL' or ae.counterparty_id is distinct from e.counterparty_id or oe.counterparty_id is distinct from e.counterparty_id or ae.entity_id is distinct from e.entity_id or oe.entity_id is distinct from e.entity_id or oe.source_module='INVESTMENTS' or e.event_date<greatest(ae.event_date,oe.event_date) then raise exception 'ADVANCE_PARTY_OR_SOURCE_MISMATCH';end if;
  if a.currency<>o.currency or a.currency<>l.currency or a.base_currency<>o.base_currency or a.base_currency<>e.base_currency or a.exchange_rate<>o.exchange_rate or a.exchange_rate<>l.exchange_rate then raise exception 'ADVANCE_CURRENCY_OR_SIDE_MISMATCH';end if;
  if l.base_amount>(select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=a.id) or l.base_amount>(select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=o.id) then raise exception 'ADVANCE_EXCEEDS_BALANCE';end if;
  select * into f from public.liquidity_flows where id=(m->>'flow_id')::uuid and organization_id=e.organization_id for update;
  if f.id is null or f.source_module='INVESTMENTS' or f.currency<>l.currency or f.direction<>(case when o.obligation_type='PAYABLE' then 'OUTFLOW' else 'INFLOW' end) or not exists(select 1 from public.financial_event_links where event_id=o.event_id and organization_id=e.organization_id and link_type='CASH_FLOW' and target_module='liquidity_flows' and target_record_id=f.id) or l.amount>f.amount-f.settled_amount or round(l.amount*(f.base_amount/f.amount),4)<>l.base_amount then raise exception 'ADVANCE_FLOW_MISMATCH';end if;
  select id into original_sid from public.liquidity_settlements where financial_event_id=a.event_id and organization_id=e.organization_id and status='POSTED';
  if original_sid is null then raise exception 'ADVANCE_POSTED_CASH_REQUIRED';end if;
  insert into public.financial_event_obligation_allocations(organization_id,application_event_id,obligation_id,source_advance_obligation_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount)
  values(e.organization_id,e.id,o.id,a.id,'ADVANCE_APPLICATION',l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount);
  insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount) values(e.organization_id,original_sid,f.id,e.id,'ADVANCE_APPLICATION',l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount);
  update public.liquidity_flows set settled_amount=settled_amount+l.amount,settlement_status=case when settled_amount+l.amount>=amount then 'SETTLED' else 'PARTIAL' end,updated_at=now() where id=f.id;
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id) values(e.organization_id,e.id,'CASH_FLOW','liquidity_flows',f.id);
 else raise exception 'ADVANCE_INSTRUCTION_INVALID';end if;
 insert into public.financial_event_command_registry(organization_id,command_type,source_module,source_event_key,payload_fingerprint,financial_event_id,canonical_payload,created_by)
 values(e.organization_id,case when kind='RECORD' then 'ADVANCE_CASH' else 'ADVANCE_APPLICATION' end,e.source_module,e.source_event_key,encode(extensions.digest(e.id::text||m::text,'sha256'),'hex'),e.id,m,auth.uid());
 perform public.transition_financial_event(e.id,'ACTUAL','Approved advance request executed');
 return jsonb_build_object('eventId',e.id,'status','ACTUAL','cash_movement_created',kind='RECORD','idempotent_replay',false);
end $$;
revoke all on function private.post_advance_request_atomic(uuid) from public,anon;
grant execute on function private.post_advance_request_atomic(uuid) to authenticated;
create or replace function public.post_advance_request(p_event_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_advance_request_atomic(p_event_id);$$;
revoke all on function public.post_advance_request(uuid) from public,anon;
grant execute on function public.post_advance_request(uuid) to authenticated;

create or replace function private.guard_advance_workflow()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if old.source_module='ADVANCE_WORKSPACE' and old.status='COMMITTED' and (to_jsonb(new)-array['status','updated_at','posted_by','posted_at','settlement_date']) is distinct from (to_jsonb(old)-array['status','updated_at','posted_by','posted_at','settlement_date']) then raise exception 'ADVANCE_COMMITTED_REQUEST_IMMUTABLE';end if;
 if old.source_module='ADVANCE_WORKSPACE' and old.status in('ACTUAL','REVERSED') and new is distinct from old then raise exception 'ADVANCE_POSTED_EVENT_IMMUTABLE';end if;
 if new.source_module='ADVANCE_WORKSPACE' and new.status='ACTUAL' and old.status<>'ACTUAL' and not exists(select 1 from public.financial_event_command_registry where financial_event_id=new.id and command_type in('ADVANCE_CASH','ADVANCE_APPLICATION')) then raise exception 'ADVANCE_USE_ATOMIC_POST';end if;
 -- Prevent erasing an invoice/advance while an active allocation depends on it.
 if old.status='ACTUAL' and new.status='REVERSED' and exists(select 1 from public.financial_event_obligations o join public.financial_event_obligation_allocations a on a.obligation_id=o.id or a.source_advance_obligation_id=o.id join public.financial_events app on app.id=a.application_event_id and app.status='ACTUAL' where o.event_id=old.id and a.allocation_type='ADVANCE_APPLICATION') then raise exception 'ADVANCE_HAS_ACTIVE_APPLICATIONS';end if;
 return new;
end $$;
revoke all on function private.guard_advance_workflow() from public,anon,authenticated;
drop trigger if exists guard_advance_workflow on public.financial_events;
create trigger guard_advance_workflow before update on public.financial_events for each row execute function private.guard_advance_workflow();

create or replace function private.ensure_advance_classifications(p_org uuid)returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.create') or not public.effective_organization_permission(p_org,'liquidity.edit',null,null) then raise exception 'ADVANCE_ACTION_DENIED';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
 select p_org,v.code,v.name,v.kind,true,auth.uid() from(values('ADVANCE_SUPPLIER_ASSET','دفعات مقدمة للموردين','ASSET'),('ADVANCE_CUSTOMER_LIABILITY','دفعات العملاء المقدمة','LIABILITY'),('ADVANCE_PAYABLE_CLEARING','تسوية دفعات الموردين','PAYABLE'),('ADVANCE_RECEIVABLE_CLEARING','تسوية دفعات العملاء','RECEIVABLE'))v(code,name,kind)
 on conflict(organization_id,code)do nothing;
end $$;
revoke all on function private.ensure_advance_classifications(uuid) from public,anon;
grant execute on function private.ensure_advance_classifications(uuid) to authenticated;
create or replace function public.ensure_advance_classifications(p_org uuid)returns void language sql security invoker set search_path=pg_catalog,public,private as $$select private.ensure_advance_classifications(p_org);$$;
revoke all on function public.ensure_advance_classifications(uuid) from public,anon;
grant execute on function public.ensure_advance_classifications(uuid) to authenticated;

create or replace function private.guard_advance_request_inputs()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare eid uuid;e public.financial_events%rowtype;
begin
 eid:=case when tg_op='DELETE' then old.event_id else new.event_id end;
 select * into e from public.financial_events where id=eid;
 if e.source_module='ADVANCE_WORKSPACE' and e.status not in('DRAFT','PLANNED') then
  if tg_table_name='financial_event_links' and tg_op='INSERT' and current_user='postgres' then
   if new.link_type in('CASH_FLOW','CASH_SETTLEMENT') then return new;end if;
  end if;
  raise exception 'ADVANCE_COMMITTED_REQUEST_IMMUTABLE';
 end if;
 if tg_op='UPDATE' and old.event_id is distinct from new.event_id and exists(select 1 from public.financial_events where id=old.event_id and source_module='ADVANCE_WORKSPACE' and status not in('DRAFT','PLANNED')) then raise exception 'ADVANCE_COMMITTED_REQUEST_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_advance_request_inputs() from public,anon,authenticated;
create trigger guard_advance_lines before insert or update or delete on public.financial_event_lines for each row execute function private.guard_advance_request_inputs();
create trigger guard_advance_obligations before insert or update or delete on public.financial_event_obligations for each row execute function private.guard_advance_request_inputs();
create trigger guard_advance_links before insert or update or delete on public.financial_event_links for each row execute function private.guard_advance_request_inputs();

create or replace function private.guard_advance_ledger()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb;eid uuid;protected boolean;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 eid:=coalesce((r->>'application_event_id')::uuid,(r->>'financial_event_id')::uuid);
 protected:=(r->>'source_module'='ADVANCE_WORKSPACE')or exists(select 1 from public.financial_events where id=eid and source_module='ADVANCE_WORKSPACE');
 if tg_table_name='financial_event_obligation_allocations' then protected:=protected or exists(select 1 from public.financial_event_obligations where id=(r->>'source_advance_obligation_id')::uuid and obligation_type in('SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'));end if;
 if tg_op='UPDATE' then
  r:=to_jsonb(old);eid:=coalesce((r->>'application_event_id')::uuid,(r->>'financial_event_id')::uuid);
  protected:=protected or(r->>'source_module'='ADVANCE_WORKSPACE')or exists(select 1 from public.financial_events where id=eid and source_module='ADVANCE_WORKSPACE');
  if tg_table_name='financial_event_obligation_allocations' then protected:=protected or exists(select 1 from public.financial_event_obligations where id=(r->>'source_advance_obligation_id')::uuid and obligation_type in('SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'));end if;
 end if;
 if protected and current_user<>'postgres' then raise exception 'ADVANCE_USE_ATOMIC_POST';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_advance_ledger() from public,anon,authenticated;
create trigger guard_advance_registry before insert or update or delete on public.financial_event_command_registry for each row execute function private.guard_advance_ledger();
create trigger guard_advance_allocations before insert or update or delete on public.financial_event_obligation_allocations for each row execute function private.guard_advance_ledger();
create trigger guard_advance_cash before insert or update or delete on public.liquidity_settlements for each row execute function private.guard_advance_ledger();
create trigger guard_advance_flows before update or delete on public.liquidity_flows for each row execute function private.guard_advance_ledger();
