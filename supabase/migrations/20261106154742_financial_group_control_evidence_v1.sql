-- Versioned legal-control evidence. This does NOT activate consolidation or
-- change source vouchers, opening balances, entity hierarchy or reporting RPCs.
-- The private schema is not part of the Supabase Data API. All user operations
-- must go through the permission-checked commands below.
create table private.financial_group_control_assessments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  parent_organization_id uuid not null references public.organizations(id),
  subsidiary_organization_id uuid not null references public.organizations(id),
  effective_from date not null,
  effective_to date,
  economic_interest_percent numeric(9,6) not null,
  voting_interest_percent numeric(9,6) not null,
  control_basis text not null check (control_basis in ('VOTING','CONTRACTUAL','OTHER')),
  evidence_reference text not null check (length(trim(evidence_reference)) between 8 and 500),
  reason text not null check (length(trim(reason)) between 8 and 1000),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED')),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (parent_organization_id <> subsidiary_organization_id),
  check (effective_to is null or effective_to >= effective_from),
  check (economic_interest_percent > 0 and economic_interest_percent <= 100),
  check (voting_interest_percent >= 0 and voting_interest_percent <= 100),
  check ((status='DRAFT' and approved_by is null and approved_at is null)
      or (status='APPROVED' and approved_by is not null and approved_at is not null))
);

create index financial_control_parent_period
  on private.financial_group_control_assessments(parent_organization_id,effective_from,effective_to)
  where status='APPROVED';
create index financial_control_child_period
  on private.financial_group_control_assessments(subsidiary_organization_id,effective_from,effective_to)
  where status='APPROVED';

create table private.financial_group_control_audit (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references private.financial_group_control_assessments(id),
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('PROPOSE','APPROVE')),
  note text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index financial_control_audit_lookup
  on private.financial_group_control_audit(assessment_id,created_at);

alter table private.financial_group_control_assessments enable row level security;
alter table private.financial_group_control_audit enable row level security;
revoke all on private.financial_group_control_assessments,private.financial_group_control_audit
  from public,anon,authenticated;

create function public.financial_group_control_propose(
  p_parent uuid,p_subsidiary uuid,p_from date,p_to date,
  p_economic numeric,p_voting numeric,p_basis text,
  p_evidence_reference text,p_reason text,p_request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare proposed private.financial_group_control_assessments%rowtype; result_id uuid;
begin
  if auth.uid() is null or p_request_id is null or p_parent is null or p_subsidiary is null
    or p_parent=p_subsidiary
    or not private.financial_opening_can(p_parent,'financial_core.create')
    or not private.financial_opening_can(p_subsidiary,'financial_core.create')
    or not public.is_organization_admin(p_parent)
    or not public.is_organization_admin(p_subsidiary) then
    raise exception 'GROUP_CONTROL_WRITE_DENIED';
  end if;
  if p_from is null or p_to < p_from or p_economic is null or p_economic<=0 or p_economic>100
    or p_voting is null or p_voting<0 or p_voting>100
    or coalesce(p_basis,'') not in ('VOTING','CONTRACTUAL','OTHER')
    or length(trim(coalesce(p_evidence_reference,''))) not between 8 and 500
    or length(trim(coalesce(p_reason,''))) not between 8 and 1000 then
    raise exception 'GROUP_CONTROL_EVIDENCE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-control-request:'||p_request_id::text,0));
  select * into proposed from private.financial_group_control_assessments where request_id=p_request_id;
  if proposed.id is not null then
    if proposed.created_by<>auth.uid() or proposed.parent_organization_id<>p_parent
      or proposed.subsidiary_organization_id<>p_subsidiary or proposed.effective_from<>p_from
      or proposed.effective_to is distinct from p_to or proposed.economic_interest_percent<>p_economic
      or proposed.voting_interest_percent<>p_voting or proposed.control_basis<>p_basis
      or proposed.evidence_reference<>trim(p_evidence_reference) or proposed.reason<>trim(p_reason) then
      raise exception 'GROUP_CONTROL_REQUEST_CONFLICT';
    end if;
    return proposed.id;
  end if;
  insert into private.financial_group_control_assessments (
    request_id,parent_organization_id,subsidiary_organization_id,effective_from,effective_to,
    economic_interest_percent,voting_interest_percent,control_basis,evidence_reference,reason,created_by
  ) values (
    p_request_id,p_parent,p_subsidiary,p_from,p_to,p_economic,p_voting,p_basis,
    trim(p_evidence_reference),trim(p_reason),auth.uid()
  ) returning id into result_id;
  insert into private.financial_group_control_audit (assessment_id,actor_id,action,note)
    values (result_id,auth.uid(),'PROPOSE',trim(p_reason));
  return result_id;
end $$;

