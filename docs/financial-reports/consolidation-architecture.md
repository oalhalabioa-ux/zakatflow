# Yaqeen Business — Financial reporting scope and consolidation architecture

**Status:** Approved product-design requirement; **not implemented by this document**.  
**Scope:** All current and future organizations in Yaqeen Business.  
**Release safety:** Keep this document on Draft PR #360. No changes to Production, existing journal postings, opening balances, or the approved global sidebar.

## 1. User-facing reporting modes

| Key | Arabic UI label | Financial boundary | Treatment |
| --- | --- | --- | --- |
| `STANDALONE` | قوائم مستقلة | One legal entity; optionally filter by branch, entity unit, project or cost center | Books of that legal entity only; a branch-specific view is a management segment, not a separate legal company's statements. |
| `BRANCH_COMBINED` | تقارير الفروع المجمعة | Several branches/operating units of **one** legal entity | One legal entity's balances, sliced or combined by branch without counting any source ledger entry twice; handle internal branch-clearing entries appropriately. Do **not** call this statutory subsidiary consolidation. |
| `GROUP_CONSOLIDATED` | القوائم المالية الموحدة للمجموعة | Parent and subsidiaries that meet the applicable **control** test for the chosen reporting date | Full consolidation adjustments, intercompany eliminations, foreign-currency translation and non-controlling interests as required by the reporting framework. |

The user selects the reporting organization/group, mode, as-of date or period, reporting currency, and (when applicable) branch set. The interface must label management-only combined reports distinctly from consolidated financial statements prepared under a reporting framework. A holding/group selector must not make unrelated organizations visible.

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
