create or replace function public.financial_opening_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; w jsonb; base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'OPENING_ACCESS_DENIED';end if;
 if p_fiscal_start is null or p_fiscal_start>current_date+366 then raise exception 'OPENING_PERIOD_INVALID';end if;
 select base_currency into base from public.organizations where id=p_org;
 s:=private.financial_opening_sources(p_org,p_fiscal_start-1);
 select to_jsonb(t) into w from public.financial_opening_workspaces t where organization_id=p_org and fiscal_start=p_fiscal_start
  and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'cutoff',p_fiscal_start-1,'currency',base,
  'periodAssetOpenings',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'date',t.transaction_date,'name',a.name,'amount',t.base_value::text,'currency',t.base_currency) order by t.transaction_date,t.id),'[]'::jsonb)
   from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=t.organization_id
   where t.organization_id=p_org and a.ownership_scope='ORGANIZATION' and t.transaction_type='OPENING_BALANCE'
    and t.transaction_date>=p_fiscal_start and t.transaction_date<p_fiscal_start+interval '1 year'),
  'chart',public.financial_reporting_chart(),'source',s,'workspace',w,'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_opening_workspace(uuid,date) from public,anon;
grant execute on function public.financial_opening_workspace(uuid,date) to authenticated;


create or replace function public.financial_statement_live_context()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',o.id,'name',o.name,'currency',o.base_currency,'fiscalStart',w.fiscal_start,'fiscalEnd',(w.fiscal_start+interval '1 year'-interval '1 day')::date) order by o.name,w.fiscal_start desc),'[]'::jsonb)
 from public.organizations o join (
  select organization_id,fiscal_start from public.financial_opening_workspaces where status='APPROVED'
  union select organization_id,fiscal_start from public.financial_reporting_policies where status='APPROVED'
 ) w on w.organization_id=o.id
 where private.financial_opening_can(o.id,'financial_core.view')
$$;
revoke all on function public.financial_statement_live_context() from public,anon;
grant execute on function public.financial_statement_live_context() to authenticated;

create or replace function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;pol public.financial_reporting_policies%rowtype;s jsonb;events jsonb;accounts jsonb;rules jsonb;opening jsonb;closing_cash numeric;opening_cash numeric;original_cash numeric;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into w from public.financial_opening_workspaces where organization_id=p_org and status='APPROVED' and fiscal_start<=p_from and p_to<(fiscal_start+interval '1 year') order by fiscal_start desc limit 1;
 if w.id is null then
  select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED'
   and fiscal_start<=p_from and fiscal_end>=p_to order by fiscal_start desc limit 1;
  if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
  w.fiscal_start:=pol.fiscal_start; w.currency:=pol.currency;
  s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
  if exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and fiscal_start=w.fiscal_start)
   or exists(select 1 from public.financial_events where organization_id=p_org and event_date<w.fiscal_start and status in('ACTUAL','REVERSED'))
   or exists(select 1 from public.transactions where organization_id=p_org and transaction_date<w.fiscal_start)
   or exists(select 1 from public.liquidity_flows where organization_id=p_org and due_date<w.fiscal_start and status='ACTUAL')
   or exists(select 1 from jsonb_array_elements(s->'rows') r where r->>'sourceIssue' is not null or exists(
    select 1 from jsonb_array_elements(r->'vouchers') v where (v->>'debit')::numeric<>0 or (v->>'credit')::numeric<>0))
  then raise exception 'REPORTING_PRIOR_BALANCES_REQUIRE_REVIEW';end if;
  w.approved_opening:='[{"accountCode":"1000","debit":"0","credit":"0"}]'::jsonb;
 else
  s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
  if s->>'financialRevision' is distinct from w.financial_revision then raise exception 'REPORTING_HISTORICAL_SOURCE_CHANGED';end if;
  select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED' and fiscal_start=w.fiscal_start;
 end if;
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
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',coalesce(w.id::text,'FIRST_ACTIVITY:'||w.fiscal_start::text),
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
