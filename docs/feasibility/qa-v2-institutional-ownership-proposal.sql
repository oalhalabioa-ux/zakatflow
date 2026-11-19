-- YAQEEN BUSINESS: proposed institutional feasibility tenancy (QA V2 ONLY)
-- Review/dry-run before apply. NOT a production migration. Requires matching
-- server API authorization and same-organization end-to-end negative tests.
-- QA project: ubotbpjngtfvolthpfec
--
-- Historical studies retain organization_id NULL => PERSONAL; no data moved.
-- Existing invitation membership permits shared PERSONAL access only.
-- The organization-specific portfolio will be enabled in application code
-- only after this proposal is rehearsed, applied once and verified.
BEGIN;

ALTER TABLE public.feasibility_projects
 ADD COLUMN IF NOT EXISTS organization_id uuid
 REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- Corporate studies survive the departure or deletion of their creator.
-- Only personal studies have an individual owner_user_id. The institutional
-- creator is separate, informational provenance and may become NULL.
ALTER TABLE public.feasibility_projects ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE public.feasibility_projects
 ADD COLUMN IF NOT EXISTS created_by_user_id uuid
 REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();
UPDATE public.feasibility_projects
 SET created_by_user_id=owner_user_id
 WHERE organization_id IS NULL AND created_by_user_id IS NULL;
ALTER TABLE public.feasibility_projects
 ADD CONSTRAINT feasibility_projects_exactly_one_owner CHECK (
  (organization_id IS NULL AND owner_user_id IS NOT NULL)
  OR (organization_id IS NOT NULL AND owner_user_id IS NULL)
 );

CREATE INDEX IF NOT EXISTS feasibility_projects_organization_recent_idx
 ON public.feasibility_projects (organization_id, updated_at DESC, id)
 WHERE organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.feasibility_project_ownership_immutable()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
  RAISE EXCEPTION 'FEASIBILITY_OWNERSHIP_IMMUTABLE' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS feasibility_project_immutable_owner ON public.feasibility_projects;
CREATE TRIGGER feasibility_project_immutable_owner
 BEFORE UPDATE ON public.feasibility_projects
 FOR EACH ROW EXECUTE FUNCTION private.feasibility_project_ownership_immutable();

ALTER TABLE public.feasibility_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feasibility_owner_delete ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_owner_insert ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_project_owner_or_member_read ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_project_owner_write ON public.feasibility_projects;

DROP POLICY IF EXISTS feasibility_personal_read ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_personal_insert ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_personal_update ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_personal_delete ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_org_read ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_org_insert ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_org_update ON public.feasibility_projects;
DROP POLICY IF EXISTS feasibility_org_delete ON public.feasibility_projects;

-- Personal visibility retains the existing QA collaborator semantics, but
-- no org-owned project can be read by claiming to be its creator.
CREATE POLICY feasibility_personal_read ON public.feasibility_projects
 FOR SELECT TO authenticated USING (
  organization_id IS NULL
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
  )
  AND (owner_user_id=(SELECT auth.uid())
   OR private.feasibility_collaborator_role(id) IN ('VIEWER','REVIEWER','EDITOR'))
 );

CREATE POLICY feasibility_personal_insert ON public.feasibility_projects
 FOR INSERT TO authenticated WITH CHECK (
  organization_id IS NULL AND owner_user_id=(SELECT auth.uid())
  AND created_by_user_id=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );
CREATE POLICY feasibility_personal_update ON public.feasibility_projects
 FOR UPDATE TO authenticated
 USING (
  organization_id IS NULL AND owner_user_id=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 )
 WITH CHECK (
  organization_id IS NULL AND owner_user_id=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );
CREATE POLICY feasibility_personal_delete ON public.feasibility_projects
 FOR DELETE TO authenticated USING (
  organization_id IS NULL AND owner_user_id=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );

