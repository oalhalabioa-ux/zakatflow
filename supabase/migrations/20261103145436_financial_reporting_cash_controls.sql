create or replace function public.save_financial_reporting_policy(p_org uuid,p_fiscal_start date,p_expected_version integer,p_rules jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol public.financial_reporting_policies%rowtype;rule jsonb;base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'REPORTING_SAVE_DENIED';end if;
 if p_fiscal_start is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>5000 or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'REPORTING_POLICY_INVALID';end if;
 for rule in select * from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(rule) is distinct from 'object' or exists(select 1 from jsonb_object_keys(rule) k where k not in('eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'))
   or nullif(rule->>'eventType','') is null or nullif(rule->>'sourceModule','') is null or nullif(rule->>'classificationId','') is null
   or coalesce(rule->>'cashDirection','') not in('NON_CASH','INFLOW','OUTFLOW')
   or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'id'=rule->>'debitAccountId')
   or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'id'=rule->>'creditAccountId')
   or rule->>'debitAccountId'=rule->>'creditAccountId' and (rule->>'debitAccountId'<>'1000' or rule->>'cashDirection'='NON_CASH')
   or rule->>'cashActivity' is not null and rule->>'cashActivity' not in('OPERATING','INVESTING','FINANCING')
  then raise exception 'REPORTING_POLICY_INVALID';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_rules) r group by r->>'eventType',r->>'sourceModule',r->>'classificationId',r->>'cashDirection' having count(*)>1) then raise exception 'REPORTING_POLICY_DUPLICATE';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||p_org::text||p_fiscal_start::text,0));
 select * into pol from public.financial_reporting_policies where organization_id=p_org and fiscal_start=p_fiscal_start and status='DRAFT' for update;
 if coalesce(pol.version,0)<>p_expected_version then raise exception 'REPORTING_VERSION_CONFLICT';end if;
 select base_currency into base from public.organizations where id=p_org;
 if pol.id is null then
  insert into public.financial_reporting_policies(organization_id,fiscal_start,fiscal_end,currency,rules,reason,created_by,updated_by)
  values(p_org,p_fiscal_start,(p_fiscal_start+interval '1 year'-interval '1 day')::date,base,p_rules,p_reason,auth.uid(),auth.uid()) returning * into pol;
 else
  update public.financial_reporting_policies set rules=p_rules,reason=p_reason,version=version+1,updated_by=auth.uid(),updated_at=now() where id=pol.id returning * into pol;
 end if;
 insert into public.financial_reporting_policy_audit(organization_id,policy_id,actor_id,action,version,detail) values(p_org,pol.id,auth.uid(),'SAVE',pol.version,to_jsonb(pol));
 return to_jsonb(pol);
end $$;
revoke all on function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) from public,anon;
grant execute on function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) to authenticated;


create or replace function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;pol public.financial_reporting_policies%rowtype;s jsonb;events jsonb;accounts jsonb;rules jsonb;opening jsonb;closing_cash numeric;opening_cash numeric;original_cash numeric;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into w from public.financial_opening_workspaces where organization_id=p_org and status='APPROVED' and fiscal_start<=p_from and p_to<(fiscal_start+interval '1 year') order by fiscal_start desc limit 1;
 if w.id is null then raise exception 'REPORTING_APPROVED_OPENING_REQUIRED';end if;
 s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
 if s->>'financialRevision' is distinct from w.financial_revision then raise exception 'REPORTING_HISTORICAL_SOURCE_CHANGED';end if;
 select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED' and fiscal_start=w.fiscal_start;
 if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
 events:=private.financial_reporting_events(p_org,w.fiscal_start,pol.fiscal_end);
 select jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',w.currency)) into accounts from jsonb_array_elements(public.financial_reporting_chart()) a;
 select jsonb_agg(jsonb_build_object('accountId',code,'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text)) into opening from
  (select r->>'accountCode' code,sum((r->>'debit')::numeric-(r->>'credit')::numeric) amount from jsonb_array_elements(w.approved_opening) r group by r->>'accountCode') t;
 select coalesce(jsonb_agg(r||jsonb_build_object('id',pol.id::text||':'||ord,'organizationId',p_org,'currency',pol.currency,'from',pol.fiscal_start,'to',pol.fiscal_end)),'[]'::jsonb) into rules from jsonb_array_elements(pol.rules) with ordinality x(r,ord);
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0) into original_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 select coalesce(sum((r->>'debit')::numeric-(r->>'credit')::numeric),0) into opening_cash from jsonb_array_elements(w.approved_opening) r where r->>'accountCode'='1000';
 s:=private.financial_opening_sources(p_org,p_to);
 if exists(select 1 from jsonb_array_elements(s->'rows') r where r->>'tab'='cash' and r->>'sourceIssue' is not null) then raise exception 'REPORTING_CASH_RECONCILIATION_REQUIRED';end if;
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0)+opening_cash-original_cash into closing_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',w.id,
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';

