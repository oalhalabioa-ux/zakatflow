-- Verified in disposable SQL acceptance. Dated assignments and audited prospective transfers.
create table private.financial_center_branch_assignments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 center_id uuid not null references public.organization_cost_centers(id),
 branch_id uuid references public.organization_entities(id),
 valid_from date not null,
 valid_to date,
 revision bigint not null check(revision>0),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now(),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 check(valid_to is null or valid_to>=valid_from),
 unique(organization_id,revision)
);
alter table private.financial_center_branch_assignments enable row level security;
revoke all on private.financial_center_branch_assignments from public,anon,authenticated;
create index financial_center_branch_period on private.financial_center_branch_assignments(organization_id,center_id,valid_from);

create function public.assign_financial_center_branch(
 p_org uuid,p_center uuid,p_branch uuid,p_from date,p_to date,p_expected_revision bigint,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare revision_ bigint;row_ private.financial_center_branch_assignments%rowtype;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create')
  or not private.financial_opening_can(p_org,'financial_core.approve')
 then raise exception 'CENTER_BRANCH_WRITE_DENIED';end if;
 if p_center is null or p_from is null or p_expected_revision is null or p_expected_revision<0
  or (p_to is not null and p_to<p_from) or length(trim(coalesce(p_reason,''))) not between 1 and 1000
 then raise exception 'CENTER_BRANCH_INPUT_INVALID';end if;
 -- Organization row serializes concurrent assignments, including first insert.
 perform 1 from public.organizations where id=p_org for update;
 perform 1 from public.organization_cost_centers where id=p_center and organization_id=p_org and active for share;
 if not found then raise exception 'CENTER_BRANCH_CENTER_INVALID';end if;
 if p_branch is not null then
  perform 1 from public.organization_entities where id=p_branch and organization_id=p_org and entity_type='BRANCH' and active for share;
  if not found then raise exception 'CENTER_BRANCH_BRANCH_INVALID';end if;
 end if;
 select coalesce(max(revision),0) into revision_ from private.financial_center_branch_assignments where organization_id=p_org;
 if revision_<>p_expected_revision then raise exception 'CENTER_BRANCH_VERSION_CONFLICT';end if;
 if exists(select 1 from private.financial_center_branch_assignments a where a.organization_id=p_org and a.center_id=p_center
  and (a.valid_to is null or a.valid_to>=p_from) and (p_to is null or a.valid_from<=p_to))
 then raise exception 'CENTER_BRANCH_ASSIGNMENT_OVERLAP';end if;
 perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
 if not private.financial_opening_can(p_org,'financial_core.create') or not private.financial_opening_can(p_org,'financial_core.approve')
 then raise exception 'CENTER_BRANCH_WRITE_DENIED';end if;
 insert into private.financial_center_branch_assignments(organization_id,center_id,branch_id,valid_from,valid_to,revision,approved_by,reason)
 values(p_org,p_center,p_branch,p_from,p_to,revision_+1,auth.uid(),trim(p_reason)) returning * into row_;
 return jsonb_build_object('id',row_.id,'revision',row_.revision,'status','APPROVED');
end $$;

create function public.financial_center_branch_registry(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_ jsonb;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'CENTER_BRANCH_READ_DENIED';end if;
 -- Include inactive historical entities. Complete denotes registry enumeration,
 -- not assignment/date coverage; the report compiler checks coverage separately.
 select jsonb_build_object('organizationId',p_org,'complete',true,
  'revision',coalesce((select max(revision) from private.financial_center_branch_assignments where organization_id=p_org),0)::text,
  'branches',coalesce((select jsonb_agg(id order by id) from public.organization_entities where organization_id=p_org and entity_type='BRANCH'),'[]'::jsonb),
  'centerIds',coalesce((select jsonb_agg(id order by id) from public.organization_cost_centers where organization_id=p_org),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'organizationId',organization_id,'centerId',center_id,'branchId',branch_id,
   'from',valid_from,'to',valid_to,'status','APPROVED','approvedBy',approved_by,'revision',revision::text) order by revision)
   from private.financial_center_branch_assignments where organization_id=p_org),'[]'::jsonb)) into result_;
 return result_;
end $$;
revoke all on function public.assign_financial_center_branch(uuid,uuid,uuid,date,date,bigint,text) from public,anon,authenticated;
revoke all on function public.financial_center_branch_registry(uuid) from public,anon,authenticated;
grant execute on function public.assign_financial_center_branch(uuid,uuid,uuid,date,date,bigint,text) to authenticated;
grant execute on function public.financial_center_branch_registry(uuid) to authenticated;

-- Prospective transfers close the old interval and create the next interval
-- atomically. Past assignments and existing financial records are not rewritten.
create table private.financial_center_branch_transfers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 prior_assignment uuid not null references private.financial_center_branch_assignments(id),
 next_assignment uuid not null references private.financial_center_branch_assignments(id),
 previous_record jsonb not null,
 closed_record jsonb not null,
 actor_id uuid not null references auth.users(id),
 reason text not null,
 created_at timestamptz not null default now()
);
alter table private.financial_center_branch_transfers enable row level security;
revoke all on private.financial_center_branch_transfers from public,anon,authenticated;
create function public.transfer_financial_center_branch(
 p_org uuid,p_center uuid,p_branch uuid,p_from date,p_expected_revision bigint,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_ private.financial_center_branch_assignments%rowtype;
 closed_ private.financial_center_branch_assignments%rowtype;
 result_ jsonb;revision_ bigint;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create')
  or not private.financial_opening_can(p_org,'financial_core.approve')
 then raise exception 'CENTER_BRANCH_WRITE_DENIED';end if;
 if p_from is null or p_from<=current_date or p_center is null or p_expected_revision is null
 then raise exception 'CENTER_BRANCH_FUTURE_TRANSFER_REQUIRED';end if;
 perform 1 from public.organizations where id=p_org for update;
 select coalesce(max(revision),0) into revision_ from private.financial_center_branch_assignments where organization_id=p_org;
 if revision_<>p_expected_revision then raise exception 'CENTER_BRANCH_VERSION_CONFLICT';end if;
 select * into prior_ from private.financial_center_branch_assignments
  where organization_id=p_org and center_id=p_center and valid_to is null for update;
 if prior_.id is null or p_from<=prior_.valid_from
 then raise exception 'CENTER_BRANCH_TRANSFER_SOURCE_INVALID';end if;
 if prior_.branch_id is not distinct from p_branch then raise exception 'CENTER_BRANCH_TRANSFER_UNCHANGED';end if;
 update private.financial_center_branch_assignments set valid_to=p_from-1
  where id=prior_.id returning * into closed_;
 -- Existing assignment command enforces scope, active branch/center, reason,
 -- authorization recheck, overlap and revision; failure rolls back interval close.
 result_:=public.assign_financial_center_branch(p_org,p_center,p_branch,p_from,null,p_expected_revision,p_reason);
 insert into private.financial_center_branch_transfers(organization_id,prior_assignment,next_assignment,
  previous_record,closed_record,actor_id,reason)
 values(p_org,prior_.id,(result_->>'id')::uuid,to_jsonb(prior_),to_jsonb(closed_),auth.uid(),trim(p_reason));
 return result_;
end $$;
revoke all on function public.transfer_financial_center_branch(uuid,uuid,uuid,date,bigint,text) from public,anon,authenticated;
grant execute on function public.transfer_financial_center_branch(uuid,uuid,uuid,date,bigint,text) to authenticated;
