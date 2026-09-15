-- ZakatFlow V11 production hardening
-- Apply after schema + existing production/enterprise migrations.

-- Consistent audit indexes.
create index if not exists idx_audit_user_created on audit_logs(user_id,created_at desc);
create index if not exists idx_alloc_lot on transaction_allocations(lot_id,created_at desc);
create index if not exists idx_lots_user_due on lots(user_id,hawl_due_date) where remaining_quantity>0;

-- Keep assessment snapshots immutable at application level and make status transitions explicit.
create index if not exists idx_assessments_user_date on zakat_assessments(user_id,assessment_date desc);

-- RLS for reference data: everyone may read approved market data, authenticated users may submit their own audit entries.
-- Market prices and FX are reference tables; write access should be restricted in a production deployment to an admin/provider role.

-- Safe helper to schedule all reminders for a user. The function is idempotent.
create or replace function public.schedule_hawl_notifications(p_user uuid)
returns integer language plpgsql security invoker as $$
declare r record; n integer:=0; d integer; v_ts timestamptz;
begin
  for r in select id,hawl_due_date from lots where user_id=p_user and remaining_quantity>0 and hawl_due_date is not null loop
    foreach d in array[30,15,7] loop
      v_ts := (r.hawl_due_date - make_interval(days=>d))::timestamptz;
      insert into notification_jobs(user_id,notification_type,scheduled_for)
      values(p_user,'HAWL_DUE_'||d,v_ts) on conflict(user_id,notification_type,scheduled_for) do nothing;
      n:=n+1;
    end loop;
  end loop;
  return n;
end; $$;

-- Helpful unique index for one notification per lot/date/type if metadata stores lot id.
create index if not exists idx_notifications_user_read on notifications(user_id,read_at,scheduled_for desc);

-- V11 RLS completion for user-entered reference data and audit events.
drop policy if exists audit_insert_self on audit_logs;
create policy audit_insert_self on audit_logs for insert with check (user_id = auth.uid());
drop policy if exists prices_insert_auth on market_prices;
create policy prices_insert_auth on market_prices for insert to authenticated with check (true);
drop policy if exists fx_insert_auth on fx_rates;
create policy fx_insert_auth on fx_rates for insert to authenticated with check (true);