-- Database-side rollout switch, owned by the trusted QA operator.
-- A public client must not be able to create corporate studies just by calling
-- PostgREST while the Next.js feature flag is still OFF. The private switch
-- starts OFF independently of all client and deployment settings.
CREATE TABLE IF NOT EXISTS private.feasibility_org_feature_switch (
 id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
 enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.feasibility_org_feature_switch(id,enabled)
 VALUES(true,false) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON private.feasibility_org_feature_switch FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.feasibility_org_enabled()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog
 AS $org_enabled$
  SELECT coalesce((SELECT enabled FROM private.feasibility_org_feature_switch
                   WHERE id=true),false);
 $org_enabled$;
REVOKE ALL ON FUNCTION private.feasibility_org_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.feasibility_org_enabled() TO authenticated;

-- Corporate reads require real, current ACTIVE membership in the exact
-- selected organization. Corporate writes additionally require OWNER/ADMIN.
-- Per-user feasibility entitlement is a temporary QA rule; standalone
-- organization seat licensing must be explicitly implemented under #416.
CREATE POLICY feasibility_org_read ON public.feasibility_projects
 FOR SELECT TO authenticated USING (
  private.feasibility_org_enabled()
  AND organization_id IS NOT NULL AND owner_user_id IS NULL
  AND EXISTS (
   SELECT 1 FROM public.organizations o
   WHERE o.id=feasibility_projects.organization_id AND o.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_id=feasibility_projects.organization_id
    AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
  )
 );
CREATE POLICY feasibility_org_insert ON public.feasibility_projects
 FOR INSERT TO authenticated WITH CHECK (
  private.feasibility_org_enabled()
  AND organization_id IS NOT NULL AND owner_user_id IS NULL
  AND created_by_user_id=(SELECT auth.uid())
  AND EXISTS (
   SELECT 1 FROM public.organizations o
   WHERE o.id=feasibility_projects.organization_id AND o.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_id=feasibility_projects.organization_id
    AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
    AND m.role IN ('OWNER','ADMIN')
  )
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );
CREATE POLICY feasibility_org_update ON public.feasibility_projects
 FOR UPDATE TO authenticated
 USING (
  private.feasibility_org_enabled()
  AND organization_id IS NOT NULL AND owner_user_id IS NULL
  AND EXISTS (
   SELECT 1 FROM public.organizations o
   WHERE o.id=feasibility_projects.organization_id AND o.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_id=feasibility_projects.organization_id
    AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
    AND m.role IN ('OWNER','ADMIN')
  )
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 )
 WITH CHECK (
  private.feasibility_org_enabled()
  AND organization_id IS NOT NULL AND owner_user_id IS NULL
  AND EXISTS (
   SELECT 1 FROM public.organizations o
   WHERE o.id=feasibility_projects.organization_id AND o.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_id=feasibility_projects.organization_id
    AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
    AND m.role IN ('OWNER','ADMIN')
  )
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );
CREATE POLICY feasibility_org_delete ON public.feasibility_projects
 FOR DELETE TO authenticated USING (
  private.feasibility_org_enabled()
  AND organization_id IS NOT NULL AND owner_user_id IS NULL
  AND EXISTS (
   SELECT 1 FROM public.organizations o
   WHERE o.id=feasibility_projects.organization_id AND o.status='ACTIVE'
  )
  AND EXISTS (
   SELECT 1 FROM public.organization_members m
   WHERE m.organization_id=feasibility_projects.organization_id
    AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
    AND m.role IN ('OWNER','ADMIN')
  )
  AND EXISTS (
   SELECT 1 FROM public.feasibility_access_grants g
   WHERE g.user_id=(SELECT auth.uid()) AND g.starts_at<=now()
    AND g.status IN ('TRIAL','ACTIVE')
    AND (g.ends_at IS NULL OR g.ends_at>now())
  )
 );

-- Required before applying: verify that all preexisting PERSONAL policies
-- and invite functions still preserve read-only access and no project leaks
-- into corporate scope. Direct authenticated REST API mutation also needs
-- revision / payload-validation guards before commercial activation.
COMMIT;
