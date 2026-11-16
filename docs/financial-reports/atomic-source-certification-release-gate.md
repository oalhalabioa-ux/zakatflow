# Financial reporting: single-snapshot source certification — release gate

**Status 2026-11-07:** DESIGN / NOT DEPLOYED. PR #360 remains Draft.
Company-wide reporting has source-line checks, source-replay race detection and
isolated Production-schema QA. **None is an atomic source certificate.**
Do not enable HQ/branch or statutory consolidated financial statements based on
replay timestamps, RLS-visible record counts or generated client-side flags.

## Why a database certificate is required

The current live statement is returned by one authenticated RPC, but
canonical-line, refund-obligation, reversal and legacy source evidence are read
through subsequent independent RLS requests. They can observe different MVCC
database snapshots. Replaying the complete report at the end detects a visible
A→B change; it does **not** exclude an A→B→A mutation, a change after replay,
or inconsistent reads of raw rows during the middle of validation.

The extra server reads must be replaced by one authoritative PostgreSQL request
with **one statement-level MVCC snapshot**, including raw source evidence.
A generated `readAt` timestamp, Git commit, file SHA, policy version or
API request ID alone is not a database snapshot/revision certificate.

## Safe proposed contract (separate approved migration required)

1. Introduce a **new versioned, narrowly scoped RPC**, not a replacement for
   the existing production RPC before compatibility QA. Require a non-null
   `auth.uid()`, active org membership and effective
   `financial_core.view`. Every incoming organization ID and every returned
   source belongs to that org. Never infer subsidiary authority from the parent.
2. Execute the statement snapshot, organization/period policy, approved
   opening and source-original attestation together inside the **same
   database statement snapshot**. Use a carefully audited `STABLE` function
   and verify the volatility and snapshot behavior of every called function.
   Do not assume that sequential HTTP/REST requests share a transaction.
3. Construct an ordered, immutable source manifest for **all eligible**
   Financial Core events and raw event lines, original REVERSAL_OF event and
   line by line_number, positive VAT-note refund obligations, legacy
   non-cash asset transactions, transaction allocations, cash flows,
   settlement exclusions and transfers/intercompany transfers. Prove
   coverage (including zero eligible rows) from the original register, not
   merely from the JSON returned by the current normalizer.
4. For every original event line, verify unique source ID, event membership,
   event date/status, direction, role/classification, exact 4dp amount,
   input-VAT recoverability split and reversal sign. For each SALE validate
   independent book cost (including source lot allocations), proceeds,
   classification and no duplicate recognition. Transfers validate the signed
   net of ALL eligible legs and excluded settled/linked legs. Detect missing,
   duplicate and changed source rows.
5. For an auditable `SECURITY DEFINER` implementation, explicitly restrict
   `EXECUTE` to the intended role, revoke `PUBLIC` and `anon`, validate
   `auth.uid()`/membership inside the function, pin `search_path`, schema-
   qualify every relation, restrict side effects and result fields, and
   audit cross-tenant access. **Do not grant broader SELECT on
   `transaction_allocations`**: its current RLS is creator-only, even when
   the financial user can see the legal entity's asset SALE. Returning
   original allocation detail is not required; return a verifiable
   no-sensitive-data coverage result attached to the authorized financial
   snapshot.
6. Return a versioned, digest-linked certificate **only** if all the above
   checks pass, including counts, money controls and input revisions for
   opening/policy. Distinguish a frozen, approved `financial_year_closures`
   snapshot from a mutable live fiscal-period snapshot. Fail closed on
   incomplete or unsupported historical sources.
7. Server accepts the new certificate only from that authenticated RPC.
   No client-supplied `complete`, `revision`, `approved` or
   `sameTransactionRevisionVerified` flags are authority. Never silently
   fall back to the older uncertified snapshot when the new path errors.

## Acceptance required before the new RPC can replace existing production reads

- PostgreSQL concurrency test with independent writer sessions: the entire
  attested report must use one MVCC version, with cross-tenant access denied.
- Negative cases: duplicate/omitted VAT or refund parts, missing original
  reversal, wrong recognition sign, changed cost basis, mixed sale/asset
  classes, duplicate/settled cash legs, wrong transfer direction, frozen year
  conflicts, hidden RLS rows, role revocation.
- Verify that an authorized finance-only reader can attest a SALE created
  by a different authorized operator **without exposing that operator's lot
  allocation table**. Present policy grants do not support direct RLS reads;
  see `tests/qa-financial-production-legacy-rls-gap.sql`.
- Repeat with authorized HQ/branch attribution and approved opening splits,
  rejected incomplete cost-center mapping, all-group-member independent
  authorizations, effective control, reciprocal eliminations, FX/NCI and
  appropriate statutory disclosures **before** enabling narrow or group
  report/export endpoints. Current preflight computations are not statutory.
- Verify every new migration against a restorable Production backup and
  restore rehearsal, on a separate database with representative existing
  records, before requesting explicit merge/deployment approval. Record
  before/after source digests and independent accounting sign-off.
- Protect `main` with mandatory checks and human review. A green CI from
  PR #360 is necessary, not sufficient, for deployment approval.

**Currently implemented, but not a substitute:** replay race check,
canonical line and refund readbacks, 4dp VAT and SALE source tests, local
full-Production schema parity, and RLS fail-closed diagnostics. No
Production/main/hosted QA changes are authorized by this document.
