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

create function private.financial_assert_policy_source_coverage(p_org uuid,p_start date,p_end date,p_rules jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare coverage jsonb;
begin
 coverage:=private.financial_policy_source_coverage(private.financial_reporting_events(p_org,p_start,p_end),p_rules);
 if (coverage->>'emptyEvents')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_EMPTY';end if;
 if (coverage->>'missingLines')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_UNMAPPED';end if;
 if (coverage->>'ambiguousLines')::bigint>0 then raise exception 'REPORTING_POLICY_SOURCE_AMBIGUOUS';end if;
end $$;
revoke all on function private.financial_assert_policy_source_coverage(uuid,date,date,jsonb) from public,anon,authenticated;

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
