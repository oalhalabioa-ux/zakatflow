-- Feasibility phase 1 for a database without the QA-only feasibility schema.
-- Application feasibility flags remain off until a separate rollout.
begin;

create table public.feasibility_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('TRIAL','ACTIVE','READ_ONLY','SUSPENDED','CANCELLED')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  source text not null default 'PLATFORM_ADMIN' check (source in ('PLATFORM_ADMIN','PAID_PLAN','TRIAL')),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint feasibility_access_positive_window check (ends_at is null or ends_at > starts_at)
);
alter table public.feasibility_access_grants enable row level security;
revoke all on table public.feasibility_access_grants from public, anon, authenticated, service_role;
grant select on table public.feasibility_access_grants to authenticated;
create policy feasibility_access_owner_read on public.feasibility_access_grants
  for select to authenticated using (user_id = (select auth.uid()));

create table private.feasibility_org_feature_switch (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
revoke all on table private.feasibility_org_feature_switch from public, anon, authenticated, service_role;
insert into private.feasibility_org_feature_switch (singleton) values (true);

create function private.feasibility_phase1_has_access(require_write boolean)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.feasibility_access_grants g
    where g.user_id = (select auth.uid()) and g.starts_at <= now()
      and (not require_write or (g.status in ('ACTIVE','TRIAL') and (g.ends_at is null or now() < g.ends_at)))
  )
$$;
revoke all on function private.feasibility_phase1_has_access(boolean) from public, anon, authenticated, service_role;
grant execute on function private.feasibility_phase1_has_access(boolean) to authenticated;

-- The private function exposes only the server-owned flag. It cannot alter it.
create function private.feasibility_phase1_org_enabled()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.enabled from private.feasibility_org_feature_switch s where s.singleton),false)
$$;
revoke all on function private.feasibility_phase1_org_enabled() from public, anon, authenticated, service_role;
grant execute on function private.feasibility_phase1_org_enabled() to authenticated;

create function private.feasibility_phase1_org_member(target_organization uuid, require_write boolean)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = target_organization and m.user_id = (select auth.uid())
      and m.status = 'ACTIVE' and o.status = 'ACTIVE'
      and (not require_write or m.role in ('OWNER','ADMIN'))
  )
$$;
revoke all on function private.feasibility_phase1_org_member(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function private.feasibility_phase1_org_member(uuid,boolean) to authenticated;

create table public.feasibility_projects (
  id uuid primary key,
  owner_user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete restrict,
  created_by_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  revision integer not null default 1 check (revision > 0),
  study jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feasibility_projects_exactly_one_owner check (num_nonnulls(owner_user_id,organization_id) = 1),
  constraint feasibility_study_document_check check (
    jsonb_typeof(study) = 'object'
    and jsonb_typeof(study->'id') is not distinct from 'string'
    and jsonb_typeof(study->'title') is not distinct from 'string'
    and (study->>'id') is not distinct from id::text
    and (study->>'title') is not distinct from title
    and octet_length(study::text) <= 1000000
  )
);
create index feasibility_projects_owner_updated_idx on public.feasibility_projects(owner_user_id, updated_at desc, id)
  where owner_user_id is not null;
create index feasibility_projects_organization_recent_idx on public.feasibility_projects(organization_id, updated_at desc, id)
  where organization_id is not null;
create index feasibility_projects_creator_idx on public.feasibility_projects(created_by_user_id)
  where created_by_user_id is not null;
alter table public.feasibility_projects enable row level security;
revoke all on table public.feasibility_projects from public, anon, authenticated, service_role;
grant select, delete on table public.feasibility_projects to authenticated;
grant insert (id, owner_user_id, organization_id, created_by_user_id, title, study)
  on table public.feasibility_projects to authenticated;
grant update (title, study, revision, updated_at) on table public.feasibility_projects to authenticated;

create function private.feasibility_phase1_validate_update()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'FEASIBILITY_OWNERSHIP_IMMUTABLE' using errcode = '42501';
  end if;
  -- FK cleanup may clear the historical creator when its auth user is removed.
  if new.revision = old.revision and new.created_by_user_id is null
     and old.created_by_user_id is not null and new.title = old.title and new.study = old.study
     and new.updated_at = old.updated_at and new.created_at = old.created_at then
    return new;
  end if;
  if new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'FEASIBILITY_PROVENANCE_IMMUTABLE' using errcode = '42501';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'FEASIBILITY_REVISION_MUST_ADVANCE' using errcode = '23514';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end
$$;
revoke all on function private.feasibility_phase1_validate_update() from public, anon, authenticated, service_role;
create trigger feasibility_projects_validate_update
  before update on public.feasibility_projects
  for each row execute function private.feasibility_phase1_validate_update();

create policy feasibility_personal_read on public.feasibility_projects
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(false)));
create policy feasibility_personal_insert on public.feasibility_projects
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and created_by_user_id = (select auth.uid())
              and (select private.feasibility_phase1_has_access(true)));
