-- QA V2 only: live-study role matrix. All fixture grants/memberships
-- are temporary and rolled back. Never run this against Production.
-- Does not alter the existing study document or financial records.
BEGIN;
CREATE TEMP TABLE qa_existing_study_viewer ON COMMIT DROP AS
SELECT m.organization_id, m.user_id AS owner_id,p.id AS project_id,
 (SELECT u.id FROM auth.users u JOIN public.profiles pr ON pr.id=u.id
  WHERE u.id<>m.user_id LIMIT 1) AS viewer_id
FROM public.organization_members m JOIN public.feasibility_projects p
 ON p.organization_id=m.organization_id
WHERE m.role='OWNER' AND m.status='ACTIVE' AND p.owner_user_id IS NULL
ORDER BY p.updated_at DESC LIMIT 1;
GRANT SELECT ON qa_existing_study_viewer TO authenticated;
DO $pre$ BEGIN
 IF (SELECT count(*) FROM qa_existing_study_viewer)<>1
  OR (SELECT viewer_id IS NULL FROM qa_existing_study_viewer)
  OR EXISTS (SELECT 1 FROM public.feasibility_access_grants g
   JOIN qa_existing_study_viewer q ON g.user_id=q.viewer_id)
  OR EXISTS (SELECT 1 FROM public.organization_members m
   JOIN qa_existing_study_viewer q ON m.organization_id=q.organization_id
     AND m.user_id=q.viewer_id)
 THEN RAISE EXCEPTION 'QA fixture must have a saved company study and separate unlicensed viewer'; END IF;
END $pre$;
INSERT INTO public.feasibility_access_grants(user_id,status,starts_at,ends_at,source)
SELECT viewer_id,'TRIAL',now()-interval '1 hour',now()+interval '1 day','QA_MANUAL'
FROM qa_existing_study_viewer;
INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT organization_id,viewer_id,'VIEWER','ACTIVE' FROM qa_existing_study_viewer;
SELECT set_config('request.jwt.claim.sub',(SELECT viewer_id::text FROM qa_existing_study_viewer),true);
SET LOCAL ROLE authenticated;
DO $viewer$
DECLARE n integer; touched integer; new_id uuid;
BEGIN
 SELECT count(*) INTO n FROM public.feasibility_projects
 WHERE id=(SELECT project_id FROM qa_existing_study_viewer);
 IF n<>1 THEN RAISE EXCEPTION 'ACTIVE_VIEWER_READ_DENIED'; END IF;
 UPDATE public.feasibility_projects SET title=title
 WHERE id=(SELECT project_id FROM qa_existing_study_viewer);
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>0 THEN RAISE EXCEPTION 'ACTIVE_VIEWER_UPDATED_COMPANY_STUDY'; END IF;
 new_id:=gen_random_uuid();
 BEGIN
  INSERT INTO public.feasibility_projects
   (id,organization_id,owner_user_id,created_by_user_id,title,study)
  SELECT new_id,organization_id,NULL,viewer_id,'QA_VIEWER_MUST_NOT_INSERT',
  jsonb_build_object('id',new_id::text,'title','QA_VIEWER_MUST_NOT_INSERT')
  FROM qa_existing_study_viewer;
  RAISE EXCEPTION 'ACTIVE_VIEWER_INSERTED_STUDY';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $viewer$;
RESET ROLE;
-- Existing product policy: SUSPENDED feasibility licence means read-only
-- (no changes); separate SUSPENDED organization membership denies all access.
UPDATE public.feasibility_access_grants SET status='SUSPENDED'
WHERE user_id=(SELECT viewer_id FROM qa_existing_study_viewer);
SET LOCAL ROLE authenticated;
DO $licence$
DECLARE touched integer;
BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects
   WHERE id=(SELECT project_id FROM qa_existing_study_viewer))<>1
 THEN RAISE EXCEPTION 'SUSPENDED_LICENCE_READ_ONLY_POLICY_CHANGED'; END IF;
 UPDATE public.feasibility_projects SET title=title
 WHERE id=(SELECT project_id FROM qa_existing_study_viewer);
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>0 THEN RAISE EXCEPTION 'SUSPENDED_LICENCE_ALLOWED_UPDATE'; END IF;
END $licence$;
RESET ROLE;
UPDATE public.organization_members SET status='SUSPENDED'
WHERE (organization_id,user_id)=
 (SELECT organization_id,viewer_id FROM qa_existing_study_viewer);
SET LOCAL ROLE authenticated;
DO $member$
BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects
 WHERE id=(SELECT project_id FROM qa_existing_study_viewer))<>0
 THEN RAISE EXCEPTION 'SUSPENDED_ORGANIZATION_MEMBER_LEAKED_STUDY'; END IF;
END $member$;
RESET ROLE;
ROLLBACK;
