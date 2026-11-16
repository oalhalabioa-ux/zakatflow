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
create trigger guard_advance_workflow before update on public.financial_events for each row execute function private.guard_advance_workflow();

