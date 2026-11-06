# Yaqeen Business — Financial reporting scope and consolidation architecture

**Status:** Approved product-design requirement; **not implemented by this document**.  
**Scope:** All current and future organizations in Yaqeen Business.  
**Release safety:** Keep this document on Draft PR #360. No changes to Production, existing journal postings, opening balances, or the approved global sidebar.

### Implementation checkpoint — 2026-11-06 (Draft PR #360)

- Added `lib/financial-group-rollup.ts`: a read-only, precision-safe **pre-elimination trial-balance rollup** with explicit expected legal entities, validated shared 4-digit parents / child account mappings, balanced-source checks, duplicate-account rejection, same period and currency preflight, and member-level drilldown. It intentionally returns `PRE_ELIMINATION_ONLY`, **not** a group statement.
- Added accounting acceptance tests in `tests/financial-group-rollup.test.ts` covering duplicates, incomplete membership, mapping failures, unbalanced sources, currency/period mismatch and zero-opening organizations.
- Added an in-page scope selector to the existing financial-statements UI; currently the whole legal-company source is active. Direct-headquarters and group consolidation explicitly show integration requirements and suppress figures/exports. The approved global sidebar remains untouched.
- **Not yet implemented in live reporting:** server-side group membership authorization for the rollup, persistent per-branch opening allocation and journal attribution, audited/approved group adjustment ledger, ownership/NCI, IAS 21 translations, group statements, group budgets and reporting exports. The helper is not wired into any public/production financial API.

### Implementation checkpoint — Phase 2 accounting preflight (2026-11-06)

- `lib/financial-group-adjustments.ts`: added an **in-memory, group-only elimination worksheet** that takes the prior validated pre-elimination result and explicit evidence-backed, balanced elimination lines. It supports staged reciprocal balances, intra-group income/expense and unrealized-profit **manual entries**; never changes source vouchers, opens a database connection, posts a journal or claims approval. Each entry requires two in-scope legal entities and source references. Its result is `GROUP_ADJUSTMENT_PREVIEW_ONLY`, not a statutory consolidated statement.
- `lib/financial-branch-allocation.ts`: added an isolated preflight requiring an explicit **complete canonical source attestation** (full organization scope, source line count and source revision), plus allocations of **every canonical opening and journal line** to actual internal branch IDs, exact allocation totals, no duplicate source rows and separately balanced branch trial balances. An incomplete opening allocation or uncleared interbranch transfer produces `BLOCKED` with **no partial branch figures**.
- These are verifiable pure calculation primitives, **not yet connected to Supabase/API or user-facing group totals**. They need a trusted, all-lines canonical source, legal control/ownership dates, permissions per group member, and audit/approval/FX policies before enabling the scope tabs. A balanced subset of ledger data alone cannot prove that the underlying source extraction was complete.
- Pending: authorize **every** legal entity server-side, verify source completeness through a scoped RPC or authoritative revision/count, record branch dimension and opening split without rewriting history, implement period alignment, currency translation, acquisitions/NCI and tax effects, and run full live QA in an isolated database.

### Implementation checkpoint — Phase 3 live-source readiness (2026-11-06)

- Queried the existing **Financial Core QA** Supabase schema and aggregates read-only; no SQL migration, QA data mutation, Production query or branch provisioning. The QA instance had **44 ACTUAL/REVERSED events**, including **6 without `entity_id`**, and **0 approved opening workspaces** (a point-in-time observation, not a statement that all organizations are similarly configured). Those six events **do have `organization_id`**: a missing optional branch identifier does not mean a missing parent company. They belong to a linked investment-contract flow; do not delete its posted events merely to populate the branch field. The observed `organization_entities` record is typed `COMPANY`, not `BRANCH`.
- Added `services/financial-scope-readiness.ts` and the opt-in, preview/QA-only `scope-readiness` action to the existing live reporting API. It checks active membership and `financial_core.view` **before and after** metadata reads, with the user's authenticated RLS Supabase client, and returns non-financial diagnostic counts explicitly marked `RLS_VISIBLE_ONLY`.
- The existing content-level scope selector optionally shows scoped diagnostic blockers in both languages. A stale organization/period/scope response cannot be displayed against a changed selection. **No global sidebar change; no financial amounts or exports become available for incomplete scopes.**
- The server preflight is **off by default**, requiring `FINANCIAL_SCOPE_PREFLIGHT=true` alongside the existing live reporting flags and excluding Vercel Production. If unavailable, the existing explanatory blocked state stays visible.
- Both modes correctly remain `BLOCKED`: an RLS-filtered event count cannot prove complete ledger/opening coverage; `organization_entities` does not yet certify a branch registry; `parent_organization_id` does not attest complete legal control, ownership, access or NCI/FX policies. The preview is a diagnostic integration, **not completed branch aggregation, statutory consolidation or a grant of permission**.
- To activate real financial reporting: create a versioned, server-authoritative complete ledger/journal/opening source attestation with durable branch allocations (including zero-opening organizations), legally effective group membership/control and every-member permission checks; validate it in an isolated database before using the Phase 1–2 accounting primitives. Saved balanced opening drafts must remain accessible as visibly provisional reports without forcing final approval.

