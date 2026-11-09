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

## Product independence, pricing and company handoff (9 November 2026)

- The marketed unit is the **independent** module "Feasibility & Project Development", catalog key `module:feasibility`, not an inseparable child of accounting, assets or liquidity. It must be separately selectable for Professional/Advanced/custom subscriptions with admin-controlled pricing; it must never inherit the mandatory bookkeeping bundle merely because company setup is optional.
- The module may be used without any accounting subscription. An **optional company handoff** is initiated by the user after reviewing the study and its legal/finance blockers. There are three paths: defer, create company, or connect an existing authorized company.
- All current signoffs are explicitly **browser-local preliminary QA reviews**; status pickers, local storage and plan catalog labels do not constitute server approval, billing activation or a legal authorization. Saved revisions must become server-stamped, immutable approval events in the dedicated future QA tables.
- The "new company" path opens the *existing* organization directory to create the entity through its normal authorized process; no duplicate shell organization and no unauthorized direct organization write. The "existing company" path lists ONLY organizations returned by the current user's authenticated `/api/organizations` request; it disallows freeform IDs, blocks currency mismatch, and links to the supported financial setup wizard only when `NEXT_PUBLIC_FINANCIAL_CORE_V2_HANDOFF=true` in the isolated V2 QA deployment. The destination wizard must revalidate membership and financial permissions.
- Neither path automatically copies projected CAPEX, revenue, land valuation or partner percentages into opening balances or journals. Actual assets, capital receipts, leases and liabilities require **source-supported accounting entries approved in V2**. Study snapshots remain read-only references, not book balances.
- Targeted QA V2: Vercel project `yaqeen-financial-core-v2-qa`; Supabase `ubotbpjngtfvolthpfec`. Never use legacy `wtzgzmcgcqouziqzsfnl`, Production, or Financial Core V1.
- Before commercial activation: register the new module in the **server-backed bundle catalog**, allow it as a standalone non-bookkeeping package, enforce entitlement server-side (not by nav visibility), and test no-access/expired/read-only states, tenant isolation and pricing.
- Before formally enabling the handoff: persist project and immutable approval snapshots in QA V2 with collaborator-scoped RLS, authorization checks, idempotency keys, source revision, and explicit user confirmation; validate any country and currency transformation and the V2 versioned budget adapter.


## QA V2 owner-only persistence phase (9 November 2026)

- Applied QA-only migration `20261109095653_feasibility_projects_owner_drafts_qa_v2` **only** on Supabase `ubotbpjngtfvolthpfec`. Table `public.feasibility_projects` starts empty, is RLS enabled, and has four owner-user policies. QA security advisor verified; unrelated pre-existing advisor notices were not modified.
- A feature-gated route `/api/feasibility/projects` uses the authenticated Supabase client (never a service-role browser credential), strict origin checks on writes, document validation, owner conditions, and optimistic `revision` compare-and-swap for updates.
- `NEXT_PUBLIC_FEASIBILITY_CLOUD_QA=true` plus `NEXT_PUBLIC_FEASIBILITY_STUDIES=true` is required to activate cloud sync in an isolated QA deployment. Both default **off**. No production or legacy Financial Core database changes.
- The interface intentionally uses explicit **Save to QA V2** / **Restore from QA V2** actions, preventing a browser-local draft from silently overwriting newer cloud content. When a draft ID already exists, the first save returns a conflict until the user reviews the cloud version.
- This stage is **owner-only storage**, not multi-user collaboration, legal approval, final entitlement enforcement, or an accounting posting API. Data is per-account, not attached to a finance organization until a separately authorized handoff.
- Later acceptance gates: collaborator memberships with RLS, approved immutable study revisions, workflow audit, docs upload, cross-device browser QA, quota & billing policy for users who do not yet own an organization, and independent module-bundle eligibility.


## Subscription regression guard

