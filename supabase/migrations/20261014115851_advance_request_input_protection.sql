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

