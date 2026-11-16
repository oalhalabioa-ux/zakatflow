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
