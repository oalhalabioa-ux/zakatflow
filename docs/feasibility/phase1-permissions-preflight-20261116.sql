-- Issue #430 / Feasibility phase-1 permission surface review — READ ONLY
-- Metadata/privilege checks only; no DDL/DML or customer-row queries.
-- NULL denotes an object that does not yet exist in the target environment.
WITH refs AS (
 SELECT
  to_regclass('public.feasibility_projects') AS studies,
  to_regclass('public.feasibility_access_grants') AS licences,
  to_regclass('private.feasibility_org_feature_switch') AS rollout,
  to_regprocedure('public.feasibility_accept_project_invitation(text)') AS accept_rpc,
  to_regprocedure('public.feasibility_revoke_project_invitation(uuid,uuid)') AS revoke_invite_rpc,
  to_regprocedure('public.feasibility_revoke_project_member(uuid,uuid)') AS revoke_member_rpc
)
SELECT
 studies IS NOT NULL AS studies_exist,
 CASE WHEN studies IS NULL THEN NULL ELSE (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=studies) END AS studies_rls_enabled,
 CASE WHEN studies IS NULL THEN NULL ELSE has_table_privilege('anon',studies,'SELECT') END AS anon_study_select_granted,
 CASE WHEN studies IS NULL THEN NULL ELSE has_table_privilege('anon',studies,'DELETE') END AS anon_study_delete_granted,
 CASE WHEN studies IS NULL THEN NULL ELSE has_table_privilege('authenticated',studies,'DELETE') END AS authenticated_study_delete_granted,
 CASE WHEN studies IS NULL THEN NULL ELSE has_column_privilege('authenticated',studies,'revision','UPDATE') END AS authenticated_revision_update_granted,
 CASE WHEN studies IS NULL THEN NULL ELSE has_column_privilege('authenticated',studies,'study','UPDATE') END AS authenticated_payload_update_granted,
 CASE WHEN licences IS NULL THEN NULL ELSE has_table_privilege('authenticated',licences,'UPDATE') END AS authenticated_licence_update_granted,
 CASE WHEN rollout IS NULL THEN NULL ELSE has_table_privilege('authenticated',rollout,'UPDATE') END AS authenticated_rollout_update_granted,
 CASE WHEN accept_rpc IS NULL THEN NULL ELSE has_function_privilege('anon',accept_rpc,'EXECUTE') END AS anon_accept_rpc_execute_granted,
 CASE WHEN accept_rpc IS NULL THEN NULL ELSE has_function_privilege('authenticated',accept_rpc,'EXECUTE') END AS authenticated_accept_rpc_execute_granted,
 CASE WHEN revoke_invite_rpc IS NULL THEN NULL ELSE has_function_privilege('anon',revoke_invite_rpc,'EXECUTE') END AS anon_revoke_invite_execute_granted,
 CASE WHEN revoke_member_rpc IS NULL THEN NULL ELSE has_function_privilege('anon',revoke_member_rpc,'EXECUTE') END AS anon_revoke_member_execute_granted
FROM refs;
