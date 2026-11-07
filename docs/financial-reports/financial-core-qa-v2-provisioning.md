# Yaqeen Financial Core QA V2 — actual provisioning and safe cutover

Audit date: **2026-11-07**. **Schema gate: PASS**. **Authenticated browser / full-financial release gate: BLOCKED**. Production and former Financial Core QA were not modified.

## 1. Actual new isolated resources

- New Supabase project: **Yaqeen Financial Core QA V2** (`ubotbpjngtfvolthpfec`), organization `Obada` (`tckuzqohfjilqfdudclh`), region `eu-central-1`, status `ACTIVE_HEALTHY`.
- User approved Supabase's quoted **USD 10/month** on 2026-11-07; a cost-confirmation ID was obtained and used once to create this **new** project.
- Original Production Supabase: `ejpzcsfwqziqxwhvqnay`, **read-only inspection only**; original Financial Core QA: `wtzgzmcgcqouziqzsfnl`, retained intact; neither has been reset, altered or used as a migration target.
- New separate Vercel project: **yaqeen-financial-core-v2-qa** (`prj_cIomHwWGkWqEvAvr2mxGxbSHDd7z`). Its four environment variables point **only to the new V2 database**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public/anon, not service_role), `NEXT_PUBLIC_SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_APP_ENV=qa`. **No Production Vercel settings/domains changed**, nor any changes to the older unlinked `zakatflow-qa` Vercel project.
- QA-only PR #360 preview **READY**: `dpl_HE1hGnNBQFsSdNwvGh55LHRNMr62`, source commit `ba4daf7c8f10731e60bf31713f649bad81eb5978`, **Vercel target Preview** (not the actual Yaqeen Production website). Protected branch alias: `https://yaqeen-financial-core-v2-qa-git-feat-or-568599-oalhalabioa-9334.vercel.app`.
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

## 4A. Deployed QA preview HTTP/compiled-config verification

Using the Vercel authenticated fetch on the isolated QA deployment (SSO remained enabled), the **Arabic and English login pages returned HTTP 200** with correct language HTML. The actual Next.js browser chunk `app/[locale]/login/page-66b0e34784e63e86.js` was checked: it embeds `https://ubotbpjngtfvolthpfec.supabase.co`, includes the built-in `QA_DATABASE_ISOLATION_REQUIRED` guard, and does **not** embed Production project ref `ejpzcsfwqziqxwhvqnay`. This verifies **the compiled browser bundle's V2 database configuration**, not a real authenticated user workflow. Anonymous protected screens display login content; no financial source records were returned.

**Discovered QA-only application flag gap:** First deployed preview has `FINANCIAL_OPENING_WORKSPACE` and `FINANCIAL_STATEMENTS_LIVE` disabled, so its `/api/financial-reporting/live-statements?action=context` returned HTTP 404 `REPORTING_UNAVAILABLE`. The following seven **QA Preview-only** variables were subsequently saved on the new QA Vercel project (not on Production or legacy QA): `FINANCIAL_OPENING_WORKSPACE`, `FINANCIAL_STATEMENTS_LIVE`, `FINANCIAL_SOURCE_REPLAY_GUARD`, `FINANCIAL_FIRST_ACTIVITY_REPORTING`, `FINANCIAL_SCOPE_PREFLIGHT`, `FINANCIAL_BRANCH_EVIDENCE_QA`, and `FINANCIAL_SOURCE_INTEGRITY_DIAGNOSTICS` — all `true`.

**Deployment blocker:** redeploy at PR commit `e383d7a0bcd7bbdba6b98f68cd5a629c19cac32c` was **rejected by Vercel 402**: team Hobby `api-deployments-free-per-day`, more than 100 deployments, `retryAfter=86400`. The CLI fallback was not run because linked local Vercel credentials were unavailable and the account was already at its quota. **Do not state the seven toggles are live** on the currently READY preview. Rebuilding this *isolated QA project* after the provider limit resets is required, then retest real unauthenticated `401` for financial APIs and signed-in flow.

Deployment Protection remained on (`ssoProtection.enabled=true`), no long-lived bypass was created and no secrets exposed in the QA build evidence. Temporary Vercel-authenticated fetch access was used for the HTTP smoke test only.

## 5. Remaining cutover blockers — NO PRODUCTION RELEASE

- [x] Vercel initial QA preview is `READY`; bilingual login pages HTTP 200, compiled code points to V2 (not legacy QA/Production).
- [ ] **Quota-blocked redeploy** with new QA-only report/opening flags; complete authenticated report API and browser UAT on the newly rebuilt immutable deployment.
- [ ] QA Supabase Auth URL/redirect settings, supported sign-up method, and QA-only login/test users correctly configured; do not use live Google OAuth or Resend without QA credentials and isolated outbound policies.
- [ ] Authenticated application E2E across real roles, personal/organization/branch/head office, assets, VAT, budgets, opening approval, reports/export, users/invites and trial read-only; isolate real-user service credentials.
- [ ] Approved opening, branch actual posted journal and group-control fixture data; reconciliation of detailed statements/financial core revision, corporate vs personal, double-count and under/over allocation, source snapshot atomicity, RLS mismatch, large-volume performance.
- [ ] Review Supabase security advisors. Two **existing Production-derived** `public.guard_non_asset_purchase_*` trigger functions are marked by the advisor as `SECURITY DEFINER` callable by `anon`; these functions have return type `trigger` and are attached to asset/transaction triggers. Verify hardening compatibility and legitimate trigger execution before any `REVOKE`. Advisor: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable .
- [ ] Demonstrate restorable Production backup in a **separate isolated recovery environment**, without touching Production.
- [ ] Switch **QA-only** test endpoints after acceptance; preserve old Supabase QA project pending archive/recovery review, then seek separate approval for pause/deletion and related cost reduction.
- [ ] Obtain explicit owner approval **only after all release gates pass** for PR #360 merge and Production deployment.

