-- Validated in disposable full-schema CI; no hosted application implied.
-- Audited, versioned distribution of already APPROVED organization opening
-- lines between legal-company headquarters (branchId=null) and operating branches.
-- Additive only: never posts GL lines or updates opening vouchers. Independent dimensional allocation storage.
create table private.financial_dimensional_opening_distributions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 fiscal_start date not null,
 opening_workspace_id uuid not null references public.financial_opening_workspaces(id),
 opening_version integer not null check(opening_version>0),
 opening_digest text not null check(opening_digest ~ '^[0-9a-f]{32}$'),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'DRAFT' check(status in('DRAFT','APPROVED','SUPERSEDED')),
 version integer not null default 1 check(version>0),
 entries jsonb not null default '{}'::jsonb check(jsonb_typeof(entries)='object'),
 reason text not null default '',
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status='DRAFT' and approved_by is null and approved_at is null)
 or (status<>'DRAFT' and approved_by is not null and approved_at is not null))
);
create unique index financial_dimensional_opening_one_draft
 on private.financial_dimensional_opening_distributions(organization_id,fiscal_start) where status='DRAFT';
create unique index financial_dimensional_opening_one_approved
 on private.financial_dimensional_opening_distributions(organization_id,fiscal_start) where status='APPROVED';
create index financial_dimensional_opening_workspace_lookup
 on private.financial_dimensional_opening_distributions(opening_workspace_id,opening_version);

create table private.financial_dimensional_opening_audit (
 id bigint generated always as identity primary key,
 distribution_id uuid not null references private.financial_dimensional_opening_distributions(id),
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in('SAVE','APPROVE','SUPERSEDE')),
 version integer not null,
 details jsonb not null,
 created_at timestamptz not null default now()
);
alter table private.financial_dimensional_opening_distributions enable row level security;
alter table private.financial_dimensional_opening_audit enable row level security;
revoke all on private.financial_dimensional_opening_distributions,private.financial_dimensional_opening_audit
 from public,anon,authenticated;