create policy feasibility_personal_update on public.feasibility_projects
  for update to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(true)))
  with check (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(true)));
create policy feasibility_personal_delete on public.feasibility_projects
  for delete to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(true)));

create policy feasibility_org_read on public.feasibility_projects
  for select to authenticated
  using (organization_id is not null and (select private.feasibility_phase1_org_enabled())
         and (select private.feasibility_phase1_has_access(false))
         and private.feasibility_phase1_org_member(organization_id,false));
create policy feasibility_org_insert on public.feasibility_projects
  for insert to authenticated
  with check (organization_id is not null and created_by_user_id = (select auth.uid())
              and (select private.feasibility_phase1_org_enabled())
              and (select private.feasibility_phase1_has_access(true))
              and private.feasibility_phase1_org_member(organization_id,true));
create policy feasibility_org_update on public.feasibility_projects
  for update to authenticated
  using (organization_id is not null and (select private.feasibility_phase1_org_enabled())
         and (select private.feasibility_phase1_has_access(true))
         and private.feasibility_phase1_org_member(organization_id,true))
  with check (organization_id is not null and (select private.feasibility_phase1_org_enabled())
              and (select private.feasibility_phase1_has_access(true))
              and private.feasibility_phase1_org_member(organization_id,true));
-- Institutional drafts have no authenticated DELETE policy, including for owners.

create table public.feasibility_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.feasibility_projects(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id),
  source_revision integer not null check (source_revision > 0),
  study_snapshot jsonb not null,
  review_kind text not null default 'INTERNAL_REVIEW' check (review_kind = 'INTERNAL_REVIEW'),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (project_id,source_revision)
);
create index feasibility_reviews_owner_project_idx on public.feasibility_review_snapshots(owner_user_id,project_id,created_at desc);
alter table public.feasibility_review_snapshots enable row level security;
revoke all on table public.feasibility_review_snapshots from public, anon, authenticated, service_role;
grant select on table public.feasibility_review_snapshots to authenticated;
grant insert (project_id,source_revision,notes) on table public.feasibility_review_snapshots to authenticated;

create function private.feasibility_phase1_capture_review()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  source public.feasibility_projects%rowtype;
begin
  select p.* into source from public.feasibility_projects p
  where p.id = new.project_id and p.owner_user_id = (select auth.uid())
  for share;
  if not found then raise exception 'FEASIBILITY_PROJECT_OWNER_REQUIRED' using errcode = '42501'; end if;
  if source.revision <> new.source_revision then
    raise exception 'FEASIBILITY_STALE_REVIEW_REVISION' using errcode = '23514';
  end if;
  new.owner_user_id := source.owner_user_id;
  new.study_snapshot := source.study;
  return new;
end
$$;
revoke all on function private.feasibility_phase1_capture_review() from public, anon, authenticated, service_role;
create trigger feasibility_review_capture_before_insert
  before insert on public.feasibility_review_snapshots
  for each row execute function private.feasibility_phase1_capture_review();
create policy feasibility_reviews_owner_select on public.feasibility_review_snapshots
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(false)));
create policy feasibility_reviews_owner_insert on public.feasibility_review_snapshots
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and (select private.feasibility_phase1_has_access(true)));

create table private.feasibility_project_audit (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  organization_id uuid,
  actor_user_id uuid,
  event text not null check (event in ('INSERT','UPDATE','DELETE')),
  revision integer not null,
  occurred_at timestamptz not null default statement_timestamp()
);
revoke all on table private.feasibility_project_audit from public, anon, authenticated, service_role;
create index feasibility_project_audit_project_idx on private.feasibility_project_audit(project_id,id);

create function private.feasibility_phase1_audit_project()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  project public.feasibility_projects%rowtype;
begin
  if tg_op = 'DELETE' then project := old; else project := new; end if;
  insert into private.feasibility_project_audit(project_id,organization_id,actor_user_id,event,revision)
  values (project.id,project.organization_id,(select auth.uid()),tg_op,project.revision);
  return null;
end
$$;
revoke all on function private.feasibility_phase1_audit_project() from public, anon, authenticated, service_role;
create trigger feasibility_projects_audit
  after insert or update or delete on public.feasibility_projects
  for each row execute function private.feasibility_phase1_audit_project();

commit;
