-- Read-only, one PostgreSQL statement snapshot for source + branch attribution.
-- Does not create allocations, approve balances, or alter financial journals.
create or replace function private.financial_branch_report_source(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; e jsonb; entity uuid; branch uuid; kind text; links jsonb:='[]';
 registry jsonb; w public.financial_opening_workspaces%rowtype;
 d private.financial_branch_opening_distributions%rowtype;
 workspace jsonb; distribution jsonb; body jsonb; found_source boolean;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'REPORTING_ACCESS_DENIED';end if;
 s:=public.financial_statement_live_snapshot(p_org,p_from,p_to);
 -- Closed-year totals are immutable but their historical dimensions have not
 -- been frozen in the closure. Do not combine them with today's assignments.
 if s?'closureId' then raise exception 'REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,
  'organizationId',x.organization_id,'entityType',x.entity_type,'active',x.active) order by x.id),'[]')
 into registry from public.organization_entities x where x.organization_id=p_org;
 if jsonb_array_length(registry)>1000 then raise exception 'REPORTING_DIMENSION_LIMIT';end if;
 for e in select value from jsonb_array_elements(s->'events')
  where (value->>'date')::date between (s->>'fiscalStart')::date and p_to loop
  entity:=null; found_source:=false;
  if e->>'sourceModule'='LEGACY_ASSET' and e->>'id'='transaction:'||(e->>'sourceKey') then
   select t.entity_id,true into entity,found_source from public.transactions t
    where t.id::text=e->>'sourceKey' and t.organization_id=p_org and t.transaction_date=(e->>'date')::date;
  elsif e->>'sourceModule'='LEGACY_CASH' and e->>'id'='flow:'||(e->>'sourceKey') then
   select f.entity_id,true into entity,found_source from public.liquidity_flows f
    where f.id::text=e->>'sourceKey' and f.organization_id=p_org and f.due_date=(e->>'date')::date and f.status='ACTUAL';
  elsif (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   select f.entity_id,true into entity,found_source from public.financial_events f
    where f.id::text=e->>'id' and f.organization_id=p_org
     and f.event_date=(e->>'date')::date and f.status in ('ACTUAL','REVERSED');
  end if;
  -- Aggregated legacy transfers can cross branches; their individual legs
  -- require an interbranch clearing source, never an arbitrary single branch.
  if found_source is distinct from true then raise exception 'REPORTING_BRANCH_SOURCE_UNRESOLVED';end if;
  branch:=null;
  if entity is not null then
   select x.entity_type into kind from public.organization_entities x
    where x.id=entity and x.organization_id=p_org;
   if kind='BRANCH' then branch:=entity;
   elsif kind is distinct from 'COMPANY' then raise exception 'REPORTING_BRANCH_SOURCE_UNRESOLVED';end if;
  end if;
  links:=links||jsonb_build_array(jsonb_build_object('journalId',e->>'id','branchId',branch,
   'scope',case when branch is null then 'ORGANIZATION_DIRECT' else 'BRANCH' end));
 end loop;
 select * into w from public.financial_opening_workspaces
  where id::text=s->>'openingSourceId' and organization_id=p_org and status='APPROVED';
 if w.id is null then raise exception 'REPORTING_BRANCH_OPENING_REQUIRED';end if;
 select * into d from private.financial_branch_opening_distributions
  where organization_id=p_org and fiscal_start=w.fiscal_start and status='APPROVED';
 if d.id is null then raise exception 'REPORTING_BRANCH_OPENING_REQUIRED';end if;
 if d.opening_workspace_id<>w.id or d.opening_version<>w.version or d.currency<>w.currency
  or d.opening_digest<>md5(w.approved_opening::text)
 then raise exception 'REPORTING_BRANCH_OPENING_STALE';end if;
 workspace:=jsonb_build_object('id',w.id,'organizationId',p_org,'fiscalStart',w.fiscal_start,
  'currency',w.currency,'version',w.version,'status','APPROVED','approvedOpening',w.approved_opening);
 distribution:=jsonb_build_object('status','APPROVED','kind','OPENING_DISTRIBUTION_EVIDENCE_ONLY',
  'organizationId',p_org,'openingWorkspaceId',w.id,'openingVersion',w.version,
  'openingDigest',d.opening_digest,'approvedBy',d.approved_by,'entries',d.entries,'journalCoverageComplete',false);
 body:=jsonb_build_object('version',1,'source',s,'entities',registry,'workspace',workspace,
  'distribution',distribution,'journalEvidence',jsonb_build_object('status','RLS_MATCHED_JOURNAL_REFERENCES_ONLY',
  'organizationId',p_org,'links',links));
 return body||jsonb_build_object('revision',md5((body-'source')::text||
  ((s-'coverage'-'readAt')||jsonb_build_object('coverage',(s->'coverage')-'readAt'))::text));
end $$;
revoke all on function private.financial_branch_report_source(uuid,date,date) from public,anon,authenticated;
grant execute on function private.financial_branch_report_source(uuid,date,date) to authenticated;
create or replace function public.financial_branch_report_source(p_org uuid,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.financial_branch_report_source(p_org,p_from,p_to);
$$;
revoke all on function public.financial_branch_report_source(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_branch_report_source(uuid,date,date) to authenticated;
