# Feasibility integration acceptance — 15 Nov 2026

**Scope:** isolated merge candidate #409 of draft feasibility module #361 into current Yaqeen `main`. This is a gated-code acceptance note, **not** approval to activate the module or post into Financial Core V2.

## 1. Provenance and conflicts
- Baseline `main` SHA `47950837dba9cb4ce460b362a800db45619a6db0`.
- Source feature SHA `03360e4f8141c146eb32b5fe5d2b34cc7c6353ed`.
- Integration starts at `97cde3f4ca79f53e9ae3c560ff5117b1cb17ca79`, with 52 source files (mostly added) combined into current `main`, not into the legacy codebase.
- GitHub's merge check on integration PR #409 returned `mergeable=true`. The original PR #361 remains Draft/conflicted; it should not be merged independently.
- Reconciled `CorporateShell.tsx` by retaining main's latest navigation/settings implementation and inserting only the opt-in feasibility link.
- Reconciled `subscriptions/PlanEditor.tsx` by retaining main's subscription UI and adding the separately feature-gated feasibility module selection. Three other changed source files were identical on main versus their original base before applying feasibility-only changes.
- No accounting-related files or migrations in `supabase/migrations` were altered.

## 2. Exact integration commit checks
The first integrated head `97cde3f4` passed all four GitHub Action jobs:
1. [Quality](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/43726885773) — `npm ci`, dependency audit, `npm run check`, `npm run build`.
2. [Assets Integration QA](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/43726885769) — TypeScript, complete Vitest suite, Next build.
3. [Feasibility isolated QA](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/43726885826) — unprivileged feasibility unit/API tests and TypeScript.
4. [Isolated subscription trials acceptance](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/43726885810) — disposable database and real Auth/API/browser checks for subscription workflows.

These test results are tied to the stated commit and must be repeated/verified on the final PR head after this QA documentation update.

## 3. QA V2 RLS & entitlement boundary (NOT Production)
- QA project: `ubotbpjngtfvolthpfec` only. The original five feasibility tables had RLS enabled.
- Before hardening, direct PostgREST access could reach an owned study despite the absence of a valid independent feasibility licence, bypassing the page/API subscription restriction.
- The exact reviewed fix is `docs/feasibility/qa-v2-entitlement-rls-hardening.sql`. Rollback-only DDL rehearsal passed **12** independent owner/member/outsider and entitlement-state assertions (missing, ACTIVE, READ_ONLY, expired, revoked), then QA-only migration `feasibility_entitlement_rls_hardening_qa_v2_20261115` was successfully applied once.
- RLS now checks entitlement for study read/write, invited members, invitations and immutable reviews. Read access for valid-in-the-past, expired or read-only licences remains possible for exports; writes require current `TRIAL` or `ACTIVE`.
- Direct collaborator `EDITOR` updates are disabled until authenticated/audited collaborative edits exist; the existing owner-only API remains intact.
- QA validation confirmed all project-related RLS policies reference the grant and `anon` lacks feasibility RPC execution. Following rollback, all five feasibility data tables and disposable synthetic auth users had **zero** records. No real user accounts or financial transactions were modified.
- Global Supabase security advisor warnings elsewhere in the database are outside this isolated change; do not claim a clean project-wide security audit.

## 4. Feature/release guards
- `NEXT_PUBLIC_FEASIBILITY_STUDIES`, `NEXT_PUBLIC_FEASIBILITY_CLOUD_QA`, `NEXT_PUBLIC_FEASIBILITY_SHARING_QA`, `NEXT_PUBLIC_FINANCIAL_CORE_V2_HANDOFF`, and the separate billing gates remain disabled in Production unless specifically approved.
- The module is an **independent, non-posting** feasibility/planning engine. No legacy Financial Core V1 imports or accounting writes. No certified legal approvals, account entries, shareholder legal changes, statutory tax schedules or automatic company/branch accounting mapping.
- QA V2 schema hardening was applied **only** to the separate QA Supabase project; it is intentionally documented outside canonical Production migration history. A future release must have an independently reviewed production migration rollout **before** enabling the feature.

## 5. Remaining acceptance boundaries
- [x] Reconcile main/feature conflicts and preserve main's current navigation, subscriptions and accounting behavior.
- [x] No merge conflict on clean integration PR.
- [x] Initial integrated source build, unit/API, assets and subscriptions CI passed.
- [x] QA V2 transactional RLS and entitlement regression checks passed and reverted all fixtures.
- [ ] Verify all four CI suites on the **final** integration HEAD.
- [ ] Authenticated **feasibility module UI** checks in a V2 QA preview, including owner/reviewer/outsider, mobile/desktop and cloud save/import/revision conflict.
- [ ] Commercial feasibility plan grant activation, formal collaborative editing and Financial Core V2 organization-handoff contract acceptance **before feature activation**.
- [ ] User review/approval before any merge; separate user approval and pre-release migration review before Production activation.

**Recommendation:** Code may be evaluated for **feature-flagged integration merge** after the final checks and reviewer sign-off; it is **not a customer-ready module** while authenticated feasibility UI QA and independent activation remain outstanding.


## 15 November 2026 — QA-only audited member revocation

- Reviewed the existing authenticated, owner-scoped `feasibility_revoke_project_member` function. It previously revoked active members without writing a permanent event to `platform_audit_events`.
- Added independent migration source `docs/feasibility/qa-v2-audited-member-revocation-20261115.sql`. Revocation now requires an authenticated, valid `TRIAL` or `ACTIVE` owner entitlement, verifies project ownership, rejects attempted owner self-revocation and records one `feasibility.member_revoked` event with actor, project, revoked member and former role.
- A repeated revocation returns `false`, creates no second audit event and does not mutate unrelated users. If audit writing fails the database transaction rejects the status update as well.
- A six-assertion QA V2 rehearsal passed inside a rolled-back transaction (non-owner denied, owner allowed, repeat no-op, exactly one audit, member revoked, read-only denied).
- Applied the migration **only** to Supabase QA V2 `ubotbpjngtfvolthpfec` and confirmed the function definition, anonymous-execution denial and zero remaining synthetic rows. A subsequent rollback-only post-apply test confirmed four more conditions: real revocation, repeat no-op, one persisted-in-transaction audit record and revoked membership.
- Added route-level tests for expired/read-only entitlement. Final-source CI must be verified again after these edits.
- This is **not** permission to enable sharing with real customers: the existing security-advisor warning about three intentionally authenticated `SECURITY DEFINER` RPCs still requires a signed-off threat review. Authenticated V2 QA browser testing of invitation and revocation flows remains pending.