### Implementation checkpoint — Phase 4 three-level report scope (2026-11-06)

- Aligned the financial reports selector with the requested three levels: **الشركة فقط** (`COMPANY_DIRECT`), **الشركة وفروعها** (`COMPANY_WITH_BRANCHES`), **الشركة وفروعها والشركات التابعة** (`GROUP_WITH_SUBSIDIARIES`). These are **cumulative** reporting boundaries, not three interchangeable organization identifiers.
- The existing topbar organization picker and **الشركة / مع الشركات التابعة** switch are reused, rather than changing navigation or recreating the approved sidebar. Its group toggle synchronizes with the in-page scope choice. The selector learns parent relationships **only among the signed-in user's already-authorized organizations**; a related subsidiary is not automatically accessible or included in a financial statement.
- Following the supplied module screenshots, the three large scope tabs were condensed into a **single small report-level dropdown** next to **branch** and **cost-center** selectors inside the financial report content. The latter are visibly disabled with an integration explanation until the complete opening/journal dimensions can power actual server-side filtering. Thus choosing a branch can never silently display a whole-company total. The existing personal/institutional topbar toggle is not changed; this live financial-statement route still has an institutional-only accounting source.
- The existing live `financial_statement_live_snapshot` RPC covers the **whole selected legal organization** (`ORGANIZATION_ALL_ENTITIES`) and therefore already serves the company-and-branches level, subject to its existing authorization, posting-policy and approved-opening gates. Neither selecting a group nor marking a transaction as company-direct will silently add subsidiary financial results to that RPC.
- Added a read-only classifier and tests to identify valid **company-direct** events (`entity_id = NULL` or linked to a `COMPANY` entity), verified `BRANCH` events, and reject cross-company, inactive or unverified references. The opt-in QA readiness action now reports the two counts separately; it no longer mislabels null branch identifiers as orphan postings. The classifier is **diagnostic only**, not an accounting allocation or a substitute for ledger authorization.
- **Company-direct statements remain blocked** until all opening balances and journal/source lines can reliably distinguish headquarters from branches. **Group-consolidated statements remain blocked** until controlled subsidiaries, full permissions, period/currency policies and elimination/NCI adjustments are verified. Both states clearly explain the gap and expose no invented totals or enabled exports. Existing successful full-company reporting remains available.
- Current group switches in other modules may provide pre-elimination management aggregation; their appearance alone does **not** certify statutory financial consolidation. No sidebar changes, source journal rewrites, QA/Production mutations, PR merge or deployment are included.

## 1. User-facing reporting modes

| Key | Arabic UI label | Financial boundary | Treatment |
| --- | --- | --- | --- |
| `COMPANY_DIRECT` | الشركة فقط | Direct headquarters/parent-company entries, excluding operating-branch entries and all subsidiary books | Management segment of the **same legal entity**, requiring complete and verified journal/opening attribution. **Not live yet.** |
| `COMPANY_WITH_BRANCHES` | الشركة وفروعها | All direct and branch activity within **one legal organization** | The entire legal organization's ledger: each journal once, including branches, without adding subsidiaries. **Current live RPC covers this boundary.** |
| `GROUP_WITH_SUBSIDIARIES` | الشركة وفروعها والشركات التابعة | Parent, its branches and legally controlled subsidiaries (including relevant subsidiary branches) | Full group consolidation with intercompany eliminations, foreign-currency translation, ownership/NCI and comparable periods. **Not live yet.** |

The user selects the reporting organization/group, scope, as-of date or period, reporting currency, and (when applicable) a branch set. The interface must label management-only direct/branch reports distinctly from consolidated financial statements prepared under a reporting framework. A holding/group selector must not make unrelated organizations visible. Legal organization is required on every entry; **branch is optional for entries directly belonging to that organization**. Missing `entity_id` must not be 'repaired' by inventing a branch or moving posted test records.

**Approved topbar behavior from existing modules (screenshot reference):**