-- Approved company openings contain ONE row per canonical source itemId, not
-- necessarily one per reporting account. Preserve item identity and prevent
-- more than one allocation of the same item to the same reporting segment.
create function private.financial_dimensional_opening_check(
 p_org uuid,p_opening jsonb,p_entries jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item jsonb; parts jsonb; split jsonb; item_id text; seg_id text;
  center_key text; branch_key text; center_branches jsonb:='{}'::jsonb;
  seen_items text[]:='{}';seen_segments text[];found_count integer:=0;
  d numeric;c numeric;ed numeric;ec numeric;sum_d numeric;sum_c numeric;
  org_d numeric:=0;org_c numeric:=0;total_d numeric:=0;
  totals jsonb:='{}'::jsonb; key text;
begin
 if jsonb_typeof(p_opening) is distinct from 'array'
    or jsonb_typeof(p_entries) is distinct from 'object'
    or jsonb_array_length(p_opening)>20000
    or octet_length(p_entries::text)>2000000
 then raise exception 'DIMENSION_OPENING_INPUT_INVALID';end if;
 for item in select value from jsonb_array_elements(p_opening) loop
  item_id:=item->>'itemId';
  if item_id is null or length(item_id)>200 or item_id=any(seen_items)
    or item->>'accountCode' is null
    or coalesce(item->>'debit','') !~ '^\d{1,20}(\.\d{1,4})?$'
    or coalesce(item->>'credit','') !~ '^\d{1,20}(\.\d{1,4})?$'
  then raise exception 'DIMENSION_OPENING_SOURCE_INVALID';end if;
  seen_items:=array_append(seen_items,item_id);
  d:=(item->>'debit')::numeric;c:=(item->>'credit')::numeric;
  if d>0 and c>0 then raise exception 'DIMENSION_OPENING_SOURCE_INVALID';end if;
  org_d:=org_d+d;org_c:=org_c+c;
  parts:=p_entries->item_id;
  if jsonb_typeof(parts) is distinct from 'array' or jsonb_array_length(parts)<1
     or jsonb_array_length(parts)>1001
  then raise exception 'DIMENSION_OPENING_DISTRIBUTION_INCOMPLETE';end if;
  seen_segments:='{}';sum_d:=0;sum_c:=0;
  for split in select value from jsonb_array_elements(parts) loop
   if jsonb_typeof(split) is distinct from 'object'
     or not (split?'branchId' and split?'centerId' and split?'debit' and split?'credit')
     or (select count(*) from jsonb_object_keys(split))<>4
     or coalesce(split->>'debit','') !~ '^\d{1,20}(\.\d{1,4})?$'
     or coalesce(split->>'credit','') !~ '^\d{1,20}(\.\d{1,4})?$'
   then raise exception 'DIMENSION_OPENING_DISTRIBUTION_INVALID';end if;
   if jsonb_typeof(split->'branchId')='null' then
    seg_id:='__HQ__';
   elsif jsonb_typeof(split->'branchId')='string'
       and (split->>'branchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and exists(select 1 from public.organization_entities e
         where e.id=(split->>'branchId')::uuid and e.organization_id=p_org
           and e.entity_type='BRANCH' and e.active)
   then seg_id:=split->>'branchId';
   else raise exception 'DIMENSION_OPENING_BRANCH_INVALID';end if;
   branch_key:=seg_id;
   if jsonb_typeof(split->'centerId')='null' then center_key:='__UNALLOCATED__';
   elsif jsonb_typeof(split->'centerId')='string'
    and (split->>'centerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists(select 1 from public.organization_cost_centers c
      where c.id=(split->>'centerId')::uuid and c.organization_id=p_org and c.active)
   then center_key:=split->>'centerId';
   else raise exception 'DIMENSION_OPENING_CENTER_INVALID';end if;
   if center_key<>'__UNALLOCATED__' then
    if center_branches?center_key and center_branches->>center_key<>branch_key
    then raise exception 'DIMENSION_OPENING_CENTER_BRANCH_CONFLICT';end if;
    center_branches:=center_branches||jsonb_build_object(center_key,branch_key);
   end if;
   seg_id:=branch_key||':'||center_key;
   if seg_id=any(seen_segments) then raise exception 'DIMENSION_OPENING_DUPLICATE_BRANCH';end if;
   seen_segments:=array_append(seen_segments,seg_id);
   ed:=(split->>'debit')::numeric;ec:=(split->>'credit')::numeric;
   if (ed>0 and ec>0) or (d=0 and ed<>0) or (c=0 and ec<>0)
    then raise exception 'DIMENSION_OPENING_DISTRIBUTION_INVALID';end if;
   sum_d:=sum_d+ed;sum_c:=sum_c+ec;
   if not (totals?seg_id) then
    totals:=totals||jsonb_build_object(seg_id,jsonb_build_object('debit','0','credit','0'));
   end if;
   totals:=jsonb_set(totals,array[seg_id,'debit'],
     to_jsonb(((totals->seg_id->>'debit')::numeric+ed)::text));
   totals:=jsonb_set(totals,array[seg_id,'credit'],
     to_jsonb(((totals->seg_id->>'credit')::numeric+ec)::text));
  end loop;
  if sum_d<>d or sum_c<>c then raise exception 'DIMENSION_OPENING_DISTRIBUTION_MISMATCH';end if;
  found_count:=found_count+1;
 end loop;
 if found_count<>(select count(*) from jsonb_object_keys(p_entries)) then
  raise exception 'DIMENSION_OPENING_UNRECOGNIZED_LINE';end if;
 if org_d<>org_c then raise exception 'DIMENSION_OPENING_SOURCE_UNBALANCED';end if;
 for key in select jsonb_object_keys(totals) loop
  if (totals->key->>'debit')::numeric<>(totals->key->>'credit')::numeric
  then raise exception 'DIMENSION_OPENING_SEGMENT_UNBALANCED';end if;
  total_d:=total_d+(totals->key->>'debit')::numeric;
 end loop;
 if total_d<>org_d then raise exception 'DIMENSION_OPENING_TOTAL_MISMATCH';end if;
 return jsonb_build_object('kind','RECONCILED_APPROVED_OPENING_DISTRIBUTION',
  'sourceItems',found_count,'openingDebit',org_d::numeric(24,4)::text,
  'openingCredit',org_c::numeric(24,4)::text,'segments',totals);
end $$;
revoke all on function private.financial_dimensional_opening_check(uuid,jsonb,jsonb)
 from public,anon,authenticated;

-- Draft updates are optimistic-concurrency checked; this RPC cannot approve.
create function public.save_financial_dimensional_opening(
 p_org uuid,p_fiscal_start date,p_expected_version integer,
 p_opening_workspace uuid,p_opening_version integer,p_entries jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.financial_opening_workspaces%rowtype;
 row_ private.financial_dimensional_opening_distributions%rowtype;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create')
 then raise exception 'DIMENSION_OPENING_WRITE_DENIED';end if;
 if p_fiscal_start is null or p_expected_version is null or p_expected_version<0
    or p_opening_workspace is null or p_opening_version is null or p_opening_version<1
    or jsonb_typeof(p_entries) is distinct from 'object'
    or octet_length(p_entries::text)>2000000
    or length(coalesce(p_reason,''))>1000
 then raise exception 'DIMENSION_OPENING_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(
   'reporting-opening:'||p_org::text||p_fiscal_start::text,0));
 select * into original from public.financial_opening_workspaces
  where id=p_opening_workspace and organization_id=p_org
   and fiscal_start=p_fiscal_start and status='APPROVED' for share;
 if original.id is null or original.version<>p_opening_version
    or jsonb_typeof(original.approved_opening) is distinct from 'array'
 then raise exception 'DIMENSION_OPENING_SOURCE_CHANGED';end if;
 select * into row_ from private.financial_dimensional_opening_distributions
  where organization_id=p_org and fiscal_start=p_fiscal_start
   and status='DRAFT' for update;
 if coalesce(row_.version,0)<>p_expected_version then
  raise exception 'DIMENSION_OPENING_VERSION_CONFLICT';end if;
 if row_.id is null then
  insert into private.financial_dimensional_opening_distributions(
   organization_id,fiscal_start,opening_workspace_id,opening_version,
   opening_digest,currency,entries,reason,created_by,updated_by)
  values(p_org,p_fiscal_start,original.id,original.version,
   md5(original.approved_opening::text),original.currency,p_entries,
   coalesce(p_reason,''),auth.uid(),auth.uid()) returning * into row_;
 else
  update private.financial_dimensional_opening_distributions
  set opening_workspace_id=original.id,opening_version=original.version,
   opening_digest=md5(original.approved_opening::text),currency=original.currency,
   entries=p_entries,reason=coalesce(p_reason,''),version=version+1,
   updated_by=auth.uid(),updated_at=now()
  where id=row_.id returning * into row_;
 end if;
 insert into private.financial_dimensional_opening_audit(
  distribution_id,organization_id,actor_id,action,version,details)
  values(row_.id,p_org,auth.uid(),'SAVE',row_.version,
   jsonb_build_object('openingWorkspace',original.id,
   'openingVersion',original.version,'reason',row_.reason));
 return jsonb_build_object('id',row_.id,'status',row_.status,'version',row_.version,
  'openingVersion',row_.opening_version,'openingDigest',row_.opening_digest);
