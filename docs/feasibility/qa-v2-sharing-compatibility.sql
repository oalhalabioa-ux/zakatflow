-- QA V2 only. Prepend inside the canonical sharing migration transaction.
set local lock_timeout='3s';
do $guard$
begin
 if to_regprocedure('private.feasibility_org_enabled()') is null
    or to_regprocedure('private.feasibility_phase1_org_enabled()') is not null
    or to_regprocedure('public.my_feasibility_access()') is not null
    or to_regclass('private.feasibility_organization_shares') is not null then
  raise exception 'UNEXPECTED_QA_V2_FEASIBILITY_SCHEMA';
 end if;
end
$guard$;

-- Delegate to the existing QA switch. Keep its value and schema intact.
create function private.feasibility_phase1_org_enabled()
returns boolean language sql stable security invoker set search_path='' as $$
 select private.feasibility_org_enabled()
$$;
revoke all on function private.feasibility_phase1_org_enabled() from public,anon,authenticated,service_role;
grant execute on function private.feasibility_phase1_org_enabled() to authenticated;

-- QA V2 has a legacy organizational DELETE policy. Disable it before
-- introducing snapshots whose foreign key cascades on a study deletion.
alter policy feasibility_org_delete on public.feasibility_projects using (false);

-- Capture existing QA study identities before changing organization visibility.
-- The migration transaction holds the same table lock through policy installation.
lock table public.feasibility_projects in share row exclusive mode;
create table private.feasibility_qa_legacy_studies (
 project_id uuid primary key references public.feasibility_projects(id) on delete cascade,
 organization_id uuid not null
);
alter table private.feasibility_qa_legacy_studies enable row level security;
revoke all on private.feasibility_qa_legacy_studies from public,anon,authenticated,service_role;
insert into private.feasibility_qa_legacy_studies (project_id,organization_id)
 select id,organization_id from public.feasibility_projects
 where organization_id is not null and owner_user_id is null;

-- Match the previous QA read requirements, limited to the captured studies.
create function private.feasibility_qa_legacy_read(p_project uuid,p_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.feasibility_org_enabled()
   and exists(select 1 from private.feasibility_qa_legacy_studies l
    join public.organizations o on o.id=l.organization_id and o.status='ACTIVE'
    join public.organization_members m on m.organization_id=l.organization_id
      and m.user_id=(select auth.uid()) and m.status='ACTIVE'
    where l.project_id=p_project and l.organization_id=p_organization)
   and exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now())
$$;
revoke all on function private.feasibility_qa_legacy_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.feasibility_qa_legacy_read(uuid,uuid) to authenticated;

create policy feasibility_qa_legacy_org_read on public.feasibility_projects
 for select to authenticated
 using (organization_id is not null and owner_user_id is null
   and private.feasibility_qa_legacy_read(id,organization_id));
