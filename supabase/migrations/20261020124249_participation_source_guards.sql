set lock_timeout='5s';
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

