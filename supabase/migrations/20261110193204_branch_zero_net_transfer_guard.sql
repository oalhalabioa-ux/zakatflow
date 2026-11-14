-- A zero-net company transfer may still move cash between operating branches.
-- The company adapter intentionally removes these pairs. Refuse branch figures
-- until an interbranch clearing source is available; never silently lose legs.
do $migration$
declare definition text; marker text:=' for e in select value from jsonb_array_elements(s->''events'')';
 guard text:=$guard$
 if exists (
  select 1 from public.liquidity_flows f
  left join public.organization_entities x on x.id=f.entity_id and x.organization_id=p_org
  where f.organization_id=p_org and f.status='ACTUAL'
   and f.due_date between (s->>'fiscalStart')::date and p_to
   and (f.transfer_id is not null or f.intercompany_transfer_id is not null)
  group by coalesce(f.transfer_id,f.intercompany_transfer_id)
  having count(distinct case when x.entity_type='BRANCH' then x.id::text else 'HQ' end)>1
   or bool_or(f.entity_id is not null and (x.id is null or x.entity_type not in ('COMPANY','BRANCH')))
 ) then raise exception 'REPORTING_BRANCH_SOURCE_UNRESOLVED';end if;
$guard$;
begin
 definition:=pg_get_functiondef('private.financial_branch_report_source(uuid,date,date)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'BRANCH_SOURCE_PATCH_ANCHOR_MISSING';end if;
 execute replace(definition,marker,guard||marker);
end $migration$;