- **شخصي / Personal:** display personal-only records, with **no** company picker, subsidiary switch, branch or cost-center selector. The current live financial statement source is institutional; do not disguise organization accounts as personal statements. A personal statement source requires separate coverage and permissions before enabling it on this route.
- **مؤسسي / Organization:** retain the same topbar organization picker and the existing **الشركة / مع الشركات التابعة** group switch. Under the company scope, show branch and cost-center filters **only when there is an authoritative listing and an actual server-side filter bound to every source ledger, opening and report**. Selecting a branch or cost center must never silently return company-wide figures under a narrow label.
- The existing two-position group switch is **not** a synonym for a branch filter. «الشركة» = that legal entity with its branches; «مع الشركات التابعة» = a requested group view including other legal entities, which remains gated pending legal control, permissions and eliminations. The financial-report page also exposes the additional company-direct/headquarters-only selection separately.

**Important:** "الميزانيات" includes both financial position/statements and planning budgets. Provide independent, branch-combined, and group reporting for trial balance, statement of financial position, profit/loss, cash flows where supported, and actual-versus-budget. Group budget consolidation has an explicitly specified scope, FX treatment and intercompany adjustment basis; it is not silently assumed to be IFRS-compliant historical reporting.

## 2. Common chart of accounts and industry templates

1. Preserve the approved **shared 4-digit parent account taxonomy** across all organizations. Do not replace or renumber the main chart by industry.
2. Activate trading, services, real-estate, investments, healthcare, education, etc. as selectable **child-account templates** (initially 6 digits) under those parents. Support additional deeper child levels where needed, without hard-coding meaning to string length.
3. Roll up every posting account to an explicit, validated reporting category/parent through stable account identifiers and effective-dated mappings. Prefix-based rollup is permitted only after checking parent identity and mapping invariants; identical account numbers without compatible definitions do not prove equivalence.
4. A missing or conflicting mapping is a prominent preflight error with drilldown and resolution. Do not automatically send material balances to a generic suspense/miscellaneous reporting line.
5. Changing account templates or posting-role mappings is **prospective and versioned**. Historical account IDs, original vouchers, approved periods and opening balances remain intact. Reclassification of past comparative reports requires an explicit authorized, audited restatement or reporting mapping version—not silent rewriting or manual re-saving of each voucher.
6. Consolidation relies on canonical reporting categories, not on all companies having identical leaf-level accounts. Industry subaccounts remain available for subsidiary and branch drilldown.

## 3. Distinguish operational branches from subsidiaries

- `organizations` represent tenant-scoped organizations/legal entities only after legal-entity status is explicitly recorded and validated. An organizational hierarchy or `parent_organization_id` **alone** does not establish IFRS control.
- Existing `organization_entities`, branches, projects and cost centers can provide management dimensions inside one legal entity; assess how the source transactions already capture these dimensions before extending the data model.
- Group participation needs dated legal relationships, control assessment, ownership percentages, consolidation method and reporting framework, including acquisitions/disposals and changes in control.
- A branch combined report reads **one underlying legal-entity ledger** with branch allocation. Never copy transactions into an additional “combined ledger.”
- A subsidiary's separate books remain independent; consolidated entries live in a dedicated reporting/adjustment layer. Never mutate its original invoices, journals, or opening balances to make group totals appear right.

## 4. Financial engine data flow (target design)

1. Authorize the user for **every** requested legal entity and report scope; deny the complete request if any required member is inaccessible. No partial totals that disclose restricted entities.
2. Resolve the legal entity, branch allocations and group membership **as of reporting date**, including control and ownership effective dates.
3. Read the canonical posting ledger by organization, period, status, account and immutable source IDs. Deduplicate source postings and distinguish source records from derived reporting rows.
4. Resolve each account's versioned reporting map into shared financial statement categories; validate unmapped/invalid accounts.
5. Compute standalone trial balances first. For draft/unapproved opening balance previews, show a clear **PROVISIONAL / غير معتمد** basis and do not commingle with statutory or approved balances. Support zero-opening start-ups and capital receipts posted after inception.
6. For branch-combined reports, aggregate allocated entries once and resolve internal branch clearing without obscuring legal-entity totals.
7. For controlled subsidiaries, perform framework-specific group consolidation: consistent accounting policies, period alignment/adjustments, foreign currency translation, acquisition and equity/investment eliminations, intercompany receivables/payables and loans, internal income/expenses/dividends, and unrealized intragroup margins (inventory/assets). Calculate and separately present non-controlling interests (NCI); an 80%-controlled subsidiary generally contributes **100%** of its assets/liabilities/revenue before eliminations, with NCI separately, rather than simply 80% proportional addition.
8. Apply authorized, dated, reversible-by-adjustment consolidation journal entries in a **group-only reporting adjustment ledger** with clear provenance; source subsidiary books remain unchanged. Adjustments need an audit trail, preparer/approver separation where configured and locking after approval.
9. Produce drilldown group → legal entity → branch (where relevant) → reporting category → account → source voucher, plus reconciliation of pre-elimination, elimination and post-elimination figures.

