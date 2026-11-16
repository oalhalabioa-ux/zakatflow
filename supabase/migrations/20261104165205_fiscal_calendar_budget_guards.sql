-- Extend the existing fiscal engine's safety boundary to linked budget dates.
-- No calendar, budget, period, journal or customer row is created or rewritten.
create function private.financial_guard_budget_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.financial_fiscal_calendars%rowtype;expected date;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal-calendar:'||new.organization_id,0));
 if tg_table_name='financial_fiscal_calendars' then
  select * into c from public.financial_fiscal_calendars where organization_id=new.organization_id;
  if c.organization_id is not null and (new.start_month,new.start_day,new.retained_earnings_account) is distinct from (c.start_month,c.start_day,c.retained_earnings_account)
   and exists(select 1 from public.financial_budget_plan_ownership where organization_id=new.organization_id) then
   raise exception 'FISCAL_CALENDAR_IN_USE';
  end if;
  if exists(select 1 from public.financial_budget_plan_ownership b where b.organization_id=new.organization_id
   and b.fiscal_start<>make_date(extract(year from b.fiscal_start)::integer,new.start_month,1)
     +least(new.start_day,extract(day from (make_date(extract(year from b.fiscal_start)::integer,new.start_month,1)+interval '1 month'-interval '1 day'))::integer)-1) then
   raise exception 'FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED';
  end if;
 else
  if tg_op='UPDATE' and (new.organization_id,new.fiscal_start,new.entity_id,new.cost_center_id) is distinct from (old.organization_id,old.fiscal_start,old.entity_id,old.cost_center_id) then
   if exists(select 1 from public.budget_plans where id=old.plan_id and status='APPROVED')
    or exists(select 1 from public.financial_year_closures where organization_id=old.organization_id and status='CLOSED' and old.fiscal_start between fiscal_start and fiscal_end) then
    raise exception 'FISCAL_PERIOD_CLOSED';
   end if;
  end if;
  select * into c from public.financial_fiscal_calendars where organization_id=new.organization_id;
  if c.organization_id is null then return new;end if; -- Preserve legacy unconfigured budgets.
  expected:=(private.financial_fiscal_period(new.organization_id,new.fiscal_start)->>'start')::date;
  if expected<>new.fiscal_start then raise exception 'FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED';end if;
  if exists(select 1 from public.financial_year_closures where organization_id=new.organization_id and status='CLOSED' and new.fiscal_start between fiscal_start and fiscal_end) then
   raise exception 'FISCAL_PERIOD_CLOSED';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.financial_guard_budget_calendar() from public,anon,authenticated;
create trigger fiscal_calendar_budget_guard before insert or update on public.financial_fiscal_calendars for each row execute function private.financial_guard_budget_calendar();
create trigger budget_fiscal_calendar_guard before insert or update on public.financial_budget_plan_ownership for each row execute function private.financial_guard_budget_calendar();
