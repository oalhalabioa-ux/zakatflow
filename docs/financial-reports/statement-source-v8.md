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

Final tested code: `6732203c1c36c3d688aa6b9cd4a5f0d0c401d71c`. Full unit suite **1082 tests in 191 files**, TypeScript, dependency audit/build and Quality passed. The separate Assets Integration QA workflow passed too.

Genuine disposable Supabase [run 41565153300](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41565153300) passed **25 acceptance groups** with zero browser exceptions. This includes the existing budget/comparison/analysis checks and the new statement accounting, isolation, six bilingual page/export combinations, selected-period treatment, cached-view export reauthorization, incomplete mappings and permission/membership revocation. Visual checks specifically assert that mobile current amounts fit their table and that the cumulative cash polyline remains inside the plot.

Artifact `13198831323`, SHA-256 `f7620f62da6c4143baa6e4ed06379c5abc5aecdcf8345d49d2e6718fcf36df81`, contains **47 files**, including 12 new statement screenshots (three pages × two languages × desktop/mobile), six exact-value XLSX files, three printed PDFs and a selected-period CSV. The full evidence also retains the earlier budget/analysis images and exports. The stack was destroyed after success. No hosted data, memberships or schema were changed.

Disposable PostgreSQL WASM checks passed six groups for source completeness, RLS, denied roles, write denial, permission revocation and anonymous denial. This WASM check simulates the SQL subject; genuine Auth/PostgREST coverage comes from the workflow above. The fixture source/event/configuration schema is deliberately minimal and synthetic, not the complete deployed VAT/Core schema.

## Remaining release blockers

An authoritative complete opening trial balance, approved versioned organization/entity account policy and a reviewed hosted adapter are still required. Existing cash/debt register openings alone cannot establish full equity, assets, liabilities and closed income. Normalization for mixed tax recoverability, partial/cross-fiscal reversals and additional source-module classifications must be approved and tested against their actual canonical contracts. No live formal figures, formal profit cards or real-organization acceptance are claimed by this fixture implementation.

## Statement item icon correction

Owner clarification: missing symbols refer to items inside financial statement tables, not sidebar navigation. Income sections/totals now use the reference chart, layers, coins, gear and percent symbols; cash uses operating/investing/financing, receipts/payments, movement and opening/closing symbols; position uses current/non-current asset/liability, equity crown and balance symbols. The shared synthetic statement table and connected local statement table both render these row symbols. Navigation icons, accounting values, source authorization and export columns remain unchanged. Symbols follow text direction, remain visible on mobile and inherit total-row contrast. The six genuine page acceptance captures assert required statement-item symbols before screenshots.

The corrected item icons passed TypeScript, the full 1082-test suite, build/Quality and Assets Integration QA on code `7db9f98ebe467072df197ca96de94cf5a0945c64`. Genuine isolated source run [41568772218](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41568772218) passed all 25 acceptance groups, including required statement-item icons in all six AR/EN statement pages before desktop/mobile captures. Updated artifact `13200626141` has SHA-256 `ced05861565232f98f73548a4f3f66eadf7609180bfb8971b71b8cbe3010efb2`. This supersedes the V8 screenshots for statement item symbols only; the local-fixture/live-integration limits above remain in force.


## Expand/collapse correction

Owner reported that connected statements lacked arrows and could not fold child items. A shared, native-button disclosure now controls actual child rows, with `aria-expanded`, unique `aria-controls`, directional chevrons, visible keyboard focus and Enter/Space activation. Position uses its existing account hierarchy. Income child values use selected-period movements from the same compiled journals, never fiscal closing balances. Cash children aggregate the explicitly mapped cash activities by canonical event type and receipt/payment direction; individual event references remain in source provenance. This keeps the rendered cash hierarchy bounded rather than creating one DOM row per journal. No counterparty/category mapping is invented.

Only rows with actual children expose arrows. Parent/subtotal/grand-total figures remain visible and unchanged when details are folded. Organization/period/view changes reset the table instance. Full exports always include all details independently of fold state, and print CSS expands hidden details without changing on-screen state. The shared synthetic preview table uses the same control and no longer offers misleading arrows on opening/closing leaf rows.

The genuine browser runner now exercises desktop Enter/Space, mobile click, scoped hiding/reopening, unchanged totals, exports while folded and complete printed details for all six bilingual statement views. Expanded/collapsed screenshots are captured on both viewport sizes. A standalone offline interaction preview uses the exact same React table and a snapshot read through the genuine isolated API; it is clearly labelled synthetic/local and has no database connection. The image-only comparison gallery is not presented as an interactive application.

Expand/collapse validation: final code `a920d2bd63a75ffecdfe6cdf8311606c9c829a05` passed 1086 tests in 191 files, TypeScript, build/Quality and Assets Integration QA. Genuine isolated source [run 41572961561](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41572961561) passed all 26 acceptance groups with no browser exceptions. Disclosure glyphs are explicitly checked at >=18px in both viewport sizes, avoiding the legacy compact-position CSS shrinking the arrows. Required source interactions, unchanged totals, folded exports/full print and the offline React replay all passed. Artifact `13201704089`, SHA-256 `404c4f390d6208376ab2076ec88dd09762e16eaf9072ecac017940f65ba4eb2a`, contains 61 evidence files, including 12 additional collapsed-state screenshots and the tested offline interaction file. Row hierarchies/indexes are memoized so folding does not reaggregate journal details or read the backend. All hosted/Production gates remain closed.