### Fiscal years, currency and reporting basis

- Respect each entity's fiscal calendar and closed-period state. A non-calendar or inconsistent group cutoff requires explicit reporting-period alignment or authorized adjustments; never silently truncate.
- Record functional currency per legal entity, presentation currency for the group, and transaction/rate types and dates. IAS 21 statement translation is **not** the same operation as the current SAR/USD display toggle. Document translation differences and translation reserves in equity where required.
- Every output carries `reporting_scope`, included entity list, period, status, reporting-currency/rate basis, calculation version and timestamp so comparisons and exports are reproducible.

## 5. Security, isolation and operational safeguards

- Scope all access with user membership, legal-entity ownership and RLS checks, on server/RPC and UI; no trusted client-supplied lists of arbitrary organization IDs and no browser-side `service_role` usage.
- Group consolidation permissions do not automatically grant write access to member companies' source journals.
- Group adjustments, mapping versions and ownership records are permission-controlled and audited, including `who`, `when`, `why`, before/after values and approval state.
- Maintain idempotent report builds and explicit invalidation/recalculation triggers for changed source transactions or approved adjustments; no duplicate GL effects.
- Current organization setup wizard and opening balance page should **link to the same opening-balance source of truth**. No duplicate opening-entry module or extra balancing counterparty is created just for a wizard step.
- Financial reports may show a clearly labeled preliminary preview from saved balanced opening-balance drafts, as already requested, without treating those drafts as final, approved statutory balances.
- Do not modify established sidebar or top navigation components. Additional reporting-mode selection belongs inside existing reporting pages, tabs and approved design system.

## 6. Proposed implementation sequence (separate approval gates)

1. **Discovery and data contract:** verify exact current legal-entity, branch, ledger, account mapping, fiscal and reporting queries; identify gaps; create QA-only acceptance fixtures. Verify pending work in Draft PR #360 before any merge.
2. **Standalone and branch scope:** provide validated chart rollups, branch dimensions and reconciliations using one canonical ledger. Design and test user-facing scope picker and tab UX first.
3. **Group metadata and preflight:** effective-dated ownership/control, currencies/calendars, full membership authorization and completeness warnings.
4. **Consolidation adjustment engine:** group-only eliminations, minority interests, currency translation and audit/versioning.
5. **Statements and planning:** group P&L, financial position, cash flow and budget comparisons; reconciliation, drilldown, exports, period-close controls.
6. **Release QA:** isolated DB, multiple tenants, permission-negative tests, financial reconciliation, backup/restore evidence and explicit publication approval.

No schema migration, production data update, PR merge, external deployment, or assertion of full IFRS compliance is authorized by this design document.

## 7. Acceptance scenarios

| Test | Expected outcome |
| --- | --- |
| One entity with two branches and interbranch clearing | Branch statements reconcile to the source ledger; combined legal-entity report counts each source line once and treats internal clearing correctly. |
| Independent companies sharing main account codes | No accidental combined report or cross-tenant visibility. |
| Parent and controlled subsidiary with reciprocal 100,000 AR/AP and intra-group interest | Group eliminations net matching reciprocal balances and internal income/expense without changing source books. |
| Parent controls 80% of subsidiary | Full consolidation subject to framework, with 20% NCI; no naive 80% balance multiplication. |
| Inventory still includes unrealized sale gain within group | Unrealized profit eliminated at group level with an auditable entry. |
| Different functional currencies | IAS 21 appropriate translation and FX adjustment/reconciliation; a display currency toggle is not used as the calculation engine. |
| Fiscal year July–June and calendar-year subsidiary | User sees valid reporting alignment choices or a blocking preflight; never silently combine inconsistent periods. |
| User lacks access to one group entity | Entire requested consolidated report denied; no leaked subtotal, membership details or aggregates. |
| Template child code missing mapping | Explicit unmapped-account diagnostic; no silent miscellaneous bucket. |
| Historic voucher before chart/posting-policy change | Prior voucher/account stays unchanged; reports resolve the relevant version of account mapping, and audit history remains readable. |
| New organization with no openings, first transaction capital receipt | Standalone reporting works from actual movements; no fictitious balancing opening line. |
| Balanced opening draft saved, not approved | Preview is available only with conspicuous provisional labeling; approval-gated statutory view remains unchanged. |
| Report refresh and retries | Same result, no duplicated financial effects or consolidation adjustments. |

## 8. References (accounting framework, not certification)

- [IFRS 10 — Consolidated Financial Statements (IFRS Foundation)](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/)
- [IAS 21 — The Effects of Changes in Foreign Exchange Rates (IFRS Foundation)](https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/)

This document sets the **future target behavior**. It must not be confused with a claim that the current limited group-reporting RPCs and QA gates already implement all consolidation requirements.
