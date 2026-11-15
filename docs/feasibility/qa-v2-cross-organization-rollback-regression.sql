-- QA V2 ONLY; safe transactional cross-organization RLS test.
-- Requires existing confirmed trial owner + another auth user. Rolls back ALL rows,
-- memberships, subscriptions and the private rollout switch.
BEGIN;
CREATE TEMP TABLE qa_two_tenants ON COMMIT DROP AS
 SELECT m.organization_id AS organization_a,m.user_id AS owner_id,
        (SELECT u.id FROM auth.users u WHERE u.id<>m.user_id LIMIT 1) AS outsider_id,
        gen_random_uuid() AS organization_b,gen_random_uuid() AS project_a,
        gen_random_uuid() AS project_b
 FROM public.organization_members m JOIN auth.users u ON u.id=m.user_id
 JOIN public.feasibility_access_grants g ON g.user_id=m.user_id
 WHERE m.role='OWNER' AND m.status='ACTIVE'
   AND u.email_confirmed_at IS NOT NULL
   AND g.status IN ('TRIAL','ACTIVE') AND g.starts_at<=now()
   AND (g.ends_at IS NULL OR g.ends_at>now())
 LIMIT 1;
DO $pre$ BEGIN
 IF (SELECT count(*) FROM qa_two_tenants)<>1
    OR (SELECT outsider_id IS NULL FROM qa_two_tenants)
 THEN RAISE EXCEPTION 'QA fixture requires two users and an eligible organization'; END IF;
END $pre$;
SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM qa_two_tenants),true);
INSERT INTO public.organizations(id,owner_user_id,name,entity_type,base_currency,organization_kind)
 SELECT organization_b,owner_id,'QA_FEASIBILITY_MULTITENANT_SECOND_ORG','COMPANY','SAR','HOLDING'
 FROM qa_two_tenants;
UPDATE private.feasibility_org_feature_switch SET enabled=true WHERE id=true;
INSERT INTO public.feasibility_projects(id,organization_id,owner_user_id,created_by_user_id,title,study)
SELECT project_a,organization_a,NULL,owner_id,'QA_A_STUDY',
       jsonb_build_object('id',project_a::text,'title','QA_A_STUDY')
FROM qa_two_tenants;
INSERT INTO public.feasibility_projects(id,organization_id,owner_user_id,created_by_user_id,title,study)
SELECT project_b,organization_b,NULL,owner_id,'QA_B_STUDY',
       jsonb_build_object('id',project_b::text,'title','QA_B_STUDY')
FROM qa_two_tenants;
INSERT INTO public.feasibility_access_grants(user_id,status,starts_at,ends_at,source)
SELECT outsider_id,'TRIAL',now()-interval '1 hour',now()+interval '1 day','QA_MANUAL'
FROM qa_two_tenants;
INSERT INTO public.organization_members(organization_id,user_id,role,status)
 SELECT organization_b,outsider_id,'VIEWER','ACTIVE' FROM qa_two_tenants;
SELECT set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM qa_two_tenants),true);
SET LOCAL ROLE authenticated;
DO $user_b$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title IN ('QA_A_STUDY','QA_B_STUDY'))<>1
 THEN RAISE EXCEPTION 'Foreign organization member should read only its own company study'; END IF;
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title='QA_A_STUDY')<>0
 THEN RAISE EXCEPTION 'Unrelated user leaked tenant A study'; END IF;
END $user_b$;
RESET ROLE;
UPDATE public.organization_members SET status='SUSPENDED'
WHERE (organization_id,user_id)=(SELECT organization_b,outsider_id FROM qa_two_tenants);
SET LOCAL ROLE authenticated;
DO $suspended$ BEGIN
 IF (SELECT count(*) FROM public.feasibility_projects WHERE title IN ('QA_A_STUDY','QA_B_STUDY'))<>0
 THEN RAISE EXCEPTION 'Suspended outsider retained study access'; END IF;
END $suspended$;
RESET ROLE;
ROLLBACK;
