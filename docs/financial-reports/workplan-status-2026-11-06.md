# Yaqeen Business — Financial Reports Workplan (06 Nov 2026)

**Release state:** Draft PR #360 only. No production deployment or merge. No change to the approved global sidebar, stored journal identities or organization balances.

Statuses: **Implemented** = present in the Draft source and locally tested; **Gated** = intentionally unavailable in the live UI until the listed accounting/security proofs exist; **Pending** = no verified end-to-end implementation. **CI-failing** = a release blocker, even if local unit/build tests pass.

## Institutional / مؤسسي

| ID | Task and acceptance requirement | Status | Priority |
| --- | --- | --- | --- |
| I-01 | Four-digit canonical main chart and six-digit industry child templates; parent→child display without renumbering existing postings | **Implemented** template/individual-add UI; isolated authenticated activation & audit QA remains | P0 |
| I-02 | Fiscal calendars (Jan–Dec and Jul–Jun), mapping to opening and statement policy; closed periods immutable | **Implemented** in previous institutional Draft work; full schema QA required | P0 |
| I-03 | Save/reopen balanced or unbalanced opening drafts, approve only when balanced; source-voucher reconciliation and provisional preview | **Implemented** in prior work; latest preceding PR head had five successful CI checks; authenticated accounting acceptance still required | P0 |
| I-04 | Authenticated standalone **company plus branches** statements, dashboard/income/position/cash indicators, exact source exports | **Implemented** through existing full-organization live RPC, subject to policy/approved-opening gates; latest preceding PR head passed browser export CI | P0 |
| I-05 | Three-level scope filter with company, company+branches and group; scope cannot silently show unapproved partial totals | **Implemented** selector; company-direct/group figures correctly **Gated** | P0 |
| I-06 | Legal company direct-only and individual branch reports, linked opening allocations and balanced interbranch clearings | **Pending** trusted full-source branch attribution, versioned openings, approval and source revision proofs. QA-only readiness inventory now distinguishes direct cash/asset accounts, visible branch links, unresolved links and organization-wide opening workspaces; cannot certify statements | P1 |
| I-07 | Server-verified branch and cost-center filtering for each report and export | **Gated**; current selectors intentionally disabled | P1 |
| I-08 | Parent + controlled subsidiaries consolidated reports with actual authorizations, complete membership and ownership/control dates | **Pending**; pre-elimination trial-balance and elimination **pure QA helpers** exist, not a live group report | P1 |
| I-09 | Consolidation layer: intragroup balances/income, unrealized gains, investment/equity elimination, reporting currency, FX and NCI; separately approved and auditable | **Pending** official adjustment ledger, group ownership/FX and accounting review | P1 |
| I-10 | Group/fiscal-year budgets vs actuals, comparative periods and reconciled consolidated export | **Pending** mapped budget scope/FX and full-source attribution | P2 |
| I-11 | Scale/latency gates: EXPLAIN/ANALYZE on authorized canonical reads, pagination, indexes, source-revision cache invalidation, safe export size limits | **Pending** measured QA benchmarks, no Production query | P1 |
| I-12 | Authenticated cross-tenant/branch/group negative tests, mobile/desktop screenshot acceptance, all GitHub required checks green | **In progress**: preceding PR head `f885947c` passed five CI workflows; new transfer/readiness changes need their own checks | P0 |

## Personal / شخصي

| ID | Task and acceptance requirement | Status | Priority |
| --- | --- | --- | --- |
| P-01 | Distinct personal/organization scope, owner-only source access, no company/branch/cost-center selection | **Implemented**, isolated cross-user QA still required | P0 |
| P-02 | Automatic simple **read-only report classification** of cash, receivables, lending/borrowing, investments and other assets without corporate setup | **Implemented**; this is **not** a persistent personal posting account ledger | P0 |
| P-03 | Current personal financial position and estimated net worth per currency, with blocked unreconciled totals | **Implemented** read-only estimate; **not** an audited/historical balance sheet | P0 |
| P-04 | Account-by-account opening, gross inflows, outflows and closing for the selected period | **Implemented**; additional independent source-ID reconciliation separates only two-sided, balanced personal transfers from unclassified cash activity, without changing the gross source rows or treating the remainder as revenue/expense | P0 |
| P-05 | Excel/CSV and browser print/PDF for authorized personal estimates, explicit source/date/basis/warnings | **Implemented in this patch**, local tests; full isolated browser QA pending | P0 |
| P-06 | Certified personal income/expense ledger: user-facing categorization for wages, rent, profit, fees, costs, refunds, gains and accruals, linked to existing transactions/loans/transfers | **Pending** durable classified source and double-entry or equivalent reconciliation; deposits not automatically revenue | P1 |
| P-07 | Verified historical position as of a past date, asset valuation dates, reversals and debt/contract schedule completeness | **Pending** dated and versioned source/valuation policy | P1 |
| P-08 | Genuine personal operating/investing/financing cash-flow classification, transfer elimination and opening/closing reconciliation | **Partially implemented:** verified internal transfer pairs can now be reconciled by persisted transaction `transfer_id`; actual operating/investing/financing classification remains **Pending** | P1 |
| P-09 | Optional advanced personal chart and edit permissions, without mandatory company onboarding; audit/version changes | **Pending**; existing read-only mapping is intentionally non-editable | P2 |
| P-10 | Personal currency translation with explicit effective rates, separate valuation/FX effects, and reproducible base-currency report | **Pending**; current safe per-currency presentation does not add unlike currencies | P2 |
| P-11 | Two real isolated accounts, personal contract reversals, multi-currency, export revocation and mobile/desktop design QA | **Pending** end-to-end Supabase Auth/RLS browser acceptance | P0 |
| P-12 | Performance budget for high-volume personal transactions and exports, authorization-safe queries and pagination | **Pending** measured QA benchmark | P1 |

## Highest-priority dependencies

1. **Keep CI green before merge:** earlier failures in mobile layout/KPI export/onboarding were fixed in preceding PR head; validate the new patch in all five workflows, including mobile browser/export acceptance. Do not bypass failed assertions or delete acceptance tests.
2. **Establish complete canonical source attribution:** every journal/opening line belongs to a legal company; an omitted branch ID means a valid company-direct entry, **not** a draft or orphan. Direct/branch reports require an independently verified allocation and balanced clearing.
3. **Personal P&L source:** design a stable income/expense recognition and transaction classification interface, migration/reconciliation and permission tests in isolated QA. Without this, do not show a fabricated personal income statement.
4. **Group consolidation:** authoritative control/ownership, approvals, eliminations, NCI, FX and permissions for every member before enabling actual consolidated figures.
5. **Release:** full isolated E2E, authorization/regression tests, accurate screenshots in Arabic/English at desktop/mobile, performance benchmarks, backup/restore evidence and **explicit permission to deploy**. Do not modify Production or merge Draft PR #360 automatically.

No percentage-complete estimate is assigned to scope-gated accounting features: implemented UI and pure calculation tests are not equivalent to certified live consolidated statements.