end $$;

create function public.approve_financial_dimensional_opening(
 p_distribution uuid,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare row_ private.financial_dimensional_opening_distributions%rowtype;
 original public.financial_opening_workspaces%rowtype;
 control jsonb; volume numeric; prior uuid;
begin
 if auth.uid() is null or p_distribution is null or p_expected_version is null
 then raise exception 'DIMENSION_OPENING_APPROVE_DENIED';end if;
 select * into row_ from private.financial_dimensional_opening_distributions
   where id=p_distribution;
 if row_.id is null
    or not private.financial_opening_can(row_.organization_id,'financial_core.approve')
    or not private.financial_opening_can(row_.organization_id,'financial_core.post')
 then raise exception 'DIMENSION_OPENING_APPROVE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(
  'reporting-opening:'||row_.organization_id::text||row_.fiscal_start::text,0));
 select * into row_ from private.financial_dimensional_opening_distributions
  where id=p_distribution for update;
 if row_.status<>'DRAFT' or row_.version<>p_expected_version
 then raise exception 'DIMENSION_OPENING_VERSION_CONFLICT';end if;
 select * into original from public.financial_opening_workspaces
  where id=row_.opening_workspace_id and organization_id=row_.organization_id
   and fiscal_start=row_.fiscal_start and status='APPROVED' for share;
 if original.id is null or original.version<>row_.opening_version
    or original.currency<>row_.currency
    or md5(original.approved_opening::text)<>row_.opening_digest
 then raise exception 'DIMENSION_OPENING_SOURCE_CHANGED';end if;
 perform 1 from public.organization_cost_centers
  where organization_id=row_.organization_id for share;
 -- Lock registry during validation to prevent branch deactivation races.
 perform 1 from public.organization_entities
  where organization_id=row_.organization_id for share;
 perform 1 from public.organization_members
  where organization_id=row_.organization_id and user_id=auth.uid() for share;
 if not private.financial_opening_can(row_.organization_id,'financial_core.approve')
    or not private.financial_opening_can(row_.organization_id,'financial_core.post')
 then raise exception 'DIMENSION_OPENING_APPROVE_DENIED';end if;
 control:=private.financial_dimensional_opening_check(
   row_.organization_id,original.approved_opening,row_.entries);
 volume:=(control->>'openingDebit')::numeric;
 if not public.effective_organization_permission(
   row_.organization_id,'financial_core.approve',volume,row_.currency)
    or not public.effective_organization_permission(
   row_.organization_id,'financial_core.post',volume,row_.currency)
 then raise exception 'DIMENSION_OPENING_APPROVE_DENIED';end if;
 if row_.created_by=auth.uid() or row_.updated_by=auth.uid() then
  if not public.can_self_approve_financial_event(row_.organization_id)
  then raise exception 'DIMENSION_OPENING_SELF_APPROVAL_DENIED';end if;
 end if;
 if exists(select 1 from private.financial_dimensional_opening_distributions
   where organization_id=row_.organization_id and fiscal_start=row_.fiscal_start
   and status='APPROVED') and length(trim(row_.reason))<8
 then raise exception 'DIMENSION_OPENING_SUPERSESSION_REASON_REQUIRED';end if;
 for prior in update private.financial_dimensional_opening_distributions
  set status='SUPERSEDED',updated_at=now()
  where organization_id=row_.organization_id and fiscal_start=row_.fiscal_start
   and status='APPROVED' returning id loop
  insert into private.financial_dimensional_opening_audit(
   distribution_id,organization_id,actor_id,action,version,details)
   values(prior,row_.organization_id,auth.uid(),'SUPERSEDE',row_.version,
     jsonb_build_object('replacement',row_.id,'reason',row_.reason));
 end loop;
 update private.financial_dimensional_opening_distributions
  set status='APPROVED',approved_by=auth.uid(),approved_at=now(),
   version=version+1,updated_by=auth.uid(),updated_at=now()
  where id=row_.id returning * into row_;
 insert into private.financial_dimensional_opening_audit(
  distribution_id,organization_id,actor_id,action,version,details)
  values(row_.id,row_.organization_id,auth.uid(),'APPROVE',row_.version,control);
 return jsonb_build_object('id',row_.id,'status','APPROVED',
  'version',row_.version,'openingVersion',row_.opening_version,
  'openingDigest',row_.opening_digest,'control',control);
