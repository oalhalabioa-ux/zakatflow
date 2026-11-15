create table private.financial_group_acquisition_evidence (
  id uuid primary key,
  root_id uuid not null references public.organizations(id),
  subsidiary_id uuid not null references public.organizations(id),
  period_from date not null,
  period_to date not null,
  control_id uuid not null references private.financial_group_control_assessments(id),
  registry_revision text not null,
  measurement jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','REVOKED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  approval_reason text,
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text
);
create unique index financial_group_acquisition_active_control
  on private.financial_group_acquisition_evidence(control_id) where status='APPROVED';

alter table private.financial_group_acquisition_evidence enable row level security;
revoke all on private.financial_group_acquisition_evidence from public, anon, authenticated;

create function private.group_acquisition_check(p_root uuid, p_from date, p_to date, p_measurement jsonb, p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  scope jsonb;
  relationship jsonb;
  member uuid;
  subsidiary uuid;
  snapshot jsonb;
  item jsonb;
  nci jsonb;
  net_assets numeric := 0;
  minority numeric;
  consideration numeric;
  reachable_count integer;
  money_pattern constant text := '^[0-9]{1,20}(\.[0-9]{1,4})?$';
begin
  if auth.uid() is null then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
  scope := public.financial_group_registered_scope(p_root,p_from,p_to);
  if jsonb_typeof(p_measurement) is distinct from 'object' or octet_length(p_measurement::text)>200000 then
    raise exception 'GROUP_ACQUISITION_INPUT_INVALID';
  end if;
  subsidiary := (p_measurement->>'subsidiaryOrganizationId')::uuid;
  select value into relationship from jsonb_array_elements(scope->'relationships')
    where value->>'parentOrganizationId'=p_root::text and value->>'subsidiaryOrganizationId'=subsidiary::text;
  if relationship is null or (relationship->>'effectiveFrom')::date>p_from
    or coalesce((relationship->>'effectiveTo')::date,p_to)<p_to
    or ((relationship->>'directEconomicInterestPercent')::numeric not between 0.000001 and 100)
    then raise exception 'GROUP_ACQUISITION_CONTROL_REQUIRED'; end if;

  for member in select value::uuid from jsonb_array_elements_text(scope->'expectedOrganizationIds') loop
    if (select count(*) from jsonb_array_elements(scope->'relationships') r
        where r->>'subsidiaryOrganizationId'=member::text)
      <> (case when member=p_root then 0 else 1 end)
      then raise exception 'GROUP_ACQUISITION_REGISTRY_INVALID'; end if;
    if exists (select 1 from jsonb_array_elements(scope->'relationships') r
      where r->>'subsidiaryOrganizationId'=member::text
        and ((r->>'effectiveFrom')::date>p_from or coalesce((r->>'effectiveTo')::date,p_to)<p_to))
      then raise exception 'GROUP_ACQUISITION_CONTROL_REQUIRED'; end if;
  end loop;
  with recursive reachable(id) as (
    select p_root::text
    union
    select r->>'subsidiaryOrganizationId'
      from reachable parent join lateral jsonb_array_elements(scope->'relationships') r
        on r->>'parentOrganizationId'=parent.id
  ) select count(*) into reachable_count from reachable;
  if reachable_count<>jsonb_array_length(scope->'expectedOrganizationIds') then
    raise exception 'GROUP_ACQUISITION_REGISTRY_INVALID';
  end if;
  if p_action in ('SAVE','APPROVE') then
    foreach member in array array[p_root,subsidiary] loop
      if not private.financial_opening_can(member,case when p_action='SAVE' then 'financial_core.create' else 'financial_core.approve' end)
        or not public.is_organization_admin(member) then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
    end loop;
  end if;

  if p_measurement->>'parentOrganizationId' is distinct from p_root::text
    or p_measurement->>'acquisitionDate' is distinct from relationship->>'effectiveFrom'
    or p_measurement->>'transactionType' is distinct from 'SINGLE_STEP_BUSINESS_COMBINATION'
    or p_measurement->'commonControl' is distinct from 'false'::jsonb
    or p_measurement->>'instruments' is distinct from 'ORDINARY_PROPORTIONATE'
    or not coalesce(p_measurement->>'currency','') ~ '^[A-Z]{3}$'
    or jsonb_typeof(p_measurement->'consideration') is distinct from 'string'
    or jsonb_typeof(p_measurement->'considerationEvidence') is distinct from 'string'
    or not coalesce(p_measurement->>'consideration','') ~ money_pattern
    or length(trim(coalesce(p_measurement->>'considerationEvidence',''))) not between 8 and 1000
    or jsonb_typeof(p_measurement->'identifiableItems') is distinct from 'array'
    or p_measurement - array['parentOrganizationId','subsidiaryOrganizationId','currency','acquisitionDate','transactionType','commonControl','instruments','consideration','considerationEvidence','identifiableItems','nci'] <> '{}'::jsonb
    then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
  if jsonb_array_length(p_measurement->'identifiableItems') not between 1 and 1000
    or (select count(distinct value->>'id') from jsonb_array_elements(p_measurement->'identifiableItems')) <>
      jsonb_array_length(p_measurement->'identifiableItems')
    then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;

  for item in select value from jsonb_array_elements(p_measurement->'identifiableItems') loop
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['id','kind','recognizedAmount','measurementEvidence'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string'
      or jsonb_typeof(item->'recognizedAmount') is distinct from 'string'
      or jsonb_typeof(item->'measurementEvidence') is distinct from 'string'
      or length(coalesce(item->>'id','')) not between 1 and 200
      or coalesce(item->>'kind','') not in ('ASSET','LIABILITY')
      or not coalesce(item->>'recognizedAmount','') ~ money_pattern
      or length(trim(coalesce(item->>'measurementEvidence',''))) not between 8 and 1000
      then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
    net_assets := net_assets + (item->>'recognizedAmount')::numeric * case when item->>'kind'='ASSET' then 1 else -1 end;
  end loop;
  nci := p_measurement->'nci';
  minority := 100 - (relationship->>'directEconomicInterestPercent')::numeric;
  consideration := (p_measurement->>'consideration')::numeric;
  if nci->>'method'='PROPORTIONATE_NET_ASSETS' and nci - 'method' = '{}'::jsonb then
    minority := round(net_assets * minority / 100,4);
  elsif nci->>'method'='FAIR_VALUE' and nci - array['method','amount','valuationEvidence'] = '{}'::jsonb
    and jsonb_typeof(nci->'amount')='string' and jsonb_typeof(nci->'valuationEvidence')='string'
    and coalesce(nci->>'amount','') ~ money_pattern
    and length(trim(coalesce(nci->>'valuationEvidence',''))) between 8 and 1000 then
    if minority=0 and (nci->>'amount')::numeric<>0 then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
    minority := (nci->>'amount')::numeric;
  else raise exception 'GROUP_ACQUISITION_INPUT_INVALID';
  end if;
  if p_action in ('APPROVE','READ_APPROVED') and consideration + minority < net_assets then
    raise exception 'GROUP_ACQUISITION_REASSESSMENT_REQUIRED';
  end if;

  for member in select value::uuid from jsonb_array_elements_text(scope->'expectedOrganizationIds') loop
    snapshot := public.financial_statement_live_snapshot(member,p_from,p_to);
    if snapshot->>'currency' is distinct from p_measurement->>'currency' then
      raise exception 'GROUP_ACQUISITION_FX_REQUIRED';
    end if;
  end loop;
  return scope || jsonb_build_object('assessment',relationship);
end $$;

create function private.group_acquisition_evidence_command(
  p_action text, p_id uuid, p_root uuid, p_from date, p_to date, p_measurement jsonb, p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  entry private.financial_group_acquisition_evidence%rowtype;
  scope jsonb;
  actor uuid := auth.uid();
begin
  if actor is null or p_id is null then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
  if coalesce(p_action,'') not in ('SAVE','APPROVE','REVOKE','READ') then
    raise exception 'GROUP_ACQUISITION_INPUT_INVALID';
  end if;
  if p_action='SAVE' then
    scope := private.group_acquisition_check(p_root,p_from,p_to,p_measurement,p_action);
    perform pg_advisory_xact_lock(hashtextextended('group-acquisition:'||p_id::text,0));
    select * into entry from private.financial_group_acquisition_evidence where id=p_id;
    if found then
      if entry.created_by<>actor or entry.root_id<>p_root or entry.period_from<>p_from
        or entry.period_to<>p_to or entry.measurement<>p_measurement
        or entry.registry_revision<>scope#>>'{registry,revision}' then raise exception 'GROUP_ACQUISITION_CONFLICT'; end if;
    else
      insert into private.financial_group_acquisition_evidence
        (id,root_id,subsidiary_id,period_from,period_to,control_id,registry_revision,measurement,created_by)
      values (p_id,p_root,(p_measurement->>'subsidiaryOrganizationId')::uuid,p_from,p_to,
        (scope#>>'{assessment,controlAssessmentId}')::uuid,scope#>>'{registry,revision}',p_measurement,actor)
      returning * into entry;
    end if;
  else
    select * into entry from private.financial_group_acquisition_evidence
      where id=p_id and root_id=p_root and period_from=p_from and period_to=p_to for update;
    if not found then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
    if p_action='REVOKE' then
      if not private.financial_opening_can(entry.root_id,'financial_core.approve')
        or not private.financial_opening_can(entry.subsidiary_id,'financial_core.approve')
        or not public.is_organization_admin(entry.root_id) or not public.is_organization_admin(entry.subsidiary_id)
        then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
    else
      scope := private.group_acquisition_check(p_root,p_from,p_to,entry.measurement,
        case when p_action='READ' and entry.status='APPROVED' then 'READ_APPROVED' else p_action end);
      if entry.registry_revision<>scope#>>'{registry,revision}'
        then raise exception 'GROUP_ACQUISITION_CONTROL_CHANGED'; end if;
    end if;
    if p_action in ('APPROVE','REVOKE') and length(trim(coalesce(p_reason,''))) not between 8 and 1000
      then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
    if p_action='APPROVE' then
      if entry.status<>'DRAFT' then raise exception 'GROUP_ACQUISITION_CONFLICT'; end if;
      begin
        update private.financial_group_acquisition_evidence set status='APPROVED', approved_by=actor,
          approved_at=now(), approval_reason=trim(p_reason) where id=p_id returning * into entry;
      exception when unique_violation then raise exception 'GROUP_ACQUISITION_CONFLICT'; end;
    elsif p_action='REVOKE' then
      if entry.status<>'APPROVED' then raise exception 'GROUP_ACQUISITION_CONFLICT'; end if;
      update private.financial_group_acquisition_evidence set status='REVOKED', revoked_by=actor,
        revoked_at=now(), revocation_reason=trim(p_reason) where id=p_id returning * into entry;
    end if;
  end if;
  return to_jsonb(entry);
end $$;

create function public.financial_group_acquisition_evidence_command(
  p_action text, p_id uuid, p_root uuid, p_from date, p_to date, p_measurement jsonb default null, p_reason text default null
)
returns jsonb language sql security invoker set search_path='' as $$
  select private.group_acquisition_evidence_command(p_action,p_id,p_root,p_from,p_to,p_measurement,p_reason)
$$;

revoke all on function private.group_acquisition_check(uuid,date,date,jsonb,text) from public,anon,authenticated;
revoke all on function private.group_acquisition_evidence_command(text,uuid,uuid,date,date,jsonb,text),
  public.financial_group_acquisition_evidence_command(text,uuid,uuid,date,date,jsonb,text) from public,anon,authenticated;
grant execute on function private.group_acquisition_evidence_command(text,uuid,uuid,date,date,jsonb,text),
  public.financial_group_acquisition_evidence_command(text,uuid,uuid,date,date,jsonb,text) to authenticated;
