create function private.post_participation_movement(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare m public.participation_movements%rowtype;c public.participation_contracts%rowtype;e public.financial_events%rowtype;cash public.financial_events%rowtype;ob uuid;flow uuid;r jsonb;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.post')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));
 select * into m from public.participation_movements where id=p_id for update;select * into c from public.participation_contracts where id=m.contract_id;
 if m.execution_state='POSTED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if c.state in('CANCELLED','CLOSED')or m.execution_state<>'PREPARED'then raise exception 'PARTICIPATION_MOVEMENT_STATE_INVALID';end if;
 select * into e from public.financial_events where id=m.recognition_event_id for update;
 if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if m.cash_event_id is not null then select * into cash from public.financial_events where id=m.cash_event_id for update;if cash.status<>'COMMITTED'or not public.financial_event_has_valid_approval(cash.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;end if;
 if exists(select 1 from public.participation_movements a join public.financial_events ae on ae.id=a.recognition_event_id where a.contract_id=c.id and ae.status='ACTUAL'and a.event_date>m.event_date)then raise exception 'PARTICIPATION_MOVEMENT_CHRONOLOGY';end if;
 update public.participation_movements set execution_state='POSTING'where id=m.id;
 perform public.transition_financial_event(e.id,'ACTUAL','Approved participation recognition');
 if m.kind='CAPITAL_RECEIPT'then
  r:=public.post_financial_nonallocating_cash(m.cash_event_id,m.recognition_event_id,m.flow_id,m.account_id,'INFLOW',m.event_date,m.amount,c.currency,c.exchange_rate,round(m.amount*c.exchange_rate,4),c.capital_treatment);
 elsif m.kind in('CAPITAL_RETURN','PROFIT')then
  select id into ob from public.financial_event_obligations where event_id=m.recognition_event_id and adjusts_obligation_id is null;
  flow:=private.ensure_debt_flow(ob);
  update public.participation_movements set flow_id=flow where id=m.id;
 end if;
 update public.participation_movements set execution_state='POSTED'where id=m.id;update public.participation_contracts set state='ACTIVE'where id=c.id and state='DRAFT';return jsonb_build_object('id',m.id,'status','POSTED');
end $$;
revoke all on function private.post_participation_movement(uuid)from public,anon;grant execute on function private.post_participation_movement(uuid)to authenticated;
create function public.post_participation_movement(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_participation_movement(p_id);$$;
revoke all on function public.post_participation_movement(uuid)from public,anon;grant execute on function public.post_participation_movement(uuid)to authenticated;

create function private.guard_participation_event()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.source_module='PARTICIPATION'then
  if new.status='ACTUAL'and old.status<>'ACTUAL'and not exists(select 1 from public.participation_movements m where(new.id=m.recognition_event_id or new.id=m.cash_event_id)and m.execution_state='POSTING')then raise exception 'PARTICIPATION_USE_ATOMIC_POST';end if;
  if new.status='REVERSED'and old.status<>'REVERSED'then raise exception 'PARTICIPATION_REQUIRES_SOURCE_CORRECTION';end if;
 end if;return new;
end $$;
revoke all on function private.guard_participation_event()from public,anon,authenticated;
create trigger participation_event_guard before update on public.financial_events for each row execute function private.guard_participation_event();
create function private.guard_participation_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.source_module='PARTICIPATION'then
  if tg_op='DELETE'or row(new.organization_id,new.amount,new.currency,new.base_amount,new.direction,new.due_date,new.source_module,new.source_event_key,new.source_record_id)is distinct from row(old.organization_id,old.amount,old.currency,old.base_amount,old.direction,old.due_date,old.source_module,old.source_event_key,old.source_record_id)then raise exception 'PARTICIPATION_FLOW_MANAGE_FROM_CONTRACT';end if;
  if(new.status='ACTUAL'and old.status<>'ACTUAL'or new.settled_amount is distinct from old.settled_amount)and not exists(select 1 from public.participation_movements m where m.flow_id=old.id and m.execution_state='POSTING')then raise exception 'PARTICIPATION_USE_ATOMIC_POST';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_participation_flow()from public,anon,authenticated;
create trigger participation_flow_guard before update or delete on public.liquidity_flows for each row execute function private.guard_participation_flow();

create function private.cancel_participation_movement(p_id uuid,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.participation_movements%rowtype;status text;flow uuid;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.create')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));select * into m from public.participation_movements where id=p_id for update;
 if m.execution_state='CANCELLED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if m.execution_state<>'PREPARED'or exists(select 1 from public.financial_events where id in(m.recognition_event_id,m.cash_event_id)and status in('ACTUAL','REVERSED'))then raise exception 'POSTED_PARTICIPATION_REQUIRES_CORRECTION';end if;
 select e.status into status from public.financial_events e where e.id=m.recognition_event_id;
 if status<>'CANCELLED'then perform public.transition_financial_event(m.recognition_event_id,'CANCELLED',p_reason);end if;
 if m.cash_event_id is not null then select e.status into status from public.financial_events e where e.id=m.cash_event_id;if status<>'CANCELLED'then perform public.transition_financial_event(m.cash_event_id,'CANCELLED',p_reason);end if;end if;
 flow:=m.flow_id;update public.participation_movements set execution_state='CANCELLED',flow_id=null where id=m.id;
 if flow is not null then delete from public.financial_event_links where event_id in(m.recognition_event_id,m.cash_event_id)and target_module='liquidity_flows'and target_record_id=flow;delete from public.liquidity_flows where id=flow and settled_amount=0;end if;
 return jsonb_build_object('id',m.id,'status','CANCELLED');
end $$;
revoke all on function private.cancel_participation_movement(uuid,text)from public,anon;grant execute on function private.cancel_participation_movement(uuid,text)to authenticated;
create function public.cancel_participation_movement(p_id uuid,p_reason text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.cancel_participation_movement(p_id,p_reason);$$;
revoke all on function public.cancel_participation_movement(uuid,text)from public,anon;grant execute on function public.cancel_participation_movement(uuid,text)to authenticated;
create or replace function private.guard_participation_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.source_module='PARTICIPATION'then
  if tg_op='DELETE'and current_user='postgres'and not exists(select 1 from public.liquidity_flow_settlement_allocations where flow_id=old.id)and exists(select 1 from public.participation_movements m where old.source_event_key='participation-receipt:'||m.id and m.execution_state='CANCELLED')then return old;end if;
  if tg_op='DELETE'or row(new.organization_id,new.amount,new.currency,new.base_amount,new.direction,new.due_date,new.source_module,new.source_event_key,new.source_record_id)is distinct from row(old.organization_id,old.amount,old.currency,old.base_amount,old.direction,old.due_date,old.source_module,old.source_event_key,old.source_record_id)then raise exception 'PARTICIPATION_FLOW_MANAGE_FROM_CONTRACT';end if;
  if(new.status='ACTUAL'and old.status<>'ACTUAL'or new.settled_amount is distinct from old.settled_amount)and not exists(select 1 from public.participation_movements m where m.flow_id=old.id and m.execution_state='POSTING')then raise exception 'PARTICIPATION_USE_ATOMIC_POST';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;
end $$;
create function private.finish_participation_contract(p_id uuid,p_action text,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.participation_contracts%rowtype;net numeric;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.participation_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.post')or p_action is null or p_action not in('CLOSE','CANCEL')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|PARTICIPATION_CONTRACT|'||c.id,0));select * into c from public.participation_contracts where id=p_id for update;
 if c.state=(case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end)then return jsonb_build_object('id',c.id,'replay',true);end if;
 if c.state in('CANCELLED','CLOSED')then raise exception 'PARTICIPATION_CONTRACT_CLOSED';end if;
 if exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status in('DRAFT','PLANNED','COMMITTED'))then raise exception 'PARTICIPATION_PENDING_MOVEMENTS';end if;
 if p_action='CANCEL'and exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL')then raise exception 'PARTICIPATION_HAS_POSTED_MOVEMENTS';end if;
 if p_action='CLOSE'then
  select coalesce(sum(case when m.kind='CAPITAL_RECEIPT'then m.amount when m.kind in('CAPITAL_RETURN','LOSS')then -m.amount else 0 end),0)into net from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL';
  if net<>0 or exists(select 1 from public.participation_movements m join public.financial_event_obligation_balances b on b.event_id=m.recognition_event_id where m.contract_id=c.id and b.outstanding_base_amount>0)then raise exception 'PARTICIPATION_OPEN_CAPITAL_OR_DISTRIBUTIONS';end if;
 end if;
 update public.participation_contracts set state=case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end where id=c.id;
 insert into public.audit_logs(user_id,organization_id,entity_type,entity_id,action,new_data)values(auth.uid(),c.organization_id,'participation_contract',c.id,p_action,jsonb_build_object('reason',p_reason));return jsonb_build_object('id',c.id,'state',case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end);
end $$;
revoke all on function private.finish_participation_contract(uuid,text,text)from public,anon;grant execute on function private.finish_participation_contract(uuid,text,text)to authenticated;
create function public.finish_participation_contract(p_id uuid,p_action text,p_reason text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.finish_participation_contract(p_id,p_action,p_reason);$$;
revoke all on function public.finish_participation_contract(uuid,text,text)from public,anon;grant execute on function public.finish_participation_contract(uuid,text,text)to authenticated;
