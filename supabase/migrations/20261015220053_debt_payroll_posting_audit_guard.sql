-- Allow only source-controlled posting to populate posted_by/posted_at.
create or replace function private.guard_debt_payroll()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare r jsonb;eid uuid;begin
 r:=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 if tg_table_name='financial_events'then
  if tg_op='UPDATE'and old.status='ACTUAL'and new.status='REVERSED'and exists(select 1 from public.financial_event_obligations o join public.financial_event_obligation_allocations a on a.obligation_id=o.id join public.financial_events app on app.id=a.application_event_id and app.status='ACTUAL'where o.event_id=old.id and a.allocation_type='PAYROLL_OFFSET')then raise exception 'PAYROLL_HAS_ACTIVE_OFFSET';end if;
  if tg_op='UPDATE'and(new.source_module='DEBT_PAYROLL'or old.source_module='DEBT_PAYROLL')and new.source_module is distinct from old.source_module then raise exception 'PAYROLL_USE_SOURCE';end if;
  if tg_op='UPDATE'and old.source_module='DEBT_PAYROLL'and(to_jsonb(new)-array['status','updated_at','posted_by','posted_at'])is distinct from(to_jsonb(old)-array['status','updated_at','posted_by','posted_at'])then raise exception 'PAYROLL_USE_SOURCE';end if;
  if tg_op='UPDATE'and old.source_module='DEBT_PAYROLL'and(new.posted_by is distinct from old.posted_by or new.posted_at is distinct from old.posted_at)and not(current_user='postgres'and old.status='COMMITTED'and new.status='ACTUAL'and new.posted_by=auth.uid()and exists(select 1 from public.debt_payroll_requests where financial_event_id=new.id and execution_state='EXECUTING'))then raise exception 'PAYROLL_USE_SOURCE';end if;
  if new.source_module<>'DEBT_PAYROLL'then return new;end if;
  if new.status='CANCELLED'and(tg_op='INSERT'or old.status<>'CANCELLED')and not(current_user='postgres'and exists(select 1 from public.debt_payroll_requests where financial_event_id=new.id and execution_state='EXECUTING'))then raise exception 'PAYROLL_USE_SOURCE';end if;
  if new.status='ACTUAL'and(tg_op='INSERT'or old.status<>'ACTUAL')and not(current_user='postgres'and exists(select 1 from public.debt_payroll_requests where financial_event_id=new.id and execution_state='EXECUTING'))then raise exception 'PAYROLL_USE_SOURCE';end if;
  if tg_op='UPDATE'and old.status in('ACTUAL','REVERSED')and new is distinct from old and not(current_user='postgres'and old.status='ACTUAL'and new.status='REVERSED'and exists(select 1 from public.debt_payroll_requests where target_id in(select id from public.debt_payroll_requests where financial_event_id=old.id)and execution_state='EXECUTING'and kind='REVERSE'))then raise exception 'PAYROLL_USE_SOURCE';end if;return new;
 end if;
 eid:=coalesce((r->>'application_event_id')::uuid,(r->>'event_id')::uuid);
 if tg_op='UPDATE'and current_user<>'postgres'and exists(select 1 from public.financial_events where id=coalesce((to_jsonb(old)->>'application_event_id')::uuid,(to_jsonb(old)->>'event_id')::uuid)and source_module='DEBT_PAYROLL')then raise exception 'PAYROLL_USE_SOURCE';end if;
 if current_user<>'postgres'and exists(select 1 from public.financial_events where id=eid and source_module='DEBT_PAYROLL')then raise exception 'PAYROLL_USE_SOURCE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_debt_payroll()from public,anon,authenticated;
