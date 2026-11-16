-- Read-only hosted Financial Core QA prerequisite inventory.
-- Also runnable on a fully migrated disposable local Supabase.
-- Never execute writes or treat this as authenticated/RLS or atomic certification.
-- Returns aggregate counts and capability booleans only; no customer identifiers.
WITH capabilities AS (
 SELECT
  (to_regclass('private.financial_branch_opening_distributions') IS NOT NULL) AS branch_opening_schema,
  (to_regclass('private.financial_group_control_assessments') IS NOT NULL) AS group_control_schema,
  (to_regprocedure('public.financial_reporting_legacy_attestation(uuid,date,date,jsonb)') IS NOT NULL) AS legacy_cost_attestation,
  (to_regprocedure('public.financial_statement_live_snapshot(uuid,date,date)') IS NOT NULL) AS company_live_snapshot
), data_counts AS (
 SELECT
  (SELECT count(*) FROM public.organization_entities WHERE entity_type::text='BRANCH' AND active=true) AS active_branches,
  (SELECT count(*) FROM public.financial_opening_workspaces WHERE status='APPROVED') AS approved_openings,
  (SELECT count(*) FROM public.financial_events e
   JOIN public.organization_entities o ON o.id=e.entity_id AND o.organization_id=e.organization_id
   WHERE o.entity_type::text='BRANCH' AND o.active=true AND e.status IN ('ACTUAL','REVERSED')) AS branch_posted_events,
  (SELECT count(*) FROM public.financial_events) AS financial_events_total
), issues AS (
 SELECT code FROM capabilities c CROSS JOIN data_counts d CROSS JOIN LATERAL (
  VALUES
  ('BRANCH_OPENING_SCHEMA_MISSING', NOT c.branch_opening_schema),
  ('GROUP_CONTROL_SCHEMA_MISSING', NOT c.group_control_schema),
  ('LEGACY_COST_ATTESTATION_MISSING', NOT c.legacy_cost_attestation),
  ('COMPANY_LIVE_SNAPSHOT_MISSING', NOT c.company_live_snapshot),
  ('NO_ACTIVE_BRANCH_FIXTURE', d.active_branches=0),
  ('NO_APPROVED_OPENING_FIXTURE', d.approved_openings=0),
  ('NO_BRANCH_POSTED_JOURNAL_FIXTURE', d.branch_posted_events=0),
  ('ATOMIC_AUTHENTICATED_SOURCE_AND_GROUP_UAT_NOT_CERTIFIED', true)
 ) AS checks(code,failed) WHERE failed
)
SELECT jsonb_build_object(
 'gate','BLOCKED',
 'purpose','READ_ONLY_HOSTED_QA_PREREQUISITES_NOT_REPORT_CERTIFICATION',
 'schema',to_jsonb(c),
 'sourcePopulation',to_jsonb(d),
 'issues',(SELECT coalesce(jsonb_agg(code ORDER BY code),'[]'::jsonb) FROM issues),
 'productionReady',false
) AS readiness FROM capabilities c CROSS JOIN data_counts d;
