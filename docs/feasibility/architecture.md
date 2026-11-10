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

## Read-only navigation acceptance

- If the independent study entitlement has expired or is paused, only study browsing, print and JSON export are available. The active panel uses a disabled fieldset to prevent editing controls from appearing functional; project creation/deletion and cloud writes remain blocked by the UI **and** by the authenticated server endpoint.
- All newly authored feasibility text follows Yaqeen's navy `#1D3852` on light backgrounds, not black.

## QA V2 collaboration security foundation (9 November 2026)

- Applied QA-only migration `feasibility_collaborators_role_model_qa_v2` in Supabase `ubotbpjngtfvolthpfec`; canonical SQL is documented at `docs/feasibility/qa-v2-project-collaboration-schema.sql`, outside Production's historical migrations. No tests or users were persisted.
- Created `feasibility_project_members` with explicit `INVITED | ACTIVE | REVOKED` status and `VIEWER | REVIEWER | EDITOR` roles. Direct authenticated INSERT/UPDATE/DELETE is **denied**; membership must later be created/revoked through an audited authorized invitation workflow.
- RLS grants active collaborators study read, and active editors study UPDATE, but the current *API* deliberately remains owner-only while invite acceptance and edit auditing are not implemented. The DB role helper is `SECURITY DEFINER`, `search_path=''`, explicitly matches `auth.uid()`, and exposes only the caller's own role for a project.
- QA rollback test verified pending membership denies role; ACTIVE member has only the assigned role; unrelated user cannot read a project or role. Transaction rollback left 0 memberships and 0 projects.
- **Not a collaborative release:** no real invitations, accepted users, email delivery, collaborator audit, member editing endpoint, or shared project list have been enabled. The user-level subscription access grant remains a separate gate. All functionality remains behind QA feature flags and PR Draft.

## QA V2 collaborator helper hardening (9 November 2026)

- Follow-up QA-only migration `feasibility_collaboration_private_helper_hardening_qa_v2` moved the RLS membership helper from exposed `public` to non-exposed `private`, maintaining explicit user matching and owner-or-active-member checks.
- Combined RLS policies to avoid multiple permissive policy overhead. Authenticated users still cannot create or change memberships. Included a foreign-key covering index. No Production migration created.
- Supabase security advisor shows no Feasibility warnings after hardening; foreign-user read/role checks passed in a rollback-only test, leaving zero projects and members.
- Collaborator invitation acceptance/edit auditing is NOT enabled. These are structural permission controls only.

## QA V2 email-bound invitation and shared portfolio — 9 November 2026

- QA-only migration `feasibility_email_bound_invitation_qa_v2` created an owner-scoped, RLS-protected table `public.feasibility_project_invitations` and two authenticated RPCs: `feasibility_accept_project_invitation` and `feasibility_revoke_project_member`. **No Production or legacy Financial Core database writes.**
- The new invite API issues a secure random 256-bit code, keeps only the SHA-256 digest in the database, binds it to a specific lowercased email and a `VIEWER` or `REVIEWER` role, with an expiry no longer than 7 days. The raw code is returned once; no email or external message is sent automatically.
- A confirmed-email account accepts the code through an explicit POST. The SQL RPC verifies the authenticated user's email against the stored target, locks the invitation row, denies expired/revoked/redeemed tokens, then creates an ACTIVE membership transactionally. Invalid accept attempts return a generic message so recipient identity is not leaked.
- Cloud project GET now returns **only** owner and accepted collaborator rows allowed by RLS; `owner_user_id` is returned so shared studies display as **read-only**, even when the recipient has an active personal feasibility licence. Project write/delete API remains owner-only and recorded snapshots remain owner-only.
- The collaboration tab allows an owner to generate VIEWER/REVIEWER codes and list issued invitations; the standalone join form accepts manually shared codes. Both are gated behind `NEXT_PUBLIC_FEASIBILITY_SHARING_QA=true`, in addition to the study + cloud QA flags, all OFF by default.
- Remaining before rollout: end-to-end tests with **two real confirmed users**, audit of invitation acceptance/revocation, rate limiting and seat limits, safe automated invitation email, encrypted file storage, contributor comments and independent subscription billing. No test data were retained during the SQL RLS rollback checks.

## QA V2 member revocation (draft)

