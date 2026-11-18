# Reporting dimensions — integration checkpoint

Branch: `fix/report-scope-integrity`, PR #408. Production is unchanged.

## Implemented

- Scope controls exist only in the shared banner. Branch and headquarters reports use approved opening allocations plus original source entity references; exports and refresh preserve that identity.
- Income by cost center resolves persisted recognition-line dimensions. Different lines of one voucher can belong to different centers; VAT parts use the original source line. Unallocated activity stays separate. All center income metrics reconcile to company income.
- A selected center suppresses company statements and generic company exports. Its CSV rereads the authorized source. Failed export validation clears cached values; a changed selection or unmount cancels delivery.
- Group selection exposes an explicitly preliminary, per-company source review. Each visible company is independently authorized and reread. No totals, complete-registry claims or consolidated exports are emitted from the visible organization hierarchy.
- A pure adapter can combine independently verified company trial balances with a separately trusted, complete legal-control registry. It takes 100% of controlled subsidiary balances before eliminations, never an ownership-weighted shortcut. It is not wired to an unverified registry.

## Outstanding integration

1. Authoritative full-period, complete legal-control registry: current context RPC returns direct end-date evidence with `registryComplete: false`. Do not change that marker in the client or infer completeness from RLS-visible parent pointers.
2. Persisted and approved intercompany elimination evidence; acquisition/disposal timing; currency translation and non-controlling interests before consolidated statement issuance.
3. Historical center dimensions for legacy/synthetic sources and frozen closed-year allocations. They currently fail explicitly, rather than attributing activity by current account names.
4. Live center balance-sheet/cash-flow allocations. Joint branch-and-center income filtering is implemented; all-three-statement compilation is tested but not yet connected to the live UI.
5. Branch zero-opening first-activity support and cross-branch transfer clearing. Existing guards deliberately refuse incomplete attribution.

## Validation

- Local standard suite: 265 files, 1,580 passed and one skipped; TypeScript passed before the export-invalidation hardening, then rechecked.
- Service tests cover missing/foreign original lines, revoked permissions, changed dimensions, changing group membership, cycles, and exact company identity.
- Disposable full-schema browser acceptance includes banner center selection, refresh, actual CSV download, and revoked membership clearing. Its result must be checked on the final remote SHA before merge.
- No customer data, Production migrations, or production deployment were changed. Automatic Vercel previews are canceled during this testing phase.

## 2026-11-14 continuation — engine foundation, not live rollout

- Elimination staging now consumes each reciprocal company's remaining capacity, rather than reusing its original balance against unrelated group totals. Ambiguous reciprocal-company pairs fail. Net closing debit/credit totals are separate from gross worksheet turnover.
- `projectDimensionalStatements` projects income, position and cash from complete line-level branch/center allocations. It reconciles all cells to the company, requires every opening account and eligible source leg, verifies center/branch consistency, and refuses unbalanced per-dimension openings, journals and misattributed reversals. It never synthesizes clearing balances.
- This new projection is a pure tested engine only. It is NOT wired to the live API or banner. The current live UI remains income-only for centers and per-company review for groups.
- Blocking implementation dependencies remain: persisted/versioned/approved joint opening and movement allocations with dated branch-center registry; same-snapshot authorization/read adapter; allocation management UI and integration/export tests. Consolidation still needs the complete legal-control registry and persisted, approved, source-bound elimination/acquisition/NCI/FX evidence. No caller-provided approval flag can substitute for that server evidence.
- No Production writes, schema migration, deployment or claim of completed statutory consolidation in this continuation.

### Joint branch/center income adapter

The live income endpoint and banner now accept an exact branch (including HQ) together with a center. The adapter compiles the approved branch source and intersects its original recognition lines with persisted center dimensions, then reauthorizes/reconciles the same branch source. Scope/cache/export identity includes the branch. Missing branch allocation or denied access never falls back to whole-company numbers. This does not introduce center opening allocations or turn the pure three-statement projection into a live adapter.

Local validation: 266 files passed, 1,589 tests passed, one skipped; TypeScript passed. New real browser acceptance covers joint HQ/center selection, refresh, CSV scope, and reset on branch change. The final pushed SHA's workflow result must be checked separately before merge.

### Approved joint opening storage rehearsal

Final-head acceptance on `a4116ab9` passed all seven suites, including joint HQ/center browser selection, refresh and CSV. Added a voucher-preserving dimensional opening adapter with tests for stale approval, changed digest, foreign organization, missing/duplicate parts and redistribution between vouchers sharing an account. Nine targeted opening/projection tests and TypeScript pass.

At the rehearsal stage, the generated dimensional-opening migration was staged under `supabase/drafts/`, outside canonical migration history. It adds independent private versioned distributions and audit records, exact branch/center validation, optimistic concurrency and amount/self-approval authorization; the existing branch workspace is unchanged. The full-schema workflow installs this draft only in its disposable database and runs rollback SQL acceptance. It must pass and its schema delta be reviewed before promoting it to canonical migrations or applying it to hosted QA. No live UI/API claims are made for this draft.

