# V4 — source reads in reference-based budget interfaces

The V3 source-read screen was an integration harness, not the final reference layout. V4 replaces that composition at `/design-preview/financial-reports/source` with the reference-based budget structure and retains the actual current CorporateShell sidebar. The nine synthetic design-preview routes remain available and separate; no synthetic numbers are used as fallback in this source-read route.

| Reference | Connected view | Structure |
| --- | --- | --- |
| 04-budget-monitoring | default source route | Five metric cards; monthly budget/actual/utilization; variance bridge; utilization donut; expense detail; source insights; saved budgets; five shortcuts |
| 05-budget-entry | `?screen=budget-entry` | Saved plan/year/scenario; read-only twelve-month grid and source totals; line/chart tabs; target/notes panels; summary, source assumptions and notes sidebar |

Shared ReportCard, Metric, ComboChart, Waterfall, Donut and suite CSS retain the approved visual direction. Metric supports an explicit absent-comparison state. All-zero utilization charts and zero/negative waterfall ranges render without division by zero. Only the active plan's source amounts are used; revenue, expenses and cash are not added into a mixed expenditure total.

Unavailable prior-period figures, growth arrows, economic assumptions, cost-of-sales mappings, target sources and notes are not fabricated. **Prior-period growth is not wired yet**: populating older data alone will not automatically show arrows until an authorized same-scope comparator is added. Gross cash and legacy actual stay separate in export/reconciliation. Saving, approval and publishing remain disabled. No real GL statements are implied.

Read-only source services, SQL contracts, permissions and gates are unchanged. No database migration, hosted data write, merge or deployment. The current finance sidebar and global table rules are preserved.

Local validation: TypeScript, Next production build and all 1041 tests/186 files passed. Regression browser validation passed 36 layouts (nine screens × AR/EN × desktop/mobile) and 13 interaction groups, with zero browser exceptions and zero API requests from the synthetic design preview. The source acceptance workflow additionally exercises real Auth/PostgREST/SSR, live authorized RPC reads, bilingual source layouts, period/annual XLSX and membership revocation. All ten genuine-session acceptance groups passed on code commit `40f233a743262f36f7f5a08238f60fab18aee2e6`: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41506762123 . Eight screenshots and four actual XLSX files are in artifact 13170414411, SHA256 `44b4dde120373425d97f39003ccaea0ba8cb26e3393bf89f87fc60fbf9a855ea`. Zero browser exceptions. Quality/build passed: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41506762222 .

Visual acceptance remains pending. Source content has fewer rows than the generated reference; typography, reconstructed icon shapes, gradients/shadows and some geometry still differ. The original has no separate mobile reference. Do not describe these captures as a pixel-identical implementation or a deployed customer-data acceptance.
