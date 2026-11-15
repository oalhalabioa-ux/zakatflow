create table private.financial_group_acquisition_documents (
  id uuid primary key,
  root_id uuid not null references public.organizations(id),
  subsidiary_id uuid not null references public.organizations(id),
  control_id uuid not null references private.financial_group_control_assessments(id),
  title text not null,
  contents bytea not null check (octet_length(contents) between 16 and 2097152),
  sha256 text generated always as (encode(sha256(contents),'hex')) stored,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now()
);
alter table private.financial_group_acquisition_documents enable row level security;
revoke all on private.financial_group_acquisition_documents from public,anon,authenticated;

create function private.group_acquisition_document_command(
  p_id uuid,p_root uuid,p_subsidiary uuid,p_from date,p_to date,p_title text,p_pdf text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  scope jsonb;
  assessment uuid;
  uploaded private.financial_group_acquisition_documents%rowtype;
  contents bytea;
begin
  if auth.uid() is null or p_id is null or p_subsidiary is null then
    raise exception 'GROUP_ACQUISITION_ACCESS_DENIED';
  end if;
  scope := public.financial_group_registered_scope(p_root,p_from,p_to);
  select (r->>'controlAssessmentId')::uuid into assessment
    from jsonb_array_elements(scope->'relationships') r
    where r->>'parentOrganizationId'=p_root::text and r->>'subsidiaryOrganizationId'=p_subsidiary::text
      and (r->>'effectiveFrom')::date<=p_from and coalesce((r->>'effectiveTo')::date,p_to)>=p_to;
  if assessment is null then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
  if p_pdf is not null then
    if not private.financial_opening_can(p_root,'financial_core.create')
      or not private.financial_opening_can(p_subsidiary,'financial_core.create')
      or not public.is_organization_admin(p_root) or not public.is_organization_admin(p_subsidiary)
      then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
    if length(trim(coalesce(p_title,''))) not between 1 and 200 or length(p_pdf)>2796204
      then raise exception 'GROUP_ACQUISITION_DOCUMENT_INVALID'; end if;
    begin
      contents := decode(p_pdf,'base64');
    exception when invalid_parameter_value or invalid_text_representation then
      raise exception 'GROUP_ACQUISITION_DOCUMENT_INVALID';
    end;
    if octet_length(contents) not between 16 and 2097152 or substring(contents from 1 for 5)<>decode('255044462d','hex')
      then raise exception 'GROUP_ACQUISITION_DOCUMENT_INVALID'; end if;
    insert into private.financial_group_acquisition_documents
      (id,root_id,subsidiary_id,control_id,title,contents,uploaded_by)
      values (p_id,p_root,p_subsidiary,assessment,trim(p_title),contents,auth.uid())
      on conflict (id) do nothing;
  end if;
  select * into uploaded from private.financial_group_acquisition_documents
    where id=p_id and root_id=p_root and subsidiary_id=p_subsidiary and control_id=assessment;
  if not found then raise exception 'GROUP_ACQUISITION_ACCESS_DENIED'; end if;
  if p_pdf is not null and (uploaded.uploaded_by<>auth.uid() or uploaded.contents<>contents or uploaded.title<>trim(p_title))
    then raise exception 'GROUP_ACQUISITION_CONFLICT'; end if;
  return jsonb_build_object('id',uploaded.id,'title',uploaded.title,'sha256',uploaded.sha256)
    || case when p_pdf is null then jsonb_build_object('pdf',encode(uploaded.contents,'base64')) else '{}'::jsonb end;
end $$;

create function public.financial_group_acquisition_document_command(
  p_id uuid,p_root uuid,p_subsidiary uuid,p_from date,p_to date,p_title text default null,p_pdf text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.group_acquisition_document_command(p_id,p_root,p_subsidiary,p_from,p_to,p_title,p_pdf)
$$;
revoke all on function private.group_acquisition_document_command(uuid,uuid,uuid,date,date,text,text),
  public.financial_group_acquisition_document_command(uuid,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function private.group_acquisition_document_command(uuid,uuid,uuid,date,date,text,text),
  public.financial_group_acquisition_document_command(uuid,uuid,uuid,date,date,text,text) to authenticated;

create table private.financial_group_acquisition_evidence (
  id uuid primary key,
  root_id uuid not null references public.organizations(id),
  subsidiary_id uuid not null references public.organizations(id),
  period_from date not null,
  period_to date not null,
  control_id uuid not null references private.financial_group_control_assessments(id),
  registry_revision text not null,
  measurement jsonb not null,
  documents jsonb not null,
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

-- The supported evidence shape is a dedicated investment leaf with one
-- acquisition-day debit and no other opening balance or movement by that date.
create function private.group_acquisition_investment_check(p_root uuid,p_measurement jsonb)
returns void language plpgsql stable security invoker set search_path='' as $$
declare
  link jsonb := p_measurement->'investmentLink';
  acquisition_day date := (p_measurement->>'acquisitionDate')::date;
  account_code text := link->>'accountId';
  amount numeric := (p_measurement->>'consideration')::numeric;
  source jsonb;
  posting_count integer;
  matched_count integer;
begin
  if link is null then return; end if;
  if jsonb_typeof(link) is distinct from 'object'
    or link - array['accountId','eventId','lineId','documentId'] <> '{}'::jsonb
    or coalesce(account_code,'') !~ '^1600([0-9]{2}){1,3}$'
    or coalesce(link->>'eventId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or length(coalesce(link->>'lineId','')) not between 1 and 200
    or amount<=0 then raise exception 'GROUP_ACQUISITION_INVESTMENT_LINK_INVALID'; end if;
  source := public.financial_statement_live_snapshot(p_root,acquisition_day,acquisition_day);
  if source->>'organizationId' is distinct from p_root::text
    or source->>'from' is distinct from acquisition_day::text
    or source->>'to' is distinct from acquisition_day::text
    or source->>'currency' is distinct from p_measurement->>'currency'
    or source->>'origin' is distinct from 'LIVE_CANONICAL_EVENTS'
    or source#>>'{coverage,complete}' is distinct from 'true'
    or source#>>'{coverage,scope}' is distinct from 'ORGANIZATION_ALL_ENTITIES'
    or not exists(select 1 from jsonb_array_elements(source->'accounts') a
      where a->>'id'=account_code and a->>'reportingCode'='1600' and a->>'kind'='ASSET'
        and a->>'organizationId'=p_root::text and coalesce(a->>'cash','false')='false')
    then raise exception 'GROUP_ACQUISITION_INVESTMENT_SOURCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(source->'opening') o
    where o->>'accountId'=account_code and ((o->>'debit')::numeric<>0 or (o->>'credit')::numeric<>0))
    then raise exception 'GROUP_ACQUISITION_INVESTMENT_SOURCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(source->'events') e
    cross join lateral jsonb_array_elements(e->'lines') l
    where e->>'status' in ('ACTUAL','REVERSED') and e->>'date'<=acquisition_day::text
      and (l#>>'{resolvedPosting,debitAccountId}' is null or l#>>'{resolvedPosting,creditAccountId}' is null))
    then raise exception 'GROUP_ACQUISITION_INVESTMENT_SOURCE_INVALID'; end if;
  select count(*),count(*) filter(where e->>'id'=link->>'eventId' and l->>'id'=link->>'lineId'
    and e->>'date'=acquisition_day::text and e->>'status'='ACTUAL'
    and l#>>'{resolvedPosting,debitAccountId}'=account_code and l->>'recognitionSign'='1'
    and (l->>'baseAmount')::numeric=amount)
  into posting_count,matched_count from jsonb_array_elements(source->'events') e
  cross join lateral jsonb_array_elements(e->'lines') l
  where e->>'status' in ('ACTUAL','REVERSED') and e->>'date'<=acquisition_day::text
    and account_code in(l#>>'{resolvedPosting,debitAccountId}',l#>>'{resolvedPosting,creditAccountId}');
  if posting_count<>1 or matched_count<>1
    then raise exception 'GROUP_ACQUISITION_INVESTMENT_UNRECONCILED'; end if;
end $$;
revoke all on function private.group_acquisition_investment_check(uuid,jsonb) from public,anon,authenticated;

create unique index financial_group_acquisition_active_investment
  on private.financial_group_acquisition_evidence(root_id,(measurement#>>'{investmentLink,accountId}'))
  where status='APPROVED' and measurement ? 'investmentLink';

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
  document_refs text[];
  schedule jsonb;
  document_manifest jsonb;
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
    or p_measurement - array['parentOrganizationId','subsidiaryOrganizationId','currency','acquisitionDate','transactionType','commonControl','instruments','consideration','considerationEvidence','identifiableItems','nci','investmentLink','fairValueBasis','continuityBasis'] <> '{}'::jsonb
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
  document_refs := array[p_measurement->>'considerationEvidence'] ||
    array(select value->>'measurementEvidence' from jsonb_array_elements(p_measurement->'identifiableItems'));
  if nci->>'method'='FAIR_VALUE' then
    document_refs := array_append(document_refs,nci->>'valuationEvidence');
  end if;
  if p_measurement ? 'investmentLink' then
    document_refs := array_append(document_refs,p_measurement#>>'{investmentLink,documentId}');
    perform private.group_acquisition_investment_check(p_root,p_measurement);
  end if;
  if p_measurement ? 'fairValueBasis' then
    item := p_measurement->'fairValueBasis';
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['deferredTax','taxEvidenceDocumentId'] <> '{}'::jsonb
      or coalesce(item->>'deferredTax','') not in ('NOT_REQUIRED','INCLUDED_IN_IDENTIFIABLE_ITEMS')
      or jsonb_typeof(item->'taxEvidenceDocumentId') is distinct from 'string'
      then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
    document_refs := array_append(document_refs,item->>'taxEvidenceDocumentId');
  end if;
  if p_measurement ? 'continuityBasis' then
    item := p_measurement->'continuityBasis';
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['treatment','evidenceDocumentId','schedules'] <> '{}'::jsonb
      or coalesce(item->>'treatment','') not in ('NO_SUBSEQUENT_ADJUSTMENTS','STRAIGHT_LINE_UPLIFT')
      or jsonb_typeof(item->'evidenceDocumentId') is distinct from 'string'
      then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
    if item->>'treatment'='STRAIGHT_LINE_UPLIFT' then
      if jsonb_typeof(item->'schedules') is distinct from 'array'
        then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
      if jsonb_array_length(item->'schedules') not between 1 and 100
        or (select count(distinct value->>'accountId') from jsonb_array_elements(item->'schedules'))<>
          jsonb_array_length(item->'schedules') then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
      for schedule in select value from jsonb_array_elements(item->'schedules') loop
        if jsonb_typeof(schedule) is distinct from 'object'
          or schedule - array['accountId','usefulLifeDays','deferredTaxLiabilityAccountId'] <> '{}'::jsonb
          or coalesce(schedule->>'accountId','') !~ '^1500([0-9]{2}){0,3}$'
          or (schedule ? 'deferredTaxLiabilityAccountId' and
            (jsonb_typeof(schedule->'deferredTaxLiabilityAccountId') is distinct from 'string'
             or coalesce(schedule->>'deferredTaxLiabilityAccountId','') !~ '^[0-9]{4}([0-9]{2}){0,3}$'))
          or jsonb_typeof(schedule->'usefulLifeDays') is distinct from 'number'
          or coalesce(schedule->>'usefulLifeDays','') !~ '^[0-9]{1,5}$'
          then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
        if (schedule->>'usefulLifeDays')::integer not between 1 and 36500
          then raise exception 'GROUP_ACQUISITION_INPUT_INVALID'; end if;
      end loop;
    elsif item ? 'schedules' then raise exception 'GROUP_ACQUISITION_INPUT_INVALID';
    end if;
    document_refs := array_append(document_refs,item->>'evidenceDocumentId');
  end if;
  if exists(select 1 from unnest(document_refs) ref where ref is null or
    ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'GROUP_ACQUISITION_DOCUMENT_REQUIRED';
  end if;
  select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'sha256',d.sha256) order by d.id)
    into document_manifest
    from private.financial_group_acquisition_documents d
    where d.id=any(document_refs::uuid[]) and d.root_id=p_root and d.subsidiary_id=subsidiary
      and d.control_id=(relationship->>'controlAssessmentId')::uuid;
  if coalesce(jsonb_array_length(document_manifest),0)<>(select count(distinct ref) from unnest(document_refs) ref)
    then raise exception 'GROUP_ACQUISITION_DOCUMENT_REQUIRED'; end if;

  if p_action in ('APPROVE','READ_APPROVED') and consideration + minority < net_assets then
    raise exception 'GROUP_ACQUISITION_REASSESSMENT_REQUIRED';
  end if;

  for member in select value::uuid from jsonb_array_elements_text(scope->'expectedOrganizationIds') loop
    snapshot := public.financial_statement_live_snapshot(member,p_from,p_to);
    if snapshot->>'currency' is distinct from p_measurement->>'currency' then
      raise exception 'GROUP_ACQUISITION_FX_REQUIRED';
    end if;
  end loop;
  return scope || jsonb_build_object('assessment',relationship,'documents',document_manifest);
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
        (id,root_id,subsidiary_id,period_from,period_to,control_id,registry_revision,measurement,documents,created_by)
      values (p_id,p_root,(p_measurement->>'subsidiaryOrganizationId')::uuid,p_from,p_to,
        (scope#>>'{assessment,controlAssessmentId}')::uuid,scope#>>'{registry,revision}',p_measurement,scope->'documents',actor)
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
      if entry.documents is distinct from scope->'documents' then raise exception 'GROUP_ACQUISITION_DOCUMENT_CHANGED'; end if;
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

create function private.group_approved_acquisition_evidence(p_root uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  entry private.financial_group_acquisition_evidence%rowtype;
  scope jsonb;
  verified jsonb;
  result jsonb := '[]'::jsonb;
  subsidiary_name text;
begin
  scope := public.financial_group_registered_scope(p_root,p_from,p_to);
  for entry in select * from private.financial_group_acquisition_evidence
    where root_id=p_root and period_from=p_from and period_to=p_to and status='APPROVED'
    order by subsidiary_id,id
  loop
    verified := private.group_acquisition_check(p_root,p_from,p_to,entry.measurement,'READ_APPROVED');
    if entry.registry_revision is distinct from verified#>>'{registry,revision}' then
      raise exception 'GROUP_ACQUISITION_CONTROL_CHANGED';
    end if;
    if entry.documents is distinct from verified->'documents' then
      raise exception 'GROUP_ACQUISITION_DOCUMENT_CHANGED';
    end if;
    select name into subsidiary_name from public.organizations where id=entry.subsidiary_id;
    result := result || jsonb_build_array(jsonb_build_object(
      'id',entry.id,'subsidiaryName',subsidiary_name,'controlId',entry.control_id,
      'approvedAt',entry.approved_at,'measurement',entry.measurement,'documents',entry.documents
    ));
  end loop;
  return jsonb_build_object('rootOrganizationId',p_root,'from',p_from,'to',p_to,
    'registryRevision',scope#>>'{registry,revision}','records',result);
end $$;

create function public.financial_group_approved_acquisition_evidence(p_root uuid,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.group_approved_acquisition_evidence(p_root,p_from,p_to)
$$;
revoke all on function private.group_approved_acquisition_evidence(uuid,date,date),
  public.financial_group_approved_acquisition_evidence(uuid,date,date) from public,anon,authenticated;
grant execute on function private.group_approved_acquisition_evidence(uuid,date,date),
  public.financial_group_approved_acquisition_evidence(uuid,date,date) to authenticated;

-- A partially owned subsidiary may use an empty evidence batch only when
-- its approved acquisition is bound to the exact current group and period.
-- Nonempty adjustment batches retain their existing ownership restriction.
do $$
declare
  definition text := pg_get_functiondef('private.financial_group_batch_evidence(uuid,date,date,jsonb,boolean)'::regprocedure);
  guard text := $guard$if (relation->>'directEconomicInterestPercent')::numeric<>100 then raise exception 'GROUP_BATCH_NCI_REQUIRED';end if;$guard$;
  replacement text := $replacement$if (relation->>'directEconomicInterestPercent')::numeric<>100 and (
    jsonb_array_length(p_entries)<>0 or not exists(
      select 1 from private.financial_group_acquisition_evidence acquisition
      where acquisition.root_id=p_root and acquisition.period_from=p_from and acquisition.period_to=p_to
        and acquisition.control_id::text=relation->>'controlAssessmentId'
        and acquisition.registry_revision=control#>>'{registry,revision}'
        and acquisition.status='APPROVED' and acquisition.measurement ? 'investmentLink'
    )
  ) then raise exception 'GROUP_BATCH_NCI_REQUIRED';end if;$replacement$;
begin
  if strpos(definition,guard)=0 then raise exception 'GROUP_BATCH_NCI_GUARD_NOT_FOUND'; end if;
  execute replace(definition,guard,replacement);
end $$;
