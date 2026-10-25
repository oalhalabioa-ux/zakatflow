# Immutable verification audit and initial pending-compliance handoff

`tests/fixtures/zatca-enrollment-verification-audit.sql` adds owner-only INVOKER preparation contracts. `services/zatca-private-enrollment-audit.ts` adapts them through verified Auth/dedicated pg sessions; `services/zatca-private-enrollment-auditor.ts` joins the actual saved-response verifier to an immutable verification audit. This is **isolated preparation**, not an installed migration, live endpoint, AWS promotion, authority approval, signer-registry activation or invoice issuance path. Production onboarding is unchanged.

## Shared locked snapshot

A private helper locks active OWNER/ADMIN membership, then the exact saved connection, and rechecks the original enrollment checksum/unit stamp, immutable dispatch/digest and response receipt/checksum. Receipt IDs/digests, key and context are derived from those saved records. The lock order is consistent with existing preparation writers. Cloud/native verification runs outside these short transactions; the write transaction reauthorizes afterwards. Queries use existing primary/unique indexes, plus indexes on the two new foreign-key columns. RLS, immutable update/delete guards and PUBLIC/anon/authenticated/service_role table/function revocations are included, including explicit default grants reproduced by disposable QA.

These checks establish persistence consistency. SQL does not execute OpenSSL, contact AWS or authenticate a submitted JSON proof. Evidence must actually be produced by the protected verifier and active references by a separately verified cloud promotion. Neither may be accepted directly from HTTP JSON. Dedicated private role/TLS/pool and reviewed migration provisioning remain required.

## Verification audit

The audit binds a stable check UUID to the original dispatch and exact response receipt digest. It stores the native composite evidence, database checksum, first actor and database time. The exact complete-identity receipt, original CSR/SPKI hashes, saved profile/scope, response certificate fingerprint and path environment/hash must match. Path arrays/anchor/engine/time shape are strict and bounded; unknown fields, credentials and substituted identity proofs are rejected.

A first record requires KEY_READY/no credential/no signer and a native `checkedAt` no older than five minutes or over five seconds in the future. This is a persistence freshness bound, not proof of the newest remote CRL or current authority policy. Exact retries preserve the first record, evidence and time. Changed evidence, including a regenerated timestamp under the same check UUID, cannot overwrite it. Another current company admin may recover the same historical record. Fresh verification uses a **new check UUID**, preserving old history; it does not regenerate an authority request or dispatch.

The private auditor first performs a fresh-authorized lookup. If a saved record exists, it returns `VERIFICATION_AUDIT_REPLAY_ONLY` without rerunning cloud/native work or refreshing freshness. Otherwise it runs the protected saved-response verifier and freshly authorizes the audit insert. A competing operation or lost COMMIT acknowledgement is reconciled only through another authorized lookup of that saved check/dispatch/receipt. A missing, changed or inaccessible result returns a sanitized failure. Historical replay is not an activation grant.

## Initial credential handoff candidate

A separate private operation accepts an opaque **already-created-and-read-back** active credential reference from a protected AWS bridge. That bridge is not implemented or called here. The five-field reference must match the saved dispatch VersionId, certificate fingerprint and encryption key, plus the canonical active namespace/account/region:

`zakatflow/fatoora/{company}/{environment}/{connection}-XXXXXX`

Quarantine ARNs, other companies/environments/versions/pins/keys and raw credential fields are rejected. SQL cannot establish that this AWS reference actually exists or contains the correct credentials; the protected cloud bridge and fresh verification must do that before this candidate can be wired up.

For the first handoff, SQL rechecks authorization, original/receipt/audit consistency, native evidence freshness, KEY_READY/no credentials/no existing registry, then **atomically** updates the saved connection to `COMPLIANCE_PENDING` with that ARN and inserts an immutable handoff audit linked to the exact check/receipt/version. An audit-insert or returned-receipt validation failure rolls back the connection change too. The pinned VersionId and fingerprint stay in the handoff audit; the connection's existing legacy field remains ARN-only until the reviewed versioned rollout.

It does not set COMPLIANCE_PASSED, create/advance a signer registry, submit compliance invoices or authorize signing. Actual authority compliance acceptance is still required. The native integration deliberately simulates later compliance approval as a separate fixture step; this is not live approval.

Exact handoff retries preserve the original check/reference/actor/time and never repeat the state update. The stored `COMPLIANCE_PENDING` state is **historical handoff state**, not a claim about the current connection. If subsequent approved compliance processing changes the connection to COMPLIANCE_PASSED with the same credential, a retry keeps that current state. Changed current credentials/status are denied rather than repaired. Different check/reference attribution cannot replace the first handoff. Renewal, reset, rotation and audited administrative recovery require separate reviewed flows.

A client exception does not prove rollback: a COMMIT acknowledgement or subsequent connection cleanup can fail after success. Exact retries/lookups recover the immutable first audit without new authority/AWS calls. No raw credential enters PostgreSQL or returned receipts. Shared session cleanup handles modern and legacy JWT identity; failed clients are discarded.

## Evidence — 2026-10-25

**70 new cases**: 25 disposable SQL, 25 adapter unit, 12 private auditor unit and 8 actual pg integration tests. SQL evidence/active AWS references are synthetic persistence fixtures, not cryptographic or AWS proof. Unit transports are mocked and real pg tests use an Auth stand-in.

Tests cover complete original identity/path/receipt binding, stale/future evidence, changed proof/reference, missing audit, revoked/wrong scope, quarantine/other-version rejection, raw secret rejection, immutable first actor/time, concurrent exact records/handoffs, no freshness refresh, pending-only/no-registry behavior, no status downgrade on retry, null/changed connection state, actual transaction rollback and an injected audit-insert failure after the connection update. Real PostgreSQL COMMIT acknowledgement loss is injected after successful commits for both audit and handoff, followed by authorized historical recovery without cloud operations. Returned receipt corruption rolls back actual writes; revocation locking and clean pooled identity are checked. These are not real network-outage/managed Auth tests.

The expanded native relational suite passes **181/181**. Its original-enrollment flow now runs actual native CSR/certificate/CRL verification with mocked AWS, persists and recovers that audit, performs the private pending-compliance handoff with a **synthetic** active reference, then explicitly simulates later compliance approval before the older registry/reservation/finalization checks. The actual handoff VersionId is carried into the registry fixture. Final XML storage payload remains synthetic; signed UBL verification is separate. This is not a single authority-accepted enrolled-UBL flow.

The focused native suite passes **596**, with its three SQL-only cases passed separately. TypeScript and existing disposable SQL suites (17 ledger, 30 source, 22 registry, 18 enrollment, 16 dispatch, 12 response, 8 permission) pass. No actual AWS client/resource, authority request, permanent QA/production schema or production change occurred.

Remaining: protected active-secret promotion/readback and fresh-authorized coordinator, current authority profile/roots/CRLs/policy and actual compliance submission/acceptance, enforcement of handoff provenance in the reviewed signer-registry rollout, audited renewal/recovery/status UI, HTTP/CSRF/rate/tenant boundary, private role/TLS/pool/native packaging and reviewed migrations, actual AWS/IAM/current SDK/simulation/browser acceptance. The old disposable registry helpers remain private QA primitives and must not bypass these gates in a live path.

References: [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html), [node-postgres transactions](https://node-postgres.com/features/transactions), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
