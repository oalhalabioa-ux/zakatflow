create or replace function private.guard_participation_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.source_module='PARTICIPATION'then
  if tg_op='DELETE'and current_user='postgres'and not exists(select 1 from public.liquidity_flow_settlement_allocations where flow_id=old.id)and exists(select 1 from public.participation_movements m where old.source_event_key='participation-receipt:'||m.id and m.execution_state='CANCELLED')then return old;end if;
  if tg_op='DELETE'or row(new.organization_id,new.amount,new.currency,new.base_amount,new.direction,new.due_date,new.source_module,new.source_event_key,new.source_record_id)is distinct from row(old.organization_id,old.amount,old.currency,old.base_amount,old.direction,old.due_date,old.source_module,old.source_event_key,old.source_record_id)then raise exception 'PARTICIPATION_FLOW_MANAGE_FROM_CONTRACT';end if;
  if(new.status='ACTUAL'and old.status<>'ACTUAL'or new.settled_amount is distinct from old.settled_amount)and not exists(select 1 from public.participation_movements m where m.flow_id=old.id and m.execution_state='POSTING')then raise exception 'PARTICIPATION_USE_ATOMIC_POST';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;
end $$;
