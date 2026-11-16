-- Setup policies are not financial activity. No hosted/customer records are
-- changed by installing this migration; rebasing requires an authorized save.
create function private.financial_calendar_setup_lock(p_org uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
begin
 if exists(select 1 from public.financial_year_closures where organization_id=p_org) then return 'CLOSURE';end if;
 if exists(select 1 from public.financial_opening_workspaces where organization_id=p_org)
 or exists(select 1 from public.financial_opening_source_assignments where organization_id=p_org) then return 'OPENING_REVIEW';end if;
 if exists(select 1 from public.financial_budget_plan_ownership where organization_id=p_org) then return 'BUDGET_REVIEW';end if;
 if exists(select 1 from public.financial_events where organization_id=p_org and status in('ACTUAL','REVERSED'))
 or jsonb_array_length(private.financial_reporting_events(p_org,'0001-01-01','9999-12-31'))>0 then return 'ACTIVITY';end if;
 return null;
end $$;
revoke all on function private.financial_calendar_setup_lock(uuid) from public,anon,authenticated;

-- The original rows remain history. New dates require new, unapproved drafts,
-- including when the previous rules were approved before any operations.
create function private.financial_rebase_setup_policies(p_org uuid,p_month integer,p_day integer,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare old_rows jsonb;pol jsonb;chosen jsonb;start_date date;end_date date;new_id uuid;yr integer;
begin
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into old_rows from public.financial_reporting_policies p
 where organization_id=p_org and status in('DRAFT','APPROVED');
 if old_rows='[]'::jsonb then return;end if;
 for pol in select value from jsonb_array_elements(old_rows) loop
  update public.financial_reporting_policies set status='SUPERSEDED',version=version+1,updated_at=now(),updated_by=auth.uid()
  where id=(pol->>'id')::uuid;
  insert into public.financial_reporting_policy_audit(organization_id,policy_id,actor_id,action,version,detail)
  values(p_org,(pol->>'id')::uuid,auth.uid(),'CALENDAR_REBASE', (pol->>'version')::integer+1,
   jsonb_build_object('before',pol,'reason',p_reason,'startMonth',p_month,'startDay',p_day));
 end loop;
 for chosen in select distinct on(value->>'fiscal_start') value from jsonb_array_elements(old_rows)
  order by value->>'fiscal_start',case when value->>'status'='DRAFT' then 0 else 1 end loop
  yr:=extract(year from (chosen->>'fiscal_start')::date)::integer;
  start_date:=make_date(yr,p_month,1)+least(p_day,extract(day from (make_date(yr,p_month,1)+interval '1 month - 1 day'))::integer)-1;
  end_date:=make_date(yr+1,p_month,1)+least(p_day,extract(day from (make_date(yr+1,p_month,1)+interval '1 month - 1 day'))::integer)-2;
  insert into public.financial_reporting_policies(organization_id,fiscal_start,fiscal_end,currency,rules,created_by,updated_by,reason)
  values(p_org,start_date,end_date,chosen->>'currency',chosen->'rules',auth.uid(),auth.uid(),p_reason) returning id into new_id;
  insert into public.financial_reporting_policy_audit(organization_id,policy_id,actor_id,action,version,detail)
  values(p_org,new_id,auth.uid(),'SAVE',1,jsonb_build_object('fromPolicy',chosen->>'id','reason',p_reason,'fiscalStart',start_date,'fiscalEnd',end_date));
 end loop;
end $$;
revoke all on function private.financial_rebase_setup_policies(uuid,integer,integer,text) from public,anon,authenticated;

do $$
declare definition text;old_guard text;new_guard text;
begin
 definition:=pg_get_functiondef('public.save_financial_fiscal_calendar(uuid,integer,integer,text,integer,text)'::regprocedure);
 old_guard:=$old$and (exists(select 1 from public.financial_opening_workspaces where organization_id=p_org) or exists(select 1 from public.financial_reporting_policies where organization_id=p_org) or exists(select 1 from public.financial_opening_source_assignments where organization_id=p_org) or exists(select 1 from public.financial_year_closures where organization_id=p_org)) then raise exception 'FISCAL_CALENDAR_IN_USE';end if;$old$;
 new_guard:=$new$and private.financial_calendar_setup_lock(p_org) is not null then raise exception 'FISCAL_CALENDAR_IN_USE';end if;
 if c.organization_id is not null and (c.start_month<>p_month or c.start_day<>p_day) then
  perform private.financial_rebase_setup_policies(p_org,p_month,p_day,p_reason);
 end if;$new$;
 if strpos(definition,old_guard)=0 then raise exception 'FISCAL_SETUP_GUARD_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,old_guard,new_guard);
 -- Serialize setup edits against financial source/policy mutations. These locks
 -- are held only during an explicit calendar save, never during page reads.
 definition:=replace(definition,'select * into c from public.financial_fiscal_calendars',
 'lock table public.financial_events,public.transactions,public.liquidity_flows,public.liquidity_settlements,public.asset_accounts,public.liquidity_accounts,public.debt_contracts,public.financial_opening_workspaces,public.financial_opening_source_assignments,public.financial_year_closures,public.financial_reporting_policies,public.financial_budget_plan_ownership in share row exclusive mode; select * into c from public.financial_fiscal_calendars');
 definition:=replace(definition,'union select fiscal_start from public.financial_reporting_policies where organization_id=p_org',
 'union select fiscal_start from public.financial_reporting_policies where organization_id=p_org and status in(''DRAFT'',''APPROVED'')');
 execute definition;
 definition:=pg_get_functiondef('public.financial_fiscal_context(uuid,date)'::regprocedure);
 if strpos(definition,'''canConfigure'',')=0 then raise exception 'FISCAL_SETUP_CONTEXT_SIGNATURE_CHANGED';end if;
 execute replace(definition,'''canConfigure'',','''setupLockReason'',private.financial_calendar_setup_lock(p_org),''canConfigure'',');
end $$;
notify pgrst,'reload schema';