- Owner-only member revocation UI and endpoint `POST /api/feasibility/members/revoke` were added with same-origin protection, independent active entitlement, authenticated owner check, strict UUID input and server-side RPC `feasibility_revoke_project_member`.
- A cancelled membership must lose RLS project access immediately. The backend RPC independently checks ownership before revoking; it may be invoked directly by authenticated clients only with the same ownership guard. Endpoint returns 409 instead of claiming success if the member was not active.
- No automatic email is sent. A durable invitation/membership audit record, admin review, real two-user browser acceptance and server-side tests of revoked user read attempts are still release gates.

## Pending invitation revocation (QA V2 only)

- Applied QA-only migration `feasibility_pending_invite_revocation_qa_v2` to the V2 QA Supabase database only, creating `public.feasibility_revoke_project_invitation(project_id,invitation_id)`.
- The function verifies current authenticated ownership; only an unaccepted, unrecalled invitation issued by that owner can be revoked. It records an audit event atomically in `platform_audit_events`; accepted memberships require the **separate** member-revocation flow.
- `PATCH /api/feasibility/invitations` enforces same origin, active standalone entitlement, strict UUIDs and an owner preflight before invoking the database's independent owner check. The UI exposes an explicit revoke button only for pending, unexpired invitations.
- Browser two-user acceptance and test evidence remain necessary before enabling sharing; no outbound email, Production or old Financial Core changes occurred.

## Optional advanced feasibility model — 10 November 2026, standalone PR #361

- Added separate `advanced` study tab, bilingual sector-specific volume labels, explicit capacity × utilisation × saleable yield, and independent pure advanced cashflow calculations. No changes to PR #360, global navigation, subscriptions, Production, main, or any Financial Core schema.
- `advanced` planning inputs are optional and strictly validated inside the existing study JSON; old drafts remain compatible. Basic cashflows and the original `evaluateStudy` remain unchanged, so existing saved projects are never silently recalculated with new accounting assumptions.
- The optional scenario uses straight-line asset depreciation to compute **indicative EBIT income-tax proxy**, but never treats depreciation as cash. Assets with nonzero CAPEX require explicit useful lives before advanced outputs display. Illustrative lives can be entered only by confirmation and remain user-editable, not statutory defaults.
- Year-zero project cashflows include economic value of transferred land, which is **not** spendable funding cash. Equity projections are separate, block uncovered or excess funding, and model equal-principal annual amortization with interest charged on the outstanding balance. Loan term must not exceed the study horizon.
- Terminal year adds expected user-entered recovery and release of opening working capital. Tax shields, financing fees, loss carryforwards, VAT, construction phases, midyear capex and formal statutory treatment are **not** modeled.
- No historical journals, opening balances, budgets or accounting reports are written; Financial Core V2 adapter remains separately gated. User-level entitlements and QA security requirements remain intact. Financial review and live QA V2 browser acceptance are mandatory before release.

## Advanced project cash-cycle sensitivity — independent PR #361 only

- Optional `contingencyPct` adds user-entered cash reserve to year-zero capital needs, **not** assumed depreciable assets. Default 0; existing saved advanced studies preserve their previous results.
- Optional `workingCapitalPolicy`: MANUAL keeps the original `workingCapital` balance and releases it only in the terminal year; DAYS derives year-1 funding from annual receivables + inventory – payables using the documented 365-day convention and projected gross variable costs.
- In DAYS mode the year-zero investment includes the first operating year's working capital. Each intermediate year's free cashflow subtracts the change needed for **the following year**, while the terminal year releases the ending balance exactly once. The cycle responds to the selected scenario and explicit growth drivers, not hidden default assumptions.
- Negative projected working capital (unmodeled supplier credit), invalid day counts or non-finite inputs prevent displaying advanced returns rather than silently crediting the project. Days are bounded to 0–365 until a full trade-financing model is designed.
- Equity funding parity, debt-ceiling and initial cash need incorporate contingency and the selected working-capital policy. The advanced CFADS / DSCR measure accounts for intermediate working-capital investment and excludes terminal salvage/liquidation cash.
- Simple backward-compatible field validation, specific edge-case unit tests and finance cautions; no change to the basic model, accounting ledgers, subscription catalogue, PR #360 or Production.