**PR #360 remains Draft and unmerged.** Green schema parity is not certified accounting output. Do not run migration repair or copy physical Production backup and its real Auth/customer data into V2.

Reference: `docs/financial-reports/production-core-compatibility-audit-2026-11-07.md`, `scripts/financial-reports/schema-parity-manifest.sql`, Supabase clone warning https://supabase.com/docs/guides/platform/clone-project .

## 6. User-reported UI parity gaps vs current Production — verified 2026-11-07

**Important:** A successful **schema parity gate** does not mean that hosted Financial Core QA V2 is a functionally identical, ready-to-use **application** clone.

Read-only review of the exact immutable Vercel deployments and GitHub refs:
- Production `zakatflow` main deployed SHA `939cc6cfe2cdbb0d430a10d2228dc8bb0109512c`, status READY.
- V2 QA Git Preview deployed SHA `ba4daf7c8f10731e60bf31713f649bad81eb5978`, status READY. QA branch currently has **200 commits ahead**, **zero behind**, compared with deployed Production main.
- GitHub comparison: 113 visible changed files, of which 79 are added and 34 modified, **none deleted** (comparison limited to returned files). A newer QA build is needed after environment flags change.
- Public `/` and `/ar/login` fetched from the immutable **Production** and **QA** Vercel deployments returned HTTP 200; the extracted visible login/marketing text agreed. This does **not** verify authenticated workspace UI pixel parity.
- QA `financial-reports` page now routes `scope=PERSONAL` to `PersonalFinancialStatements`; `OrganizationSettings` adds a setup-journey shortcut and fiscal/accounting pages. Navigation scope and report-source components also changed; these are **new PR-only behavior**, not proven to be in current Production.
- `components/financial-reports/FinancialStatementSource.tsx` contains a branch selection explicitly `disabled` with “Branch — filter pending integration” and a cost-center selector explicitly `disabled` with “Cost center — filter pending integration”. These are **code-level incomplete features**, not missing SQL migrations or account permissions; do **not** mark them complete or enable them by CSS.
- V2 contains **zero production Auth users, tenants, financial events, or approved openings** by design. Menus, org selectors, company HQ/branches and financial data cannot match an existing signed-in Production account without a **synthetic QA owner/organization/HQ/branch fixture and QA-only Auth allowlisted redirect**. Copying real Production user data to make a visual match is expressly prohibited.
- Production has financial opening and live statements flags enabled. The first QA preview was built before its QA-only seven financial flags were set. Actual QA API request `/api/financial-reporting/live-statements?action=context` returned 404 `REPORTING_UNAVAILABLE`, confirming **functional mismatch** in the deployed build. The QA Preview-only flags are now configured, **but Vercel returned 402 `api-deployments-free-per-day`** on attempted rebuild, so they cannot be considered active until a new READY deployment is inspected.
- No app-level authenticated workflow, real browser screenshots from logged-in Production/QA in identical roles, or report amount reconciliation against a maintained synthetic fixture have yet been certified.

### Mandatory acceptance contract before declaring V2 the official Core replacement
1. New **QA-only** Preview build at the approved PR head after Vercel API quota resets. Inspect actual environment and confirm unauthenticated report/opening APIs return **401 rather than feature-disabled 404**; never remove auth to pass.
2. Keep the **same approved Production site/logo/theme/nav/module interactions** by comparison of matching desktop/mobile pages and common role/scope; new financial pages must be additive and maintain existing routes rather than silently substituting old behavior.
3. Configure isolated QA Auth site URL and redirect allowlists for the dedicated Vercel domain; use **QA-only synthetic credentials**, no Production Auth users, Resend secret or OAuth client shared with live tenants.
4. Create/persist **synthetic** representative personal and corporate owner + subsidiary + HQ/two branches with matched account chart, 1-Jan and 1-Jul years, cash, assets, transactions, opening, VAT/refunds, and trial subscriptions. Use real supported Auth administration/registration APIs, not fake manually inserted long-lived `auth.users` records.
5. Record a module-by-module parity matrix: navigation, organizations/roles, cash/banks, assets, purchases/sales/VAT, receivables/payables, budget, financial reports, account chart, opening balances, fiscal years, users/invites, owner/subscription admin, bilingual and mobile themes. Classify each variance as (**intentional PR enhancement**, **QA seed/auth difference**, **feature-flag mismatch**, **unimplemented feature**, **regression**) and assign acceptance evidence.
6. Implement and certify **real branch/cost-center report filtering** (or explicitly retain it as a rejected/incomplete task), source revision atomicity, personal/institutional/group totals and elimination; do not suggest disabled control is working.
7. For identical test fixtures and role permissions, run signed-in browser screenshots and accounting totals for Production baseline behavior **without copying private Production customer data**. Record errors and fix only in PR/QA.
8. **No Production release, existing QA deletion, or PR merge** until all mandatory gates are signed off.

**Status: schema/SQL contract PASS; hosted browser feature parity FAIL/BLOCKED.** The user-reported missing/inactive features are valid unresolved QA defects, not a claim of full release readiness.
