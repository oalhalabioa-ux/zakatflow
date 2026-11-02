# Financial reporting — first-page approval pilot

Status: Gate 1 visual review; **not approved, not connected to accounting data, not for merge or release**.

Base: main `9f5e2807c5e51e52e3eec97ca9bc77bed2821a8e` (PR #333). PR #329 was already merged (`ca1aa7e4`). Branch: `feat/financial-reports-pilot-20261102`. Only the first of nine approved screens is implemented. Existing asset `/[locale]/reports`, owner UI, table work, themes and auth are untouched.

## Gate 0: source review

| Existing source/component | Reuse decision | Remaining verification |
| --- | --- | --- |
| `services/budget-planning.ts`, `lib/budget-planning.ts` | Keep saved plans, scenarios, monthly grids, approval states and expense-aware variance rules | Legacy `monthly_actual` is not an independent authoritative actual |
| `services/financial-budget.ts` | Reuse existing report/drilldown RPC contract after environment/readiness review | `assertFinancialBudgetQA` pins these UI reads to a specific QA project; do not lift that guard merely to populate the new UI |
| `lib/financial-budget-ui.ts`, `components/FinancialBudgetCorePanel.tsx` | Reuse typed report rows, grouping and drilldown semantics later | Preserve unmapped/legacy reconciliation warnings and nonadditive ratios |
| `services/financial-events.ts`, `lib/financial-event-command.ts` | Existing source identities, lifecycle, effective permissions and actual event linkage | `financial_event_lines` uses positive `base_amount`, classification and cash direction. This reviewed contract is not proof of a complete debit/credit GL or closing/trial-balance engine |
| `financial_budget_report`, operational facts and ownership/mapping migrations | Candidate authoritative budget actuals; include `ACTUAL` recognition and avoid duplicate settlement recognition | Review subsequent migration overrides and verify on an isolated DB before enabling reads |
| `services/platform-financial-overview.ts` | Reference for authorized organization/context handling; do not sum its mixed-source cards into formal statements | Current group/VAT/cash/budget summaries are not elimination-based consolidated statements |
| `app/[locale]/reports/page.tsx`, asset reports and VAT reports | Preserve existing functions and routes | Asset valuation and VAT reports are not the full financial statements |
| Existing Cairo fonts and ExcelJS | Reused without additional application dependencies | Reference typography/icons are approximate; see visual-diff log |

This was a repository source review, not an inspection of live Production or QA schema/data. Before Gate 3, establish a canonical account/report mapping, opening balances, posted entries, reversals, accruals, cost of sales, depreciation, tax/zakat, closing/retained earnings and trial balance. Prove assets = liabilities + equity and cash movement reconciliation. If a complete authoritative GL already exists in another contract, bind to it instead of rebuilding or duplicating balances. No DB changes are included in this pilot.

## Preview and evidence

`/design-preview/financial-reports` with `FINANCIAL_REPORTS_DESIGN_PREVIEW=true`. The route is dynamic, noindex, off by default, and returns 404 on `VERCEL_ENV=production` even with the flag. Keep the flag local; do not enable a public unprotected deployment. Synthetic fixtures have no imports from data/auth services, no API requests, no database, no organization/member writes. Preview entity switching is not an RLS test.

```sh
FINANCIAL_REPORTS_DESIGN_PREVIEW=true npm run dev
node scripts/financial-reports/build-preview.cjs ../deliverables/Yaqeen_Financial_Reports_Pilot.html
PILOT_CHROMIUM_PATH=/path/to/chromium node scripts/financial-reports/verify-preview.cjs
# For Next route rather than the standalone bundle:
PILOT_URL=http://127.0.0.1:3100/design-preview/financial-reports PILOT_CHROMIUM_PATH=/path/to/chromium node scripts/financial-reports/verify-preview.cjs
```

Playwright is a verification prerequisite, available through the task runtime or installed separately; the app's dependencies/lockfile were not changed. Standalone HTML contains exactly the same React component, bundled fonts/CSS/ExcelJS; it does not create a separately implemented UI. No external requests are needed to open it. HTML is a local review artifact, not a hosted/private-auth URL.

Working: demo entity switch; last 12/6/3 months; keyboard/mouse month tooltip; recent-report search and empty state; English/Arabic; mobile drawer; CSV and actual XLSX matching selected entity/period; print/save PDF. Schedule form is explicitly local-only. Other modules/report rows open explanatory previews because they await approval; there are no pretend report-file downloads.

## Acceptance gates after this pilot

1. Product owner approves first-page desktop and responsive layout against reference 01.
2. Implement the other eight approved pages with independent visual evidence.
3. Bind read-only authoritative source contracts; unavailable inputs remain unavailable. Preserve identity, organization, entity, cost center, currency and accounting period throughout.
4. Run real disposable DB/API/RLS tests (two institutions/users, denied roles/revoked membership), known-answer financial statements and cash reconciliation, AR/EN exports and E2E. No claim that those future integration tests have passed.
5. Recheck latest main/table changes; obtain final approval before merge/deployment.

Suggested controls: document each KPI formula and source; use deterministic comparison fixtures; track visual differences by page; reconcile each report to one source snapshot and shared filter scope; version accounting mappings to avoid silent historical restatement. These controls add no unapproved screens.