end $$;

-- Read-only authorized manifest. Opening supersession makes an old approved
-- distribution explicitly STALE. This NEVER certifies complete journal attribution.
create function public.financial_dimensional_opening_context(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row_ private.financial_dimensional_opening_distributions%rowtype;
 original public.financial_opening_workspaces%rowtype;
 fresh boolean;
begin
 if not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'DIMENSION_OPENING_READ_DENIED';end if;
 select * into row_ from private.financial_dimensional_opening_distributions
  where organization_id=p_org and fiscal_start=p_fiscal_start
   and status in('DRAFT','APPROVED')
  order by case when status='DRAFT' then 0 else 1 end limit 1;
 if row_.id is null then return jsonb_build_object('status','MISSING');end if;
 select * into original from public.financial_opening_workspaces
  where id=row_.opening_workspace_id and organization_id=p_org
   and fiscal_start=p_fiscal_start and status='APPROVED';
 fresh:=original.id is not null and original.version=row_.opening_version
   and original.currency=row_.currency
   and md5(original.approved_opening::text)=row_.opening_digest;
 if not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'DIMENSION_OPENING_READ_DENIED';end if;
 return jsonb_build_object('status',case when fresh then row_.status else 'STALE' end,
  'kind','DIMENSION_OPENING_DISTRIBUTION_EVIDENCE_ONLY',
  'id',row_.id,'version',row_.version,'fiscalStart',row_.fiscal_start,
  'organizationId',p_org,'openingWorkspaceId',row_.opening_workspace_id,
  'openingVersion',row_.opening_version,'openingDigest',row_.opening_digest,
  'entries',row_.entries,'approvedBy',row_.approved_by,
  'approvedAt',row_.approved_at,'journalCoverageComplete',false);
end $$;
revoke all on function public.save_financial_dimensional_opening(uuid,date,integer,uuid,integer,jsonb,text)
 from public,anon,authenticated;
revoke all on function public.approve_financial_dimensional_opening(uuid,integer)
 from public,anon,authenticated;
revoke all on function public.financial_dimensional_opening_context(uuid,date)
 from public,anon,authenticated;
grant execute on function public.save_financial_dimensional_opening(uuid,date,integer,uuid,integer,jsonb,text)
 to authenticated;
grant execute on function public.approve_financial_dimensional_opening(uuid,integer)
 to authenticated;
grant execute on function public.financial_dimensional_opening_context(uuid,date)
 to authenticated;
