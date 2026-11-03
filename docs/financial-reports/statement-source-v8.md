# V8 — connected statement acceptance on disposable local Supabase

This stage connects the income, position and cash-flow interfaces to saved canonical Financial Core events in a **synthetic, disposable local database**. It does not connect hosted/customer formal statements, approve an account policy, create a production GL or change the current sidebar. No merge/deployment approval is implied.

## Read path and reconciliation

`financial_statement_qa_snapshot` is a fixture-only, security-invoker RPC. A single SQL statement reads configuration, canonical events, lines, reversal links and coverage counts in the same MVCC snapshot. There is no paginated/limited ledger, stored journal table or second balance store. A 10,000-event/20,000-line limit fails closed instead of truncating data.

The server uses `requireUser` and the caller's existing RLS client; active membership and `financial_core.view` are checked before and after the read. The normalized envelope validates exact decimal strings, scope, period, complete event/line counts, explicit accounts/posting rules and opening provenance before compiling journals. The shared statement engine reconciles all three statements. No service-role client is used for application reads. Context rows are reauthorized too.

`lib/financial-event-ledger.ts` indexes posting rules and event identities instead of rescanning the entire mapping/event list per source line. The statement engine indexes original journals and now rejects applying a full reversal more than once under distinct journal IDs.

Selected-period profit is separate from fiscal-year profit included in equity. Selected cash opening includes earlier fiscal movements. Monthly cash movement/closing is derived from the exact compiled journals, including genuine zero-movement months. Detailed position rows are derived from those same journals and opening, with explicit current/non-current presentation metadata. No missing comparison is presented as growth, no zero denominator becomes a ratio, and no indirect cash adjustments are inferred. Cash is explicitly labelled **direct** presentation.

## Routes and gates

`/design-preview/financial-reports/source-statements?screen=income|position|cash-flow&lang=ar|en`

Requires both `FINANCIAL_REPORTS_SOURCE_QA=true` and `FINANCIAL_STATEMENTS_LOCAL_QA=true`, a strict HTTP loopback Supabase URL, and a non-Production environment. The feature is rejected on hosted Financial Core QA as well as Production. The source RPC/configuration exists only in the disposable fixture. **Do not widen these gates to imply an approved customer ledger exists.**

The existing V3–V6 budget/analysis source API and its unavailable-formal-statements notice retain their behavior. The new statement route is separate so local fixture numbers cannot be combined with another institution's budget snapshot.

## UI and exports

The three pages reuse the current `CorporateShell`, Yaqeen styles, metric cards and chart components. Reference 08/09/02 determines the table/metric/side-panel structure. The source note and scope remain explicit. Current/non-current sections, position reconciliation, asset composition and funding bar use actual fixture projection values. Current amounts fit mobile tables; unavailable note/comparison columns are hidden there. Cash charts opt into a shared scale that includes the cumulative balance, preventing a large opening balance from pushing its line outside the plot. Other preview charts retain their default scaling behavior. Comparison columns remain unavailable until a compatible approved source exists. No fabricated sparkline or arrow is displayed.

CSV and Excel include organization, period, currency, policy/opening identity, local-fixture notice and event/line/rule lineage. Excel monetary values are retained as exact strings to avoid spreadsheet numeric precision loss. Print/save-PDF uses the actual page. Changing organization/period, failure or revocation clears prior figures and disables export. Every CSV/Excel/print action reauthorizes and reloads its complete snapshot before proceeding; a cached view alone cannot authorize an export. A scope/view change during an export cancels its output. Excel is dynamically loaded only on request.

Visual identity is **not declared pixel-perfect**. Differences from references include test account coverage/row count, source/scope notice, unavailable comparison and ratio, direct cash presentation, approved current sidebar, and still-pending fine typography/spacing review. Genuine screenshots and reference comparisons must be reviewed before final visual acceptance.

## Local known answers

Opening bank/equity 500; expense 100 plus recoverable VAT 15; gross supplier payment 115; sale/receipt 200; equipment purchase 40; financing receipt 30.

| Result | Exact amount |
| --- | --- |
| Period and fiscal profit | 100.0000 |
| Assets | 630.0000 |
| Liabilities | 30.0000 |
| Equity | 600.0000 |
| Operating / investing / financing cash | 85.0000 / -40.0000 / 30.0000 |
| Closing cash | 575.0000 |
| From February: selected profit / fiscal profit | 0.0000 / 100.0000 |
| From February: opening / net movement / closing cash | 585.0000 / -10.0000 / 575.0000 |

These are explicit synthetic fixtures, not existing organization balances. A second institution has independently scoped revenue 7000 to detect leakage.

## Verification boundary

Local full unit suite: 1082 tests in 191 files passed before the final table/notice adjustments; TypeScript and focused tests are rerun on final code. Disposable PostgreSQL WASM checks passed six groups for source completeness, RLS, denied roles, write denial, permission revocation and anonymous denial. This WASM check simulates the SQL subject and is not genuine Auth/PostgREST.

The existing GitHub Actions disposable Supabase workflow now also runs genuine statement Auth/PostgREST/Next/browser checks: accounting totals; isolation; desktop/mobile Arabic/English; six XLSX contents; CSV/print; period selection; missing mapping; effective permission and membership revocation, including revocation while a valid cached view is still open at export time. Its source/event/configuration schema is deliberately minimal and synthetic, not the complete deployed VAT/Core schema. Review actual workflow results and artifacts before claiming these checks passed.

## Remaining release blockers

An authoritative complete opening trial balance, approved versioned organization/entity account policy and a reviewed hosted adapter are still required. Existing cash/debt register openings alone cannot establish full equity, assets, liabilities and closed income. Normalization for mixed tax recoverability, partial/cross-fiscal reversals and additional source-module classifications must be approved and tested against their actual canonical contracts. No live formal figures, formal profit cards or real-organization acceptance are claimed by this fixture implementation.