- Module registration must **not** auto-select an unprovisioned feasibility entitlement for newly created organization plans. The existing subscription QA acceptance creates a default plan and expects the existing package backend to recognize every selected module.
- The Plan Editor hides the feasibility paid checkbox until `NEXT_PUBLIC_FEASIBILITY_BILLING_QA=true`, and never defaults it on. The plan POST endpoint explicitly rejects a feasibility feature unless the server-only `FEASIBILITY_BILLING_QA=true` gate is approved and the server RPC/catalog and billing model are tested. Both default OFF.
- There is still a major product gap: the existing bundle RPC requires an organization and forcibly includes assets/liquidity. **Do not** market standalone studies until a future user-account/project-workspace entitlement and billing flow is implemented. Avoid weakening the existing bookkeeping bundle rules before that separate design is approved.


### QA-only SQL vs canonical Production migrations

The schema has already been applied and verified **once** on V2 QA. Its exact SQL is tracked in `docs/feasibility/qa-v2-owner-drafts-schema.sql` instead of `supabase/migrations/`, because the latter is the canonical historical Production/disposable-bootstrap manifest. No new Production migration may be introduced until reviewed and approved for release. Do **not** reapply the QA migration or insert it into Production's canonical history merely to pass CI.

## QA V2 API and backup trust boundary

- The cloud document Zod schema is strict: clients may not submit arbitrary extra accounting/owner fields inside a study. Server assigns `owner_user_id`; user ID is never accepted from a payload.
- An imported JSON backup clears any previously remembered cloud revision token, so a stale backup cannot overwrite an already synchronized study without a cloud restore and explicit review. The cloud API rejects duplicate IDs with HTTP 409 and rejects stale revision updates.
- Authenticated / same-origin / RLS / conflict boundary checks have automated API tests, but **live authenticated browser QA on the Financial Core V2 deployment is still required**.

## Independent, user-scoped QA V2 entitlement — 9 November 2026

- QA-only Supabase migration version `20261109105303` created `public.feasibility_access_grants`; the full applied schema is documented in `docs/feasibility/qa-v2-access-grants-schema.sql` OUTSIDE canonical Production migration history.
- An authenticated user's Feasibility access is **independent of any organization**. It grants no accounting, banking, assets, journal or Financial Core V1 privileges. Users have owner-only RLS read; authenticated clients have NO insert/update/delete privilege on licence grants.
- The feasibility page and QA cloud API fail closed if no valid grant exists. Within the time window, `TRIAL` and `ACTIVE` can edit; expired, suspended, cancelled and `READ_ONLY` grant read/export but prevent writes. QA feature gates still default OFF.
- No customer entitlement was activated by this migration and no payment or subscription was charged. Further work: reviewed admin entitlement write workflow, standalone pricing and activation UI, audit/renewal, collaborators/seats and browser acceptance on the V2 deployment.

## QA V2 immutable internal decision snapshots (9 November 2026)

- Applied QA-only migration `feasibility_immutable_review_snapshots_qa_v2` in Supabase `ubotbpjngtfvolthpfec`. SQL evidence: `docs/feasibility/qa-v2-internal-review-schema.sql` **outside** canonical Production migrations. No Production or legacy Financial Core change.
- The authenticated owner may record an **internal review snapshot** only after the persisted study revision passes financing, legal and readiness checks. The browser sends project ID, expected source revision and optional notes — NOT a snapshot or legal approval.
- PostgreSQL BEFORE INSERT trigger locks the persisted study, validates its revision and captures the immutable JSON snapshot; server and database reject stale versions. The owner may read/review history but cannot UPDATE/DELETE saved snapshots; a second review for the same source revision is rejected.
- UI requires an explicitly saved cloud version matching the local draft; local preview approval alone is not sufficient. Formal board/legal/project authorization is a distinct later workflow. Never treat these records as a legal licence, booking, budget approval, opening balance or financial posting.
- Verified in QA transaction: owner creates review, changes live study, saved snapshot remains unchanged, stale revision is rejected, foreign user cannot read, rollback leaves 0 records. Authenticated browser QA with real identities remains a release gate.
