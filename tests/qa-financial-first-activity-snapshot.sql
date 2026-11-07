-- QA-only first-activity reporting RPC contract. Everything rolls back.
-- This is intentionally NOT a production migration or a deployed endpoint.
begin;

create function public.financial_statement_first_activity_snapshot(
 p_org uuid,p_from date,p_to date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 pol public.financial_reporting_policies%rowtype;
 previous_sources jsonb;current_sources jsonb;
 events jsonb;accounts jsonb;rules jsonb;
 closing_cash numeric;base text;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to
 then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into pol from public.financial_reporting_policies
 where organization_id=p_org and status='APPROVED'
   and fiscal_start<=p_from and fiscal_end>=p_to
 order by fiscal_start desc limit 1;
 if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
 select base_currency into base from public.organizations where id=p_org;
 if base is null or base<>pol.currency
 then raise exception 'REPORTING_SOURCE_CURRENCY_MISMATCH';end if;

 -- This path is ONLY for truly first activity, not for an incomplete draft,
 -- a superseded year or a hidden historical opening.
 if exists(select 1 from public.financial_opening_workspaces
     where organization_id=p_org and fiscal_start<=pol.fiscal_start)
 then raise exception 'REPORTING_APPROVED_OPENING_REQUIRED';end if;
 -- A prior fiscal policy, even a draft with no postings, disqualifies
 -- FIRST ACTIVITY. It may require historical period/close reconciliation.
 if exists(select 1 from public.financial_reporting_policies
     where organization_id=p_org and fiscal_start<pol.fiscal_start)
 or exists(select 1 from public.financial_year_closures
     where organization_id=p_org and fiscal_start<pol.fiscal_start)
 then raise exception 'REPORTING_FIRST_ACTIVITY_EVIDENCE_REQUIRED';end if;
 if exists(select 1 from public.financial_events
     where organization_id=p_org and event_date<pol.fiscal_start
       and status not in('CANCELLED'))
 then raise exception 'REPORTING_FIRST_ACTIVITY_EVIDENCE_REQUIRED';end if;
 previous_sources:=private.financial_opening_sources(p_org,pol.fiscal_start-1);
 if previous_sources is null or jsonb_typeof(previous_sources->'rows') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(previous_sources->'rows') r
      where r->>'sourceIssue' is not null
      or jsonb_typeof(r->'vouchers') is distinct from 'array'
      or jsonb_array_length(r->'vouchers')<>0)
 then raise exception 'REPORTING_FIRST_ACTIVITY_EVIDENCE_REQUIRED';end if;

 events:=private.financial_reporting_events(p_org,pol.fiscal_start,pol.fiscal_end);
 if jsonb_typeof(events) is distinct from 'array'
 then raise exception 'REPORTING_SOURCE_INCOMPLETE';end if;
 select coalesce(jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',pol.currency)),'[]'::jsonb)
 into accounts from jsonb_array_elements(public.financial_reporting_chart()) a;
 select coalesce(jsonb_agg(r||jsonb_build_object('id',pol.id::text||':'||ord,
  'organizationId',p_org,'currency',pol.currency,'from',pol.fiscal_start,'to',pol.fiscal_end)),'[]'::jsonb)
 into rules from jsonb_array_elements(pol.rules) with ordinality x(r,ord);

 current_sources:=private.financial_opening_sources(p_org,p_to);
 if current_sources is null or jsonb_typeof(current_sources->'rows') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(current_sources->'rows') r
     where r->>'tab'='cash' and r->>'sourceIssue' is not null)
 then raise exception 'REPORTING_CASH_RECONCILIATION_REQUIRED';end if;
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0)
 into closing_cash from jsonb_array_elements(current_sources->'rows') r
 cross join lateral jsonb_array_elements(r->'vouchers') v
 where r->>'tab'='cash';
 if not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'REPORTING_ACCESS_DENIED';end if;
 return jsonb_build_object(
  'origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',pol.currency,
  'openingDate',pol.fiscal_start-1,'fiscalStart',pol.fiscal_start,
  'from',p_from,'to',p_to,'openingSourceId','FIRST_ACTIVITY:'||pol.fiscal_start::text,
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),
  'accounts',accounts,'opening','[]'::jsonb,
  'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,
   'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),
  'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES',
   'eventCount',jsonb_array_length(events),
   'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0)
       from jsonb_array_elements(events) e),
   'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_first_activity_snapshot(uuid,date,date)
 from public,anon,authenticated;
