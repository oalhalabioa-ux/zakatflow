begin;
set local lock_timeout = '3s';

create table private.feasibility_evidence_feature_switch (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false
);
revoke all on private.feasibility_evidence_feature_switch from public, anon, authenticated, service_role;
insert into private.feasibility_evidence_feature_switch default values;

create table private.feasibility_evidence_documents (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.feasibility_projects(id) on delete cascade,
 kind text not null check (kind in ('licensing', 'valuation')),
 requirement_id text check (requirement_id is null or (kind='licensing' and char_length(requirement_id) between 1 and 100)),
 filename text not null check (char_length(btrim(filename)) between 1 and 160 and filename !~ '[[:cntrl:]/\\]'),
 media_type text not null,
 file_data bytea not null,
 created_at timestamptz not null default now(),
 check (octet_length(file_data) between 5 and 2097152),
 check (
  (media_type = 'application/pdf' and substring(file_data from 1 for 5) = decode('255044462d','hex')) or
  (media_type = 'image/png' and substring(file_data from 1 for 8) = decode('89504e470d0a1a0a','hex')) or
  (media_type = 'image/jpeg' and substring(file_data from 1 for 3) = decode('ffd8ff','hex'))
 )
);

alter table private.feasibility_evidence_documents enable row level security;
revoke all on private.feasibility_evidence_documents from public, anon, authenticated, service_role;
create index feasibility_evidence_project_kind on private.feasibility_evidence_documents(project_id, kind, created_at);

create function public.feasibility_evidence(
 p_action text, p_project uuid, p_kind text, p_organization uuid default null,
 p_document uuid default null, p_filename text default null, p_media_type text default null, p_payload text default null, p_requirement text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := auth.uid();
 is_write boolean := p_action in ('upload','remove');
 result jsonb;
begin
 if actor is null or not exists (select 1 from private.feasibility_evidence_feature_switch where singleton and enabled) or
    p_action is null or p_action not in ('list','download','upload','remove') or
    p_kind is null or p_kind not in ('licensing','valuation') then
  raise exception 'FEASIBILITY_EVIDENCE_FORBIDDEN' using errcode='42501';
 end if;
 if not exists (
  select 1 from public.feasibility_projects p where p.id = p_project
   and p.organization_id is not distinct from p_organization
   and case when p_organization is null then p.owner_user_id = actor and exists (
     select 1 from public.feasibility_access_grants g where g.user_id=actor and g.starts_at<=now()
      and (not is_write or (g.status in ('ACTIVE','TRIAL') and (g.ends_at is null or now()<g.ends_at)))
    )
    else private.feasibility_phase1_org_enabled() and private.feasibility_company_access(p_organization,is_write)
   end
 ) then
  raise exception 'FEASIBILITY_EVIDENCE_FORBIDDEN' using errcode='42501';
 end if;

 if p_action = 'list' then
  return coalesce((
   select jsonb_agg(jsonb_build_object('id',d.id,'name',d.filename,'size',octet_length(d.file_data),
    'createdAt',d.created_at,'requirementId',d.requirement_id) order by d.created_at desc, d.id)
   from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind
  ),'[]'::jsonb);
 end if;
 if p_action = 'download' then
  select jsonb_build_object('name',d.filename,'base64',encode(d.file_data,'base64')) into result
  from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind and d.id=p_document;
  return result;
 end if;
 if p_action = 'remove' then
  delete from private.feasibility_evidence_documents d where d.project_id=p_project and d.kind=p_kind and d.id=p_document
  returning jsonb_build_object('id',d.id) into result;
  return result;
 end if;

 if p_payload is null or length(p_payload) > 2796204 then
  raise exception 'FEASIBILITY_EVIDENCE_INVALID_FILE' using errcode='22023';
 end if;
 if p_requirement is not null then
  if p_kind <> 'licensing' or char_length(p_requirement) not between 1 and 100 then
   raise exception 'FEASIBILITY_EVIDENCE_INVALID_REQUIREMENT' using errcode='22023';
  end if;
  -- Hold the study row while verifying that the attachment refers to a saved requirement.
  perform 1 from public.feasibility_projects p where p.id=p_project and exists (
   select 1 from jsonb_array_elements(
    case when jsonb_typeof(p.study->'legal') = 'array' then p.study->'legal' else '[]'::jsonb end
   ) as item where item->>'id'=p_requirement
  ) for share;
  if not found then
   raise exception 'FEASIBILITY_EVIDENCE_INVALID_REQUIREMENT' using errcode='22023';
  end if;
 end if;
 -- Serialize the document cap across simultaneous uploads to the same study.
 perform pg_advisory_xact_lock(hashtextextended('feasibility-evidence:' || p_project::text,0));
 if (select count(*) from private.feasibility_evidence_documents d where d.project_id=p_project) >= 20 then
  raise exception 'FEASIBILITY_EVIDENCE_LIMIT' using errcode='23514';
 end if;
 insert into private.feasibility_evidence_documents (project_id,kind,requirement_id,filename,media_type,file_data)
 values (p_project,p_kind,p_requirement,p_filename,p_media_type,decode(p_payload,'base64'))
 returning jsonb_build_object('id',id,'name',filename,'size',octet_length(file_data),'createdAt',created_at,'requirementId',requirement_id) into result;
 return result;
end;
$$;
revoke all on function public.feasibility_evidence(text,uuid,text,uuid,uuid,text,text,text,text)
 from public, anon, authenticated, service_role;
grant execute on function public.feasibility_evidence(text,uuid,text,uuid,uuid,text,text,text,text) to authenticated;

commit;
