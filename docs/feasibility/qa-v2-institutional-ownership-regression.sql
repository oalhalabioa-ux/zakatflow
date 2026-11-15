-- QA V2 ONLY. Rehearsal assertions; execute INSIDE a transaction and ROLLBACK.
-- Never run on Production. No real identity data is written permanently.
CREATE TEMP TABLE qa_feasibility_case ON COMMIT DROP AS
SELECT gen_random_uuid() AS personal_id,gen_random_uuid() AS company_id,
       m.user_id AS owner_id,m.organization_id AS organization_id,
       (SELECT u.id FROM auth.users u WHERE u.id<>m.user_id LIMIT 1) AS outsider_id
FROM public.organization_members m
JOIN public.feasibility_access_grants g ON g.user_id=m.user_id
WHERE m.role='OWNER' AND m.status='ACTIVE'
 AND g.status IN('TRIAL','ACTIVE') AND g.starts_at<=now()
 AND (g.ends_at IS NULL OR g.ends_at>now())
LIMIT 1;
DO $pre$ BEGIN
 IF (SELECT count(*) FROM qa_feasibility_case)<>1
   OR (SELECT outsider_id IS NULL FROM qa_feasibility_case)
 THEN RAISE EXCEPTION 'QA fixture lacks owner and another user'; END IF;
END $pre$;
INSERT INTO public.feasibility_projects(id,owner_user_id,created_by_user_id,organization_id,title,study)
SELECT personal_id,owner_id,owner_id,NULL,'QA_SCOPE_PERSONAL',
       jsonb_build_object('id',personal_id::text,'title','QA_SCOPE_PERSONAL')
FROM qa_feasibility_case;
INSERT INTO public.feasibility_projects(id,owner_user_id,created_by_user_id,organization_id,title,study)
SELECT company_id,NULL,owner_id,organization_id,'QA_SCOPE_COMPANY',
       jsonb_build_object('id',company_id::text,'title','QA_SCOPE_COMPANY')
FROM qa_feasibility_case;
INSERT INTO public.feasibility_access_grants(user_id,status,starts_at,ends_at,source)
SELECT outsider_id,'TRIAL',now()-interval '1 hour',now()+interval '1 day','QA_MANUAL'
FROM qa_feasibility_case;

SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM qa_feasibility_case),true);
SET LOCAL ROLE authenticated;
DO $owner$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title LIKE 'QA_SCOPE_%')<>2
 THEN RAISE EXCEPTION 'Owner cannot read personal + corporation'; END IF;
END $owner$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM qa_feasibility_case),true);
SET LOCAL ROLE authenticated;
DO $outsider$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title LIKE 'QA_SCOPE_%')<>0
 THEN RAISE EXCEPTION 'Unrelated licensee can see foreign studies'; END IF;
END $outsider$;
RESET ROLE;

INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT organization_id,outsider_id,'VIEWER','ACTIVE' FROM qa_feasibility_case;
SET LOCAL ROLE authenticated;
DO $viewer$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title LIKE 'QA_SCOPE_%')<>1
 THEN RAISE EXCEPTION 'Corporate viewer must see company but not personal'; END IF;
END $viewer$;
RESET ROLE;

UPDATE public.organization_members SET status='SUSPENDED'
WHERE (organization_id,user_id)=(SELECT organization_id,outsider_id FROM qa_feasibility_case);
SET LOCAL ROLE authenticated;
DO $suspended$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title LIKE 'QA_SCOPE_%')<>0
 THEN RAISE EXCEPTION 'Suspended viewer retains company study access'; END IF;
END $suspended$;
RESET ROLE;

DO $immut$ BEGIN
 BEGIN
  UPDATE public.feasibility_projects
   SET owner_user_id=(SELECT owner_id FROM qa_feasibility_case)
   WHERE id=(SELECT company_id FROM qa_feasibility_case);
  RAISE EXCEPTION 'Company ownership was unexpectedly mutable';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $immut$;
-- Caller MUST issue ROLLBACK, then read back policy/column and fixture counts.
