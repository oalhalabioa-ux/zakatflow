-- Yaqeen Business / Issue #430 — Phase-1 feasibility schema preflight
-- READ ONLY. Catalog metadata only; no access to customer rows, no DDL/DML.
-- Run independently on Production and QA V2. Do NOT apply this as a migration.
-- The expected catalog matches the QA V2 structure observed on 2026-11-16.
WITH expected(kind,name,parent) AS (
 SELECT * FROM (VALUES
 ('table','public.feasibility_projects',''),
 ('table','public.feasibility_access_grants',''),
 ('table','public.feasibility_review_snapshots',''),
 ('table','public.feasibility_project_members',''),
 ('table','public.feasibility_project_invitations',''),
 ('table','private.feasibility_org_feature_switch',''),
 ('column','organization_id','public.feasibility_projects'),
 ('column','created_by_user_id','public.feasibility_projects'),
 ('constraint','feasibility_projects_exactly_one_owner','public.feasibility_projects'),
 ('function','private.feasibility_collaborator_role',''),
 ('function','private.feasibility_org_enabled',''),
 ('function','private.feasibility_project_ownership_immutable',''),
 ('function','private.capture_feasibility_review_snapshot',''),
 ('function','public.feasibility_accept_project_invitation',''),
 ('function','public.feasibility_revoke_project_invitation',''),
 ('function','public.feasibility_revoke_project_member',''),
 ('trigger','feasibility_project_immutable_owner','public.feasibility_projects'),
 ('trigger','feasibility_review_capture_before_insert','public.feasibility_review_snapshots'),
 ('policy','feasibility_access_owner_read','public.feasibility_access_grants'),
 ('policy','feasibility_invite_owner_insert','public.feasibility_project_invitations'),
 ('policy','feasibility_invite_owner_read','public.feasibility_project_invitations'),
 ('policy','feasibility_member_owner_or_self_read','public.feasibility_project_members'),
 ('policy','feasibility_org_delete','public.feasibility_projects'),
 ('policy','feasibility_org_insert','public.feasibility_projects'),
 ('policy','feasibility_org_read','public.feasibility_projects'),
 ('policy','feasibility_org_update','public.feasibility_projects'),
 ('policy','feasibility_personal_delete','public.feasibility_projects'),
 ('policy','feasibility_personal_insert','public.feasibility_projects'),
 ('policy','feasibility_personal_read','public.feasibility_projects'),
 ('policy','feasibility_personal_update','public.feasibility_projects'),
 ('policy','feasibility_reviews_owner_insert','public.feasibility_review_snapshots'),
 ('policy','feasibility_reviews_owner_select','public.feasibility_review_snapshots')
 ) AS x(kind,name,parent)
), inspected AS (
 SELECT e.*,
 CASE
  WHEN kind='table' THEN to_regclass(name) IS NOT NULL
  WHEN kind='column' THEN EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema=split_part(parent,'.',1)
      AND c.table_name=split_part(parent,'.',2) AND c.column_name=name)
  WHEN kind='constraint' THEN EXISTS (
    SELECT 1 FROM pg_constraint co
    JOIN pg_class t ON t.oid=co.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=split_part(parent,'.',1)
      AND t.relname=split_part(parent,'.',2) AND co.conname=name)
  WHEN kind='function' THEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=split_part(name,'.',1) AND p.proname=split_part(name,'.',2))
  WHEN kind='trigger' THEN EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=split_part(parent,'.',1)
      AND c.relname=split_part(parent,'.',2) AND t.tgname=name AND NOT t.tgisinternal)
  WHEN kind='policy' THEN EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname=split_part(parent,'.',1)
      AND p.tablename=split_part(parent,'.',2) AND p.policyname=name)
  ELSE false END AS present,
 CASE WHEN kind='table' AND split_part(name,'.',1)='public'
 THEN (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass(name))
 ELSE NULL END AS rls_enabled
 FROM expected e
)
SELECT kind,name,parent,present,rls_enabled
FROM inspected ORDER BY kind,name;
