# Production → Financial Core QA: actual schema compatibility audit
**Audit date:** 2026-11-07. **Method:** direct read-only Supabase PostgreSQL metadata queries for each hosted project. **Verdict: BLOCKED / NOT PARITY.**

## Environments and authoritative baseline
- **Production**: `ZakatFlow Production`, PostgreSQL 17.6; 246 canonical migrations, newest `20261105150000`.
- **Financial Core QA**: `ZakatFlow Financial Core QA`, PostgreSQL 17.11; 228 historic migrations, newest `20261103152354`.
- **PR #360** canonical `supabase/migration-history.json`: 249 migrations. **All 246 Production version IDs occur in this canonical manifest**, with exactly three PR-only migrations: `20261106154742` (group-control evidence), `20261107010000` (branch opening distribution) and `20261107113000` (legacy asset sale cost attestation).
- **Production versus Financial Core QA share only 13 migration version IDs**. Production-only versions: 233; Core-only versions: 215. Version-ID differences alone are NOT a count of distinct functional changes.

## Direct live structure comparison
Generated using `scripts/financial-reports/schema-parity-manifest.sql`. The manifest contains **metadata fingerprints only** (MD5 of definitions) and **no business data, function source, secrets or row values**.

| Object class | Production | Financial Core QA | Production objects missing in QA | QA-only objects | Same key, different fingerprint |
| --- | ---: | ---: | ---: | ---: | ---: |
| All inspected relations (tables/views) | 146 | 120 | 28 | 2 | 0 |
| Columns | 1,873 | 1,596 | 294 | 17 | **0** |
| Functions (incl. private/subscription) | 348 | 279 | 93 | 24 | **16** |
| Explicit RLS policies | 184 | 171 | 13 | 0 | 0 |
| Non-internal application triggers | 222 | 65 | **157** | 0 | 0 |
| Constraints | 942 | 783 | 161 | 2 | 0 |
| Indexes | 390 | 356 | 73 | 39 | 0 |
| Table grant rows | 2,133 | 2,072 | 89 | 28 | 0 |
| Enumerated labels | 41 | 41 | 0 | 0 | 0 |
| Extensions | 5 | 5 | 0 | 0 | 0 |
| Migration versions | 246 | 228 | 233 | 215 | 0 |

**Important correction:** A first-pass column fingerprint included the physical column ordinal and produced 33 misleading differences. Removing ordinal position gave **zero actual type/nullability/default changes in any shared column**; missing columns remain material. The 16 common function mismatches are **actual changed function bodies**, not formatting or permissions differences.

Five of the missing Production relations are archived `private_budget_backups` historical copies, **not required** for runtime feature parity and must **not** be blindly copied into QA. Excluding these leaves **23 missing runtime relations** (including `subscription_private`).

### Critical Production features absent in Financial Core QA
1. **Fiscal and full GL:** `financial_fiscal_calendars`, `financial_fiscal_audit`, `financial_year_closures`, `financial_chart_custom_accounts`, `financial_chart_account_audit`, `financial_opening_source_assignments`, `financial_cash_account_links`, and their relevant functions, constraints, grants and RLS policies.
2. **Subscription lifecycle / enforcement:** `platform_plans`, `platform_subscriptions`, `platform_admins`, `platform_organizations`, `platform_payment_transactions`, `platform_audit_events`, `subscription_private` tables and **numerous `subscription_write_guard` triggers**. A successful isolated subscription CI test does not attest that these guards exist on hosted Financial Core QA.
3. **Personal financial contracts:** `personal_contracts`, `personal_contract_movements`, `personal_contract_installments`, along with personal posting and reversal guards.
4. **Voucher numbering and closed-year immutability:** `voucher_numbers`, `private.voucher_sequence_counters`, `register_voucher_number` triggers and `financial_closed_source_guard` triggers are missing from Core.
5. **16 changed function bodies:** include `financial_statement_live_snapshot`, `financial_statement_live_context`, `financial_opening_workspace`, `save_financial_opening`, `approve_financial_opening`, `financial_reporting_events`, `financial_opening_sources`, debt/Qard and financial reporting-policy commands. **These differences can change report results or approval workflows.**
6. **Core-only legacy objects:** 24 extra routines, 39 extra indexes, and `qa_legacy` QA fixtures; must be kept isolated from any new canonical production-derived QA.

The Postgres **minor versions** also differ (17.6 versus 17.11). This was recorded, **not** interpreted as an automatic compatibility failure: structure and behavior require independent validation.

## Hosted QA data preflight (read-only)
Earlier direct aggregate observation: 71 financial event headers, of which 44 are ACTUAL/REVERSED, and 104 source lines. No orphan lines, cross-organization line references, inactive/missing entity links, invalid/nonpositive bases, missing classifications, FX arithmetic mismatches, invalid directions or duplicated (event,line) numbers in this basic check. **Zero active branches**, **zero approved opening workspaces**, **zero actual/reversed branch-linked events**. These checks do not prove report completeness, user-authenticated visibility or branch/report source certification.

## Strict controlled recovery — do NOT patch existing Core in place
1. Retain existing Financial Core QA as a read-only *legacy comparison target*; protect its fixtures and do not alter migration history to make counts match.
2. Prepare a **new disposable canonical QA database** from the **actual Production schema / 246 migration baseline**, without Production business data. A Supabase branch or clean canonical bootstrap is acceptable only after verifying its **live schema fingerprints against Production**. Branch creation can incur costs; do not create without cost and scope approval.
3. Rehearse the exact three unmerged PR #360 migrations, in order, on that verified baseline. Never run `migration repair`, `db push` or an unreviewed delta against either hosted project.
4. Re-export both schema manifests. **Every Production runtime object must exist with identical relevant fingerprint**; QA-only PR changes must be separately allowlisted and reviewed, not mistaken for Production drift. Ensure grants, RLS, triggers, subscriptions, VAT, asset allocations, financial years, personal finance, and the owner panel.
5. Populate only authorized synthetic or de-identified QA fixtures: legal HQ + two branches, full approved opening, current-year capital with no opening, asset sales from another operator, sales/purchases/VAT, bank transfers, subscriptions/trial expiry, financial year close/reopen and authenticated tenant isolation.
6. Rerun real Auth/PostgREST and browser E2E, source-revision concurrency, report statement/ledger reconciliation, and performance, plus the existing six disposable PR checks.
7. Confirm Production backup **restoration** in an isolated location, obtain accounting/security review, then request explicit merge and publication approval.

**Deployment gate:** stay **BLOCKED**. Green disposable CI is valuable but does **not** certify parity with hosted Production or production user data. No Production, main, hosted Core QA, customer tables, or Hostinger modifications were performed during this audit.

## Repeatable tools
- `scripts/financial-reports/schema-parity-manifest.sql`: read-only export on each database, producing `yaqeen-financial-schema-parity-v1` JSON.
- `scripts/financial-reports/compare-production-core-schema.mjs`: strict manifest diff (exit code nonzero for missing/changed/extra). Archived backup and `qa_legacy` are excluded from *runtime* comparison; subscriptions and all active accounting schemas are not excluded.
- `tests/production-core-schema-parity.test.mjs`: fail-closed comparator regression cases.
- Do **not** commit exported live environment JSON files to the repository; they should be stored only in restricted QA evidence storage.

Official schema drift guidance: https://supabase.com/docs/guides/deployment/database-migrations
