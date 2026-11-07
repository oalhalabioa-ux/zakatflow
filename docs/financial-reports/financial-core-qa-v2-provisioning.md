# Yaqeen Financial Core QA V2 — actual provisioning and safe cutover

Audit date: **2026-11-07**. **Schema gate: PASS**. **Authenticated browser / full-financial release gate: BLOCKED**. Production and former Financial Core QA were not modified.

## 1. Actual new isolated resources

- New Supabase project: **Yaqeen Financial Core QA V2** (`ubotbpjngtfvolthpfec`), organization `Obada` (`tckuzqohfjilqfdudclh`), region `eu-central-1`, status `ACTIVE_HEALTHY`.
- User approved Supabase's quoted **USD 10/month** on 2026-11-07; a cost-confirmation ID was obtained and used once to create this **new** project.
- Original Production Supabase: `ejpzcsfwqziqxwhvqnay`, **read-only inspection only**; original Financial Core QA: `wtzgzmcgcqouziqzsfnl`, retained intact; neither has been reset, altered or used as a migration target.
- New separate Vercel project: **yaqeen-financial-core-v2-qa** (`prj_cIomHwWGkWqEvAvr2mxGxbSHDd7z`). Its four environment variables point **only to the new V2 database**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public/anon, not service_role), `NEXT_PUBLIC_SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_APP_ENV=qa`. **No Production Vercel settings/domains changed**, nor any changes to the older unlinked `zakatflow-qa` Vercel project.
- QA-only PR #360 Git build created: `dpl_HE1hGnNBQFsSdNwvGh55LHRNMr62`, source commit `ba4daf7c8f10731e60bf31713f649bad81eb5978`. At the time of the audit it was queued/building; **do not claim live UAT passed until READY and tested**.
- Initial new-project deployment `dpl_ConMU9F1LaibTGNcE7vcaiGVChi3`, internally targeted at the QA project's Vercel production environment **before QA variables were installed**, was explicitly **canceled**. This was a deploy in a **new, QA-only** Vercel project, **not** a change to the customer's Production Vercel project `zakatflow`.

## 2. Production canonical migration rebuild — COMPLETE

- Direct current Production verification: **246 migrations**, last `20261105150000`, Vercel Production Git SHA `939cc6cfe2cdbb0d430a10d2228dc8bb0109512c`.
- V2: **246 original Production SQL migration files** applied cleanly in canonical order from `supabase/migration-history.json`; on top, the **three PR-only** migrations `20261106154742`, `20261107010000`, `20261107113000` applied cleanly **only to V2**.
- V2 installed history **249** entries, checked **249/249** ordered mapped names `prod_<original_version>_<name>` / `pr360_<original_version>_<name>`. Supabase's connector assigns new execution timestamp IDs; do not mistake these for the canonical original versions or force `migration repair`.
- Direct read-only fingerprints compared Production to V2 after 246 migrations and again after 249: **zero missing or changed operational relations, columns, function bodies, RLS policies, triggers, constraints, indexes and table grants**.
- The only Production items absent after 246 are **five** historic tables and **63** columns in `private_budget_backups` (2026-09-23 archival snapshots, not runtime tables). They were deliberately **not** copied because that would move historical Production records into QA.
- After 249, the only operational additions relative to Production are the **expected additive PR #360 database objects**: four private control/branch relations, 48 columns, eight function signatures, 37 constraints and 11 indexes. **Zero differences in existing shared object fingerprints**.
- PostgreSQL minor versions differ (Production `17.6`, V2 `17.11`), so native version behavior and application compatibility still need actual runtime coverage.

## 3. Data isolation — CHECKED

Read-only hosted V2 aggregate inspection found **zero** actual Auth users, organizations, organization members, financial events, financial event lines, financial opening workspaces, customer subscriptions, branch opening allocations and group controls. Five subscription plan templates are normal migration-created **static defaults**, not customer records. No Production Auth users, email addresses, passwords, transactions or invoice data copied.

PostgreSQL `pg_cron` / `pg_net` are not installed in new V2; no `cron` jobs tables present in the inspected database. No production Resend, ZATCA, payment provider, third-party webhook or live domains were configured as QA Vercel settings.

## 4. Live hosted QA results — 17/17 SQL checks performed

**Two read-only checks passed:** full Production source-schema contract (`qa-financial-production-parity-contract.sql`) and hosted readiness inventory (`qa-financial-hosted-readiness.sql`); the readiness inventory correctly **reported BLOCKED** for missing approved branch fixtures and atomic/authenticated-source certification.

**Fifteen rollback-only synthetic transaction tests passed on hosted V2** (each test explicitly started a transaction and ended with `ROLLBACK`, with no persisted test rows):

1. `qa-financial-group-control-evidence.sql`
2. `qa-financial-branch-opening-distribution.sql`
3. `qa-financial-chart-accounts.sql`
4. `qa-financial-fiscal-budget-calendar.sql`
5. `qa-financial-chart-posting-rules.sql`
6. `qa-financial-chart-opening-leaf.sql`
7. `qa-financial-policy-coverage.sql`
8. `qa-financial-first-activity-snapshot.sql`
9. `qa-financial-production-normalized-parts.sql`
10. `qa-financial-production-legacy-sources.sql`
11. `qa-financial-production-legacy-approved-opening.sql`
12. `qa-financial-production-legacy-rls-gap.sql`
13. `qa-unified-cash-openings.sql`
14. `qa-cash-account-link-sync.sql`
15. `qa-bank-opening-correction.sql`

All six disposable GitHub acceptance workflows were green at PR head `ba4daf7c`. These do **not** substitute for an app-level signed-in PostgREST/browser test.

## 5. Remaining cutover blockers — NO PRODUCTION RELEASE

- [ ] Vercel QA build at exact source SHA is `READY`, returns expected bilingual pages and uses V2 (not legacy QA/Production).
- [ ] QA Supabase Auth URL/redirect settings, supported sign-up method, and QA-only login/test users correctly configured; do not use live Google OAuth or Resend without QA credentials and isolated outbound policies.
- [ ] Authenticated application E2E across real roles, personal/organization/branch/head office, assets, VAT, budgets, opening approval, reports/export, users/invites and trial read-only; isolate real-user service credentials.
- [ ] Approved opening, branch actual posted journal and group-control fixture data; reconciliation of detailed statements/financial core revision, corporate vs personal, double-count and under/over allocation, source snapshot atomicity, RLS mismatch, large-volume performance.
- [ ] Review Supabase security advisors. Two **existing Production-derived** `public.guard_non_asset_purchase_*` trigger functions are marked by the advisor as `SECURITY DEFINER` callable by `anon`; these functions have return type `trigger` and are attached to asset/transaction triggers. Verify hardening compatibility and legitimate trigger execution before any `REVOKE`. Advisor: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable .
- [ ] Demonstrate restorable Production backup in a **separate isolated recovery environment**, without touching Production.
- [ ] Switch **QA-only** test endpoints after acceptance; preserve old Supabase QA project pending archive/recovery review, then seek separate approval for pause/deletion and related cost reduction.
- [ ] Obtain explicit owner approval **only after all release gates pass** for PR #360 merge and Production deployment.

**PR #360 remains Draft and unmerged.** Green schema parity is not certified accounting output. Do not run migration repair or copy physical Production backup and its real Auth/customer data into V2.

Reference: `docs/financial-reports/production-core-compatibility-audit-2026-11-07.md`, `scripts/financial-reports/schema-parity-manifest.sql`, Supabase clone warning https://supabase.com/docs/guides/platform/clone-project .