create function public.financial_group_control_approve(p_assessment uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare item private.financial_group_control_assessments%rowtype;
begin
  if auth.uid() is null or p_assessment is null then raise exception 'GROUP_CONTROL_APPROVAL_DENIED';end if;
  select * into item from private.financial_group_control_assessments where id=p_assessment;
  if item.id is null or not private.financial_opening_can(item.parent_organization_id,'financial_core.approve')
    or not private.financial_opening_can(item.subsidiary_organization_id,'financial_core.approve')
    or not public.is_organization_admin(item.parent_organization_id)
    or not public.is_organization_admin(item.subsidiary_organization_id) then
    raise exception 'GROUP_CONTROL_APPROVAL_DENIED';
  end if;
  if length(trim(coalesce(p_reason,''))) not between 8 and 1000 then
    raise exception 'GROUP_CONTROL_APPROVAL_REASON_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-control-child:'||item.subsidiary_organization_id::text,0));
  select * into item from private.financial_group_control_assessments where id=p_assessment for update;
  if item.status<>'DRAFT' then raise exception 'GROUP_CONTROL_ALREADY_APPROVED';end if;
  if item.created_by=auth.uid()
    and not (public.can_self_approve_financial_event(item.parent_organization_id)
      and public.can_self_approve_financial_event(item.subsidiary_organization_id)) then
    raise exception 'GROUP_CONTROL_SELF_APPROVAL_DENIED';
  end if;
  if exists (
    select 1 from private.financial_group_control_assessments prior
    where prior.status='APPROVED' and prior.subsidiary_organization_id=item.subsidiary_organization_id
      and daterange(prior.effective_from,prior.effective_to,'[]')
        && daterange(item.effective_from,item.effective_to,'[]')
  ) then raise exception 'GROUP_CONTROL_PERIOD_OVERLAP';end if;
  -- A child cannot control its parent through an existing effective chain.
  if exists (
    with recursive descendants(child_id,path) as (
      select prior.subsidiary_organization_id,
        array[prior.parent_organization_id,prior.subsidiary_organization_id]
      from private.financial_group_control_assessments prior
      where prior.status='APPROVED' and prior.parent_organization_id=item.subsidiary_organization_id
        and daterange(prior.effective_from,prior.effective_to,'[]')
          && daterange(item.effective_from,item.effective_to,'[]')
      union all
      select deeper.subsidiary_organization_id,
        descendants.path||deeper.subsidiary_organization_id
      from descendants join private.financial_group_control_assessments deeper
        on deeper.parent_organization_id=descendants.child_id
      where deeper.status='APPROVED' and not deeper.subsidiary_organization_id=any(descendants.path)
        and daterange(deeper.effective_from,deeper.effective_to,'[]')
          && daterange(item.effective_from,item.effective_to,'[]')
    ) select 1 from descendants where child_id=item.parent_organization_id
  ) then raise exception 'GROUP_CONTROL_CYCLE';end if;

  update private.financial_group_control_assessments
    set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=item.id;
  insert into private.financial_group_control_audit (assessment_id,actor_id,action,note)
    values (item.id,auth.uid(),'APPROVE',trim(p_reason));
  return item.id;
end $$;

-- Evidence inventory only. A caller needs view rights for every returned child,
-- and cannot use this response as a complete group registry or a group P&L.
create function public.financial_group_control_context(p_parent uuid,p_as_of date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare pending integer;children jsonb;
begin
  if p_as_of is null or not private.financial_opening_can(p_parent,'financial_core.view')
    then raise exception 'GROUP_CONTROL_READ_DENIED';end if;
  select count(*) into pending from private.financial_group_control_assessments a
    where a.status='APPROVED' and a.parent_organization_id=p_parent
      and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of)
      and not private.financial_opening_can(a.subsidiary_organization_id,'financial_core.view');
  if pending<>0 then raise exception 'GROUP_CONTROL_READ_DENIED';end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'assessmentId',a.id,'parentOrganizationId',a.parent_organization_id,
    'subsidiaryOrganizationId',a.subsidiary_organization_id,
    'effectiveFrom',a.effective_from,'effectiveTo',a.effective_to,
    'economicInterestPercent',a.economic_interest_percent,
    'votingInterestPercent',a.voting_interest_percent,'controlBasis',a.control_basis,
    'evidenceReference',a.evidence_reference,'approvedAt',a.approved_at
  ) order by a.subsidiary_organization_id),'[]'::jsonb) into children
    from private.financial_group_control_assessments a
    where a.status='APPROVED' and a.parent_organization_id=p_parent
      and a.effective_from<=p_as_of and (a.effective_to is null or a.effective_to>=p_as_of);
  return jsonb_build_object('status','EVIDENCE_ONLY','parentOrganizationId',p_parent,
    'asOf',p_as_of,'relationships',children,'registryComplete',false);
end $$;

revoke all on function public.financial_group_control_propose(uuid,uuid,date,date,numeric,numeric,text,text,text,uuid)
  from public,anon,authenticated;
revoke all on function public.financial_group_control_approve(uuid,text) from public,anon,authenticated;
revoke all on function public.financial_group_control_context(uuid,date) from public,anon,authenticated;
grant execute on function public.financial_group_control_propose(uuid,uuid,date,date,numeric,numeric,text,text,text,uuid)
  to authenticated;
grant execute on function public.financial_group_control_approve(uuid,text) to authenticated;
grant execute on function public.financial_group_control_context(uuid,date) to authenticated;
