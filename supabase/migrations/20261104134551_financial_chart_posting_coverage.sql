-- Phase 2c. Validate the central debit/credit mapping for every *actual*
-- source line before approving a financial-year posting policy. No source
-- voucher, posting amount, or existing approval is modified.

create function private.financial_policy_source_coverage(p_events jsonb,p_rules jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 with signatures as (
  select e->>'eventType' event_type,e->>'sourceModule' source_module,
   l->>'classificationId' classification_id,l->>'cashDirection' cash_direction,
   count(*)::bigint line_count
  from jsonb_array_elements(p_events) e
  cross join lateral jsonb_array_elements(e->'lines') l
  group by e->>'eventType',e->>'sourceModule',l->>'classificationId',l->>'cashDirection'
 ), evaluated as (
  select s.*,(
   select count(*)::integer from jsonb_array_elements(p_rules) r
   where r->>'eventType'=s.event_type and r->>'sourceModule'=s.source_module
     and r->>'classificationId'=s.classification_id and r->>'cashDirection'=s.cash_direction
     and nullif(r->>'debitAccountId','') is not null and nullif(r->>'creditAccountId','') is not null
  ) match_count from signatures s
 )
 select jsonb_build_object(
  'eventCount',jsonb_array_length(p_events),
  'emptyEvents',coalesce((select count(*) from jsonb_array_elements(p_events) e where jsonb_array_length(coalesce(e->'lines','[]'::jsonb))=0),0),
  'lineCount',coalesce((select sum(line_count) from evaluated),0),
  'mappedLines',coalesce((select sum(line_count) from evaluated where match_count=1),0),
  'missingLines',coalesce((select sum(line_count) from evaluated where match_count=0),0),
  'ambiguousLines',coalesce((select sum(line_count) from evaluated where match_count>1),0),
  'groups',coalesce((select jsonb_agg(jsonb_build_object(
   'eventType',event_type,'sourceModule',source_module,
   'classificationId',classification_id,'cashDirection',cash_direction,
   'lineCount',line_count,'matchingRules',match_count,
   'status',case when match_count=1 then 'MAPPED' when match_count=0 then 'MISSING' else 'AMBIGUOUS' end)
   order by source_module,event_type,classification_id,cash_direction)
   from evaluated),'[]'::jsonb)
 )
$$;
revoke all on function private.financial_policy_source_coverage(jsonb,jsonb) from public,anon,authenticated;

-- Reuse the exact opening-consumption identity tested by the statement
-- compiler. A voucher already adopted into an approved opening is not a
-- second current-year posting merely because its original date is in-year.
create function private.financial_policy_postable_events(p_org uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare opening public.financial_opening_workspaces%rowtype;events jsonb;
begin
 events:=private.financial_reporting_events(p_org,p_start,p_end);
 select * into opening from public.financial_opening_workspaces
 where organization_id=p_org and fiscal_start=p_start and status='APPROVED';
 if opening.id is null then return events;end if;
 select coalesce(jsonb_agg(ev),'[]'::jsonb) into events from jsonb_array_elements(events) ev where not exists(
  select 1 from (
   select vv from jsonb_array_elements(opening.source_snapshot->'rows') rr
    cross join lateral jsonb_array_elements(rr->'vouchers') vv
   union all
   select jsonb_build_object('canonicalId',assignment.source_table||':'||assignment.source_id)
   from public.financial_opening_source_assignments assignment
   where assignment.organization_id=p_org and assignment.fiscal_start<=opening.fiscal_start
    and exists(select 1 from public.financial_opening_workspaces adopted
     where adopted.organization_id=p_org and adopted.fiscal_start=assignment.fiscal_start and adopted.status='APPROVED')
  ) consumed(vv)
  where vv->>'canonicalId'='transactions:'||replace(ev->>'id','transaction:','')
   or exists(select 1 from public.transactions t where t.organization_id=p_org
    and vv->>'canonicalId'='transactions:'||t.id and (
     t.metadata->>'financial_event_id'=ev->>'id'
     or exists(select 1 from public.financial_events integrated where integrated.organization_id=p_org
      and integrated.id::text=ev->>'id' and integrated.source_record_id=t.id)
     or exists(select 1 from public.financial_event_links integrated where integrated.organization_id=p_org
      and integrated.event_id::text=ev->>'id' and integrated.target_module='transactions'
      and integrated.target_record_id=t.id)))
   or vv->>'canonicalId' in(select 'financial_event_obligations:'||ob.id
    from public.financial_event_obligations ob where ob.organization_id=p_org and ob.event_id::text=ev->>'id')
 );
 return events;
end $$;
revoke all on function private.financial_policy_postable_events(uuid,date,date) from public,anon,authenticated;

create function private.financial_assert_policy_source_coverage(p_org uuid,p_start date,p_end date,p_rules jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare coverage jsonb;
begin
 coverage:=private.financial_policy_source_coverage(private.financial_policy_postable_events(p_org,p_start,p_end),p_rules);
 if (coverage->>'emptyEvents')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_EMPTY';end if;
 if (coverage->>'missingLines')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_UNMAPPED';end if;
 if (coverage->>'ambiguousLines')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_AMBIGUOUS';end if;
end $$;
revoke all on function private.financial_assert_policy_source_coverage(uuid,date,date,jsonb) from public,anon,authenticated;

-- The editable policy page and the approval endpoint must inspect the same
-- post-opening sources. Otherwise the page would demand unnecessary mappings.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.financial_reporting_policy_workspace(uuid,date)'::regprocedure);
 needle:='result:=private.financial_reporting_events(p_org,p_fiscal_start,(p_fiscal_start+interval ''1 year''-interval ''1 day'')::date);';
 if strpos(definition,needle)=0 then raise exception 'REPORTING_POLICY_WORKSPACE_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,replace(needle,'private.financial_reporting_events','private.financial_policy_postable_events'));
end $$;

-- Preserve all existing period, approval policy, permission and supersession
-- checks. Add the coverage guard only to the current approval definition.
do $$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.approve_financial_reporting_policy(uuid,integer)'::regprocedure);
 needle:=$old$if pol.status<>'DRAFT' or pol.version is distinct from p_expected_version then raise exception 'REPORTING_VERSION_CONFLICT';end if;$old$;
 replacement:=needle||E'\n perform private.financial_assert_policy_source_coverage(pol.organization_id,pol.fiscal_start,pol.fiscal_end,pol.rules);';
 if strpos(definition,needle)=0 then raise exception 'REPORTING_POLICY_APPROVAL_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $$;

notify pgrst,'reload schema';
