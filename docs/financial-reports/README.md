# Financial reports, statements and budgets — nine-screen preview

Product approval: overview content approved on 2026-11-02; the owner requested the **existing finance-platform sidebar**, not the illustrated reference sidebar. All nine screens are now implemented as real React interfaces. This is a design/integration preparation branch, **not approved for merge or deployment**.

Branch: `feat/financial-reports-pilot-20261102`, draft PR #341. No Production writes, schema migrations, user/account changes, or deployment occurred.

## Preview routes

`/design-preview/financial-reports/{screen}?lang=ar` (or `en`). Nine screen IDs:

| Screen | Approved reference | Function |
| --- | --- | --- |
| overview | 01 | Financial reporting dashboard |
| statements | 07 | Financial statement index |
| income | 08 | Income statement |
| position | 09 | Financial position |
| cash-flow | 02 | Cash flow statement |
| kpis | 03 | Financial KPIs |
| budget-monitoring | 04 | Budget versus actual |
| budget-entry | 05 | Detailed monthly budget |
| analysis | 06 | Management analysis |

Every route requires local `FINANCIAL_REPORTS_DESIGN_PREVIEW=true` and remains 404 when `VERCEL_ENV=production`. Invalid screen IDs return 404. Automatic Vercel deployment stays disabled for this branch. Do not set the flag on a public/unprotected deployment.

`FinancialReportsSuite` uses the actual `CorporateShell`, its brand assets, sidebar styles, icon system, desktop collapse preference, mobile rail/drawer and focus behavior. Optional preview-only shell props suppress the real data-fetching topbar/subscription banner and inject the new module's links. Normal callers retain their default shell. Existing asset reports, owner administration and other theme styles were not replaced. No copy of the sidebar design or global table-density change was made.

## Working preview behavior

- Arabic/English; nine independent routes and navigation links; four tested viewport sizes.
- Synthetic organization, reporting period, comparison and currency controls. USD conversion uses a clearly marked **synthetic** 3.75 SAR/USD rate.
- Collapsible statement groups, source/detail explanatory dialogs and keyboard/mouse chart selection.
- Editable monthly budget, calculated gross/operating profit, copy January across a row, scenario multiplier, notes and a variance-column toggle.
- Actual CSV and Excel downloads reflect selected filters, edited monthly values and scenario; CSV formula-like text is escaped. Real browser print/PDF for all eight new pages.
- Approval and publishing remain disabled. Draft/save/schedule messages explicitly explain local-only behavior. No archived report or unspecified page is fabricated. The equity-change/notes cards shown by reference 07 explain that those extra pages remain outside the approved nine-screen scope.

## Source review and integration boundary

Existing sources to reuse remain `services/budget-planning.ts`, `lib/budget-planning.ts`, `services/financial-budget.ts`, `lib/financial-budget-ui.ts`, existing financial events/facts, cash reconciliation and authorization. Preserve `ACTUAL` versus draft lifecycle, canonical source identities, mapping/reconciliation warnings, expense-aware variance, RLS and effective permissions. Do not treat legacy manual actuals or mixed dashboard totals as independently authoritative financial statements.

Read-only `information_schema` queries were run against **Financial Core QA and Production**, without customer-row reads or any writes. `source-catalog-review.json` records the observed tables/columns. Both contain the financial-event and budget contracts; neither catalog search in public/private found debit/credit, account-code or journal columns. This evidence supports an integration gap; it is not a claim that any conceivable external ledger cannot exist.

`financial_event_lines` has positive `amount/base_amount`, classification and cash direction. Those fields alone cannot safely establish both sides of a formal journal, opening trial balance, closing/retained-earnings or cost-of-sales mapping. **Live statement integration remains incomplete.** No positive-only event was guessed into a debit/credit entry, no new balance store was created, and no QA/Production guard was removed.

`lib/financial-statement-engine.ts` now provides a pure, read-only projection contract for an authoritative posted GL. It calculates all three statements from the same inputs using exact decimal arithmetic. It checks scoped organization/currency, mapped accounts, balanced openings/journals, date boundaries, distinct sources, original/reversal pairs, explicit cash activities and cash transfers. Fiscal-year profit is distinguished from selected-period profit. It is not a database, API, authorization layer, or deployed accounting adapter. Its known-answer tests are not real RLS or real-account browser acceptance.

The next integration prerequisite is an explicit canonical account/report mapping and an authorized server adapter capable of delivering balanced, posted journals and a fiscal opening trial balance from existing recognition sources. Validate that adapter in isolation before any live reading or schema rollout. At that stage, run real multi-user/multi-institution RLS/revocation tests, accounting reconciliations and bilingual exports. Do not infer completion from the fixture demo or projection unit tests.

## Reproduce

```sh
FINANCIAL_REPORTS_DESIGN_PREVIEW=true npm run dev
node scripts/financial-reports/build-suite-preview.cjs ../deliverables/Yaqeen_Financial_Module_V2.html
PILOT_CHROMIUM_PATH=/path/to/chromium node scripts/financial-reports/verify-suite.cjs
# Use the final production build in isolation:
SUITE_PRODUCTION_BUILD=1 PILOT_CHROMIUM_PATH=/path/to/chromium node scripts/financial-reports/verify-suite.cjs
# Recheck interactions without repeating unchanged layout captures:
SUITE_INTERACTIONS_ONLY=1 SUITE_PRODUCTION_BUILD=1 PILOT_CHROMIUM_PATH=/path/to/chromium node scripts/financial-reports/verify-suite.cjs
```

Playwright is supplied by the task runtime or installed separately. No application dependency/lockfile was changed. The standalone HTML bundles the same React components, fonts, brand assets and CSS; only Next navigation is replaced by local hash navigation. It works without a database or hosted URL. It passed all nine local page checks without browser exceptions.

First-pilot results in `validation.md` are historical; use `suite-validation.md` and `visual-diff-v2.md` for the current stage. Review the nine reference/implementation comparisons before final visual acceptance. No 100% pixel-identity claim is made.
