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
4. Joint branch-and-center filtering and center balance-sheet/cash-flow allocations. Current center projection is income-only across the whole company.
5. Branch zero-opening first-activity support and cross-branch transfer clearing. Existing guards deliberately refuse incomplete attribution.

## Validation

- Local standard suite: 265 files, 1,580 passed and one skipped; TypeScript passed before the export-invalidation hardening, then rechecked.
- Service tests cover missing/foreign original lines, revoked permissions, changed dimensions, changing group membership, cycles, and exact company identity.
- Disposable full-schema browser acceptance includes banner center selection, refresh, actual CSV download, and revoked membership clearing. Its result must be checked on the final remote SHA before merge.
- No customer data, Production migrations, or production deployment were changed. Automatic Vercel previews are canceled during this testing phase.
