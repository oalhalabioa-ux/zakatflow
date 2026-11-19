-- QA V2 only. Append after the canonical sharing SQL, before its COMMIT.
-- The legacy fallback reads through RLS. The subscriber-only write and sharing
-- checks keep using the canonical entitlement helpers.
create or replace function public.feasibility_company_workspace(p_organization uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'canRead', private.feasibility_phase1_org_enabled() and
     (private.feasibility_company_access(p_organization,false) or
      exists(select 1 from public.feasibility_projects p
        where p.organization_id=p_organization)),
   'canWrite', private.feasibility_phase1_org_enabled()
     and private.feasibility_company_access(p_organization,true),
   'canShare', private.feasibility_phase1_org_enabled()
     and private.feasibility_company_access(p_organization,false)
     and exists(select 1 from public.organization_members m
       where m.organization_id=p_organization and m.user_id=(select auth.uid())
        and m.status='ACTIVE' and m.role='OWNER'))
$$;
