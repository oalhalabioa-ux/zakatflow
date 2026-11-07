# Feasibility & Project Development — isolated Phase 1

## Product scope

- Authenticated pre-investment studies for industrial, commercial, real-estate, agricultural, service and custom projects.
- Editable project portfolio, capex, land valuation and contribution model, financing gap, operating assumptions, scenario comparison, project-level pre-financing simplified cash flows, indicative NPV/IRR/payback, legal checklist, tasks, risks, supplier quotes and decisions.
- Study figures are **not** accounting journal entries, approved budgets, statutory tax computations, or an audited business valuation.
- All initial figures are zero, not plausible-looking fake figures. Land enters equity only when the user explicitly marks it as transferred to the company. Shareholder loans never automatically create ownership.
- One study currency only: switching the currency code does **not** perform FX conversion.
- Future industry-specific unit economics and tax/depreciation schedule work is needed before investment acceptance.

## Financial Core V2 decision — mandatory

The existing legacy Financial Core will be retired because of data completeness differences. **Never import, call, or mutate legacy Financial Core services, tables, or posting APIs in this module.** The feasibility planning engine is intentionally independent.

Financial Core V2 must be integrated by an explicit, versioned, approved adapter only after V2 data contracts and security model stabilize. Any later conversion from feasibility assumptions to company-level planned budgets must:
1. Require explicit project approval and authorization on both sides.
2. Resolve the destination organization with authoritative membership and permissions.
3. Generate a preview/diff with source study revision, destination ledger version and mapping, and explicit user confirmation.
4. Write only approved planning/budget entities via V2's sanctioned interface, **never** accounting postings or opening balance journals on the strength of forecast values.
5. Reject missing mappings, duplicates, wrong organization, mixed currency and unresolved fiscal-year boundaries.
6. Use idempotency keys and immutable provenance; preserve the original feasibility study and existing financial history.
7. Pass isolated QA against the **same** schema and source contract as the V2 release candidate; release remains blocked without signed-off migration and permission tests.

## Draft storage and limitations

This Phase 1 feature is explicitly a **local draft preview**, not multi-user backend functionality. Access to the page is authenticated. Drafts are saved under a per-user browser storage key; a JSON export/import enables intentional backup, but the data do not follow the user between browsers or devices. This is **not** an authorization boundary for shared studies, so it should not store confidential real-world documents or legally binding records until backend storage, RLS, attachments, revision history and sharing controls are implemented.

The sidebar link is guarded behind `NEXT_PUBLIC_FEASIBILITY_STUDIES=true`, default off; the route is authenticated but intentionally not promoted to production.

## Phase 2 gates before user-facing activation

- Add dedicated `feasibility_*` study, revision, task, risk, quote, document and decision tables in an isolated QA DB with tenant and collaborator access enforced by RLS. Do not reuse legacy core tables.
- Implement collaborative role permissions, encrypted/restricted document storage, secure upload and audit trail.
- Add industry templates with sector-specific modeling (manufacturing utilization/yield, services workload, construction milestones etc.) and jurisdiction-adjustable tax/legal requirements with counsel verification.
- Add scenario versioning, CAPEX contingency, depreciation, working capital days and financing amortization for a bankable DCF.
- Run unit + browser QA in isolated environment, then approve dashboard/sidebar integration. No merge or production release is authorized by this draft.

## Design / safety

- Isolated module route: `/:locale/feasibility`.
- No changes to production data, existing organizations, user roles, core ledgers, branch accounting, fiscal year, existing CSS rules or existing financial statements.
- PR should remain draft until UI, accessibility, data validation and backend authorization acceptance are complete.
