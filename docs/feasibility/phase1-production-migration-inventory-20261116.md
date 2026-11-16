# Feasibility phase-1 — Production migration readiness / issue #430

**Status: PRE-FLIGHT ONLY — not a schema migration, not approval to deploy or merge.**

Repo: `oalhalabioa-ux/zakatflow`. Based on `main` after deployment-governance PR #427. Original feasibility code remains in Draft PR #418; combined integration in Draft PR #429. No Production or QA V2 data is changed by this review.

## Verified read-only inventory (16 November 2026)

The catalog-only [preflight SQL](./phase1-schema-preflight-20261116.sql) was executed separately against the existing Supabase Production and QA V2 projects:

| Observation | Production | QA V2 |
| --- | ---: | ---: |
| Required schema objects checked | 0 / 32 present | 32 / 32 present |
| Public Feasibility tables | 0 | 5 |
| Private org rollout switch table | 0 | 1 |
| Feasibility project RLS policies | 0 | 8 (4 personal, 4 institutional) |
| RLS policies across all 5 tables | 0 | 14 |
| Feasibility functions (public + private) | 0 | 7 |
| Feasibility triggers | 0 | 2 |
| Public Feasibility tables with RLS disabled | N/A | 0 |

All 32 checks are **presence checks**, not full security, functional or migration acceptance. Both databases expose the expected `organizations` and `organization_members` identifier, status and membership-role column types. The actual production migration is still absent.

## QA feasibility migration dependency chain (historical, not Production-ready SQL)

The QA V2 `supabase_migrations.schema_migrations` catalog contains **12 applied Feasibility entries**. Original migration bodies were inspected read-only; their names and sequence are for provenance **only**, not instructions to replay QA-specific SQL in Production.

| Order | Version | QA migration | Primary dependency / purpose |
| ---: | --- | --- | --- |
| 1 | 20261109095653 | `feasibility_projects_owner_drafts_qa_v2` | Personal owner drafts, indexes, basic RLS |
| 2 | 20261109105303 | `feasibility_independent_access_grants_qa_v2` | Independent per-user entitlement |
| 3 | 20261109111004 | `feasibility_immutable_review_snapshots_qa_v2` | Immutable personal-owner review snapshot and trigger |
| 4 | 20261109112033 | `feasibility_collaborators_role_model_qa_v2` | Project members, initial role-based access |
| 5 | 20261109112445 | `feasibility_collaboration_private_helper_hardening_qa_v2` | Private collaborator-role helper and RLS cleanup |
| 6 | 20261109112808 | `feasibility_email_bound_invitation_qa_v2` | Invitation table and privileged acceptance/member revoke RPCs |
| 7 | 20261109123415 | `feasibility_pending_invite_revocation_qa_v2` | Pending invitation revoke function |
| 8 | 20261115150658 | `feasibility_entitlement_rls_hardening_qa_v2_20261115` | Entitlement-aware reads/writes, direct API role restrictions |
| 9 | 20261115152518 | `feasibility_audited_member_revocation_qa_v2_20261115` | Audited collaborator revocation |
| 10 | 20261115154946 | `feasibility_invitation_entitlement_audit_qa_v2_20261115` | Token redemption entitlement, audit |
| 11 | 20261115155224 | `feasibility_invitation_revoke_licence_qa_v2_20261115` | Revoke invitation with entitlement check |
| 12 | 20261115191919 | `feasibility_institutional_ownership_qa_v2_20261115` | Institution owner/creator, RLS and private OFF-by-default switch |

**Critical dependency:** `feasibility_personal_read` calls `private.feasibility_collaborator_role(id)`. Thus, omitting the collaborator membership/helper in a supposedly minimal production schema will break the currently tested personal read policy. The 12 QA migration statements must be reviewed for transitive dependencies, privilege grants and naming before a smaller Production migration is designed.

## Security and compatibility decisions to resolve before writing forward migration files

