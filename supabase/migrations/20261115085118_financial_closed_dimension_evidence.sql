-- Frozen dimension evidence is captured in the same transaction as year close.
-- Historical closes without evidence are deliberately NOT backfilled from today.
create table private.financial_closed_dimension_evidence (
 closure_id uuid primary key references public.financial_year_closures(id),
 organization_id uuid not null references public.organizations(id),
 source_revision text not null,
 evidence jsonb not null,
 captured_at timestamptz not null default now()
);
alter table private.financial_closed_dimension_evidence enable row level security;
revoke all on private.financial_closed_dimension_evidence from public,anon,authenticated;

create function private.capture_financial_closed_dimensions()
returns trigger language plpgsql security definer set search_path='' as $$
declare registry jsonb;workspace jsonb;distribution jsonb;links jsonb:='[]';names jsonb;ev jsonb;l jsonb;
 original public.financial_opening_workspaces%rowtype;line_ public.financial_event_lines%rowtype;
 branch uuid;available boolean:=true;source_id text;
begin
 if new.status<>'CLOSED' then return new;end if;
 -- Direct administrative/import inserts are not attested application closes.
 if auth.uid() is null then return new;end if;
 -- Closing already locks source tables. Serialize allocation and registry capture
 -- against their administrative commands without changing those records.
 lock table private.financial_dimensional_opening_distributions,private.financial_center_branch_assignments,public.organization_cost_centers,public.organization_entities in share mode;
 registry:=public.financial_center_branch_registry(new.organization_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') into names
 from public.organization_cost_centers where organization_id=new.organization_id;
 source_id:=new.source_snapshot->>'openingSourceId';
 if source_id not like 'FIRST_ACTIVITY:%' then
  distribution:=public.financial_dimensional_opening_report_context(new.organization_id,new.fiscal_start);
  select * into original from public.financial_opening_workspaces where id::text=source_id and organization_id=new.organization_id and fiscal_start=new.fiscal_start and status='APPROVED';
  if distribution->>'status' is distinct from 'APPROVED' or original.id is null
   or distribution->>'openingWorkspaceId'<>source_id or (distribution->>'openingVersion')::integer<>original.version
   or distribution->>'openingDigest'<>md5(original.approved_opening::text) then available:=false;
  else
   workspace:=jsonb_build_object('id',original.id,'organizationId',original.organization_id,'fiscalStart',original.fiscal_start,'currency',original.currency,
    'version',original.version,'digest',distribution->>'openingDigest','status','APPROVED',
    'items',(select coalesce(jsonb_agg(jsonb_build_object('itemId',x->>'itemId','accountId',x->>'accountCode','debit',x->>'debit','credit',x->>'credit')),'[]') from jsonb_array_elements(original.approved_opening) x));
   distribution:=jsonb_build_object('id',distribution->>'id','organizationId',new.organization_id,'openingWorkspaceId',original.id,
    'openingVersion',original.version,'openingDigest',distribution->>'openingDigest','status','APPROVED','approvedBy',distribution->>'approvedBy',
    'revision',distribution->>'version','entries',distribution->'entries');
  end if;
 end if;
 for ev in select * from jsonb_array_elements(new.source_snapshot->'events') loop
  select entity_id into branch from public.financial_events where id::text=ev->>'id' and organization_id=new.organization_id;
  if not found then available:=false;exit;end if;
  for l in select * from jsonb_array_elements(ev->'lines') loop
   if coalesce(l->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[A-Z][A-Z0-9_]*$' then available:=false;exit;end if;
   select * into line_ from public.financial_event_lines where id=split_part(l->>'id',':',1)::uuid and event_id::text=ev->>'id' and organization_id=new.organization_id;
   if line_.id is null then available:=false;exit;end if;
   links:=links||jsonb_build_array(jsonb_build_object('eventId',ev->>'id','lineId',l->>'id','branchId',branch,'centerId',line_.cost_center_id));
  end loop;
  if not available then exit;end if;
 end loop;
 insert into private.financial_closed_dimension_evidence(closure_id,organization_id,source_revision,evidence)
 values(new.id,new.organization_id,new.source_revision,jsonb_build_object('status',case when available then 'CAPTURED' else 'UNAVAILABLE' end,
  'registry',registry,'workspace',workspace,'distribution',distribution,'links',links,'names',names));
 return new;
end $$;
revoke all on function private.capture_financial_closed_dimensions() from public,anon,authenticated;
create trigger financial_capture_closed_dimensions after insert on public.financial_year_closures
 for each row execute function private.capture_financial_closed_dimensions();

create function public.financial_closed_dimension_context(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare closure public.financial_year_closures%rowtype;frozen private.financial_closed_dimension_evidence%rowtype;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into closure from public.financial_year_closures where organization_id=p_org and status='CLOSED' and fiscal_start<=p_from and fiscal_end>=p_to;
 if closure.id is null then raise exception 'REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE';end if;
 select * into frozen from private.financial_closed_dimension_evidence where closure_id=closure.id and organization_id=p_org;
 if frozen.closure_id is null or frozen.source_revision<>closure.source_revision or frozen.evidence->>'status'<>'CAPTURED' then raise exception 'REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE';end if;
 return jsonb_build_object('status','FROZEN_DIMENSION_EVIDENCE','closureId',closure.id,'organizationId',p_org,'from',p_from,'to',p_to,
  'sourceRevision',closure.source_revision,'capturedAt',frozen.captured_at,'evidence',frozen.evidence);
end $$;
revoke all on function public.financial_closed_dimension_context(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_closed_dimension_context(uuid,date,date) to authenticated;