grant execute on function public.financial_statement_first_activity_snapshot(uuid,date,date)
 to authenticated;

do $$
declare owner_id uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();pol jsonb;result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (owner_id,owner_id||'@first-activity.invalid',now()),
  (outsider,outsider||'@first-activity.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name,approval_policy)
 values(org,owner_id,'QA zero opening source','OWNER_CONTROLLED');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(org,owner_id,'OWNER','ACTIVE');

 begin
  perform public.financial_statement_first_activity_snapshot(org,'2026-01-01','2026-12-31');
  raise exception 'Unapproved policy incorrectly produced statements';
 exception when others then
  if sqlerrm<>'REPORTING_APPROVED_POLICY_REQUIRED' then raise;end if;
 end;

 pol:=public.save_financial_reporting_policy(org,'2026-01-01',0,'[]'::jsonb,
  'First activity explicit approved posting rules');
 perform public.approve_financial_reporting_policy((pol->>'id')::uuid,1);

 result:=public.financial_statement_first_activity_snapshot(org,'2026-01-01','2026-12-31');
 if result->>'openingSourceId'<>'FIRST_ACTIVITY:2026-01-01'
  or result->'opening'<>'[]'::jsonb
  or result->>'origin'<>'LIVE_CANONICAL_EVENTS'
  or result->'coverage'->>'complete'<>'true'
  or result->'coverage'->>'lineCount'<>'0'
 then raise exception 'First activity canonical evidence is incomplete';end if;
 -- The older public reporting wrapper may already provide a valid fiscal
 -- snapshot in some schema versions. Do not assert its legacy failure mode:
 -- this QA test is exclusively for the new independently attested zero-opening
 -- source, denied prior balances and tenant isolation.
 -- A previously established fiscal year cannot silently become a
 -- first-activity year solely because it had no journals or opening vouchers.
 begin
  perform public.save_financial_reporting_policy(org,'2025-01-01',0,'[]'::jsonb,
   'Historic fiscal year without postings');
  perform public.financial_statement_first_activity_snapshot(org,'2026-01-01','2026-12-31');
  raise exception 'Historic policy was misclassified as first activity';
 exception when others then
  if sqlerrm<>'REPORTING_FIRST_ACTIVITY_EVIDENCE_REQUIRED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.financial_statement_first_activity_snapshot(org,'2026-01-01','2026-12-31');
  raise exception 'Foreign user read first-activity source';
 exception when others then
  if sqlerrm<>'REPORTING_ACCESS_DENIED' then raise;end if;
 end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.liquidity_accounts(
  organization_id,name,account_type,currency,current_balance,current_balance_base,
  created_by,metadata)
 values(org,'Prior bank balance','BANK','SAR',50,50,owner_id,
  '{"opening_date":"2025-12-31","opening_balance":50,"opening_fx_rate":1}'::jsonb);
 begin
  perform public.financial_statement_first_activity_snapshot(org,'2026-01-01','2026-12-31');
  raise exception 'Nonzero prior bank balance passed as first activity';
 exception when others then
  if sqlerrm<>'REPORTING_FIRST_ACTIVITY_EVIDENCE_REQUIRED' then raise;end if;
 end;
end $$;
select 'PASS first-activity zero opening, policy, history, RLS and prior-balance denial';
rollback;
