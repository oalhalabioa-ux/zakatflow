-- QA V2 only. Prepend inside the canonical sharing migration transaction.
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