1. **Do not transfer user drafts.** Legacy personal browser-local JSON and cloud ownership are preserved. New studies must have exactly one owner (`USER` **or** `ORGANIZATION`); corporate creator provenance is separate from ownership and may become null after employee departure.
2. **Private switch starts OFF.** Production must not default to institutional access. Review the `private.feasibility_org_enabled()` SECURITY DEFINER function's grants, search path, and switch permissions; no public ability to toggle it.
3. **RLS is mandatory and deny-by-default.** Verify active organization membership, role, organization status, entitlement, cross-organization denials and guest denial at the Data API as well as application API. Do not rely on the topbar UUID as authorization.
4. **Privileged invitation RPCs require independent review.** The existing public `feasibility_accept_project_invitation`, `feasibility_revoke_project_invitation` and `feasibility_revoke_project_member` functions use SECURITY DEFINER; review EXECUTE grants, ownership, token reuse, email confirmation, audit and arbitrary caller attempts. Organizational cross-sharing is still unimplemented and must remain disabled.
5. **Corporate review snapshots are NOT approved.** The current snapshot schema requires `owner_user_id NOT NULL` and its trigger is for personal owners. Do not pretend this already supports institution-owned reviews.
6. **Revisions and destructive REST access need a security decision.** Application PATCH enforces expected revision and returns 409 on conflicts, but direct authenticated Data API access may take another path under granted column/table privileges; review revision invariants, corporate DELETE policy and audit before enabling customer access.
7. **Subscription semantics are distinct.** Existing accepted read/export behavior after expired/READ_ONLY licences should not be silently changed into total denial. Organization membership SUSPENDED must independently remove access.
8. **Feature flags and integration remain separate.** Do not casually enable `FEASIBILITY_ORG_QA`, `NEXT_PUBLIC_FEASIBILITY_CLOUD_QA`, invitations/Resend/SMTP or Financial Core V2 handoff on Production. Never connect Financial Core V1 or write accounting journals/opening balances from a study.
9. **Production schema dependencies are only partially inspected.** Check `private` namespace and required extensions/grants, organization RLS, migration-history collision, and whether functions compile against actual Production types before constructing DDL.

## Additional QA V2 permission-surface audit (READ ONLY)

The independently executable [permission preflight](./phase1-permissions-preflight-20261116.sql) was tested on both environments. Its direct-Data-API privilege checks are **not proof of an exploit**; they identify access paths for the release review:

- In QA V2, `anon` is denied direct Feasibility study SELECT and DELETE, and the `authenticated` role has **no direct UPDATE privilege** on `feasibility_access_grants` or on the private institution rollout switch.
- In QA V2, `authenticated` **does have** study DELETE privilege and direct revision/payload UPDATE column privileges; the corporate owner/admin DELETE RLS policy is present. This is distinct from the current UI, which intentionally does not offer corporate deletion. Decide whether the Data API may legitimately expose those operations, and if not, add and separately test a database/server enforcement path before customer activation.
- Supabase security advisors report **three Feasibility-related warnings** for authenticated-callable public SECURITY DEFINER invitation/revocation RPCs. These are expected SQL call routes and warnings are not proof of a vulnerability, but require independent review of caller identity, grants, ownership and audit before any Production enablement. None was callable by `anon` in the read-only privilege check. [Advisor rule](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- The Production versions of these objects do not yet exist; the audit correctly returns `NULL` instead of suggesting their permissions were verified.

## Migration development and sign-off sequence (NOT performed by this preflight)

- Prepare independently reviewed, versioned **Production-specific forward SQL** under `supabase/migrations`; use Supabase CLI migration creation conventions. Do not apply the QA-only migrations verbatim.
- First verify an **actual Production backup and non-production restore drill**; this has not been proven by the catalog checks.
- Rehearse from a production-compatible **non-customer-data** database, not live Production and not shared QA tenant rows. Prove the 32 catalog checks plus column constraints/privileges, fixed IDs, membership and licence matrices, token denial, revision 409, and no existing data mutations.
- Record immutable pre/post-schema metadata, independent security review, rollback plan for each DDL class, and exact database migration versions. A backup/restore proof is mandatory before a Production migration.
- Run authenticated live QA V2 **Billing control vs Feasibility→Billing** `PATCH/GET` and reload on separate users/organizations; isolated Chromium test PR #424 is successful but not equivalent to this live QA gate.
- Follow central QA coordination [#426](https://github.com/oalhalabioa-ux/zakatflow/issues/426) (prior settings #425 slot precedes feasibility #429). Recheck new `main` and all exact-SHA CI before any deployment.
- Keep [#429](https://github.com/oalhalabioa-ux/zakatflow/pull/429) and [#418](https://github.com/oalhalabioa-ux/zakatflow/pull/418) Draft, do **not** change Production, email delivery, payments, domains, Google Auth or source data until all release gates have passed and been approved.

## Evidence sources

GitHub: [#430](https://github.com/oalhalabioa-ux/zakatflow/issues/430), [#429](https://github.com/oalhalabioa-ux/zakatflow/pull/429), [#421](https://github.com/oalhalabioa-ux/zakatflow/issues/421), [#426](https://github.com/oalhalabioa-ux/zakatflow/issues/426). Schema observations: Supabase read-only system catalogs and the historical QA V2 migration `statements` inventory, 2026-11-16. The preflight SQL intentionally reads **only** metadata, not personal or organizational records.