### Versioned opening adapter verification (2026-11-14)

- Remote commit `0f119a496866cada324714fc5b68f7f52274d3d3`: all seven CI workflows passed, including disposable SQL acceptance of the draft dimensional opening schema.
- Added staged authenticated save/approve/context service with explicit branch and center fields, strict input validation, optimistic versions and redacted database errors. No public route is enabled; editor context must not be used as report approval evidence.
- Live journal attribution, three-statement report wiring and final approved consolidation remain outstanding. Canonical promotion was subsequently completed below.

- Promoted the tested SQL into canonical migration history using schema fingerprints downloaded from CI artifact 14127331017. This is repository preparation only; no hosted database was migrated. Canonical full-schema recheck passed on `6c781808647f286b7e401b3f44ce8418eeb5a09e`, together with all seven workflows.

### Recognition-to-dimension compiler (2026-11-14)

- Added `compileDimensionalEventStatements`, joining each original event/recognition line to both compiled accounting legs and the approved voucher-preserving opening distribution. No amount allocation by account name, default center, or guessed counter-entry.
- Tests reconcile income, position and cash to the company, reject absent/duplicate/extra recognition links, mismatched opening identity and incorrect center/branch association. Verified first-activity companies can start with zero opening without inventing an approved workspace; missing historical opening approvals still fail.
- Thirteen targeted dimensional compiler tests and TypeScript pass. This is the compiler bridge, not a live authorized endpoint.
- Next live integration requires the complete dated branch-center registry, authorized source/evidence reread, approved distribution selection independent of editor drafts, and UI/export acceptance. Consolidation dependencies above remain unresolved.

### Dated center/branch validation (2026-11-14)

- All seven remote suites passed for `77195f3440e421da40204ad48587458d9f039847`.
- Added effective-dated center/branch registry validation and integrated it into `compileRegisteredDimensionalStatements`. The required coverage starts at fiscal start (opening plus prior movements), not merely the selected display month.
- Historical assignments remain tied to their old branch. Missing, overlapping, foreign or draft assignments do not become HQ. Mid-period transfers fail explicitly pending temporal-slice support.
- Nine targeted registry/compiler tests and TypeScript pass locally. This change remains local and is not deployed.
- The registry still needs audited persisted storage, authenticated read/write integration and user controls before the live three-statement endpoint can consume it. The pure registry completeness flag is not a substitute for server attestation.

### Registry storage rehearsal

Added draft private immutable dated assignments with authorized create/approve and read RPCs. Organization-wide optimistic revision and row locking serialize inserts; overlapping periods, foreign centers/branches and direct writes are refused. Historical assignments are immutable; changing the end of an open-ended assignment is deliberately not exposed until a separately audited transfer operation exists. The read RPC enumerates the full tenant registry; coverage remains a compiler check. SQL rollback acceptance runs only in disposable CI. This draft has not been applied hosted or promoted to canonical history.

### Authenticated registry integration — local follow-up

- Added current-user registry read, period validation and assignment service. Strict schemas reject foreign organization evidence, malformed dates, unknown input fields, invalid revisions and untrusted database responses.
- Added `/api/financial-reporting/center-branches` for management reads/writes, disabled unless `FINANCIAL_CENTER_BRANCH_REGISTRY=true`. No environment flag was enabled. Same-origin write checks, private/no-store responses and sanitized errors are covered.
- Thirteen registry/service/route tests and TypeScript passed. These additions are local; the remote draft-schema acceptance remains on `2242136ade1c1685e288b379e06ecceced3fbb30`.
- Required next: verify disposable SQL result; support audited open-ended assignment transfer; promote registry schema with observed fingerprints; complete source replay and UI/export integration. No production writes or deployment.

### Prospective transfer follow-up

- Base registry SQL acceptance passed in full-schema run 43636826725 on `2242136`; subscription suite was still running at last check.
- Added draft future-only atomic transfer: close old open interval, insert next assignment via the existing authorized command, and retain before/after rows in a private audit table. Invalid targets roll back the close. No retroactive transfer or current-day reinterpretation is allowed.
- Added authenticated transfer service and management API routing; 15 targeted tests and TypeScript pass. Updated disposable SQL acceptance covers rollback, contiguous periods and audit. The transfer SQL itself still awaits the next CI run.
- No feature flag enabled, no hosted migration and no deployment. Live UI/source integration and final consolidation remain outstanding.

### Registry management UI

- All seven workflows passed on `7fb636463a13be8de7a7ec2acb921532fbc54930`, including SQL prospective transfer rollback and audit checks.
- Added center/branch history and assignment/transfer form inside organization structure settings. Company identity comes from the existing shared banner; no report-level selector is duplicated. Scope changes unmount the editor and abort pending requests. Conflicts refresh the registry rather than silently retrying a write.
- UI is hidden when the server feature flag is disabled. Added browser fixture coverage for assignment, reload, prospective transfer and mobile width; execution pending on next CI. TypeScript passed locally.
- Registry SQL remains draft pending canonical promotion with observed schema fingerprints. Live center position/cash and final consolidation are still incomplete.
