# Reporting release checkpoint — 14 November 2026

This is an implementation checkpoint, **not release approval or a claim of completed consolidation**.
The user has authorized completion, merge and Production deployment. No additional user approval is needed for the agreed scope; the remaining gate is technical completion and verification.

## Verified evidence

- `b6a8e5065ddcd4ad82e21f7b157507645d2d4dca`, full-schema run `43640322960`, artifact `14131732686`: all four database/browser jobs passed. Actual two-center expense posting, dated center registry, exact approved opening allocation, three statements, banner selection, refresh and CSV were exercised against disposable Supabase; browser exceptions were empty.
- Mobile center assignment overflow fixed; Settings UI run `43639733538` passed save, reload, future transfer and viewport assertions.
- Registry migration `20261114201716` promoted using observed schema fingerprints from run `43637445927`, artifact `14131395152`.
- Approved-only dimensional report context `20261114204837` promoted using observed function fingerprint from run `43640322960`. A pending editor draft does not displace approved reporting allocations; superseded legal openings invalidate the old allocation.
- Complete registered group graph draft was exercised in PostgreSQL, including an unauthorized structural subsidiary that must deny the entire group rather than disappear.
- Native dimensional opening editor and explicit center/branch selections are feature-gated. The latest browser cycle additionally checks correction draft persistence; it must pass on the final release head.

## Remaining release work

1. Obtain all required checks on the exact final head after canonical migration promotion and UI changes.
2. Verify the promoted complete registered group migration on the final canonical bootstrap. Its actual SQL acceptance and fingerprint were captured in run 43641211891 / artifact 14131674924. It enumerates registered platform relationships; it does not establish unregistered legal entities.
3. Persist, approve and independently validate source-bound group eliminations and their audit history. The existing in-memory adjustment worksheet is **not** an approved consolidation ledger.
4. Finish final consolidated statements and exports after investment/equity eliminations, NCI/acquisition adjustments and currency translation where applicable. Never rename a pre-elimination rollup as consolidated.
5. Complete actual acceptance for the new temporal center adapter and frozen closed-year dimensional sources. Cross-branch reversal/carrying-balance transfers must remain explicit source-backed operations; changing a registry assignment must never fabricate balancing entries.
6. Reconcile current Production/main changes, rehearse the final migrations in QA, verify backup/rollback readiness and only then merge/deploy. Feature flags must not be enabled before their corresponding database and reporting paths are verified.

At the initial checkpoint no hosted schema had changed. The QA rehearsal below supersedes that statement. No Production deployment or merge was performed; automatic intermediate Vercel previews were canceled.

## Source-bound elimination checkpoint

- Exact source-leg worksheet added for intercompany balance and income eliminations. Requests select organization, event, immutable line part and leaf account; the server reads and independently rechecks all sources and registry permissions. Client-supplied source snapshots are rejected.
- It rejects foreign members, nonexistent leaf/line identities, reversed source events, amounts exceeding the selected leg or remaining detail-account balance, invalid periods and repeated consumption. Explicit organization binding removes ambiguous parent-total matching.
- This is a **read-only preview**, behind `FINANCIAL_GROUP_ELIMINATION_PREVIEW` (off by default). It does not establish reciprocal documentary matching or open-invoice settlement allocation and is not an approved elimination ledger. No final group export is enabled.
- 39 targeted tests passed, including route origin/body/cache guards, source changes and revoked permissions. Current complete browser run 43641211891 passed all four jobs, including center correction-draft persistence and permission loss during exports.
- Initial read-only QA inspection found latest version 20261110193204. The four verified additions were subsequently applied to QA only, as recorded below.

## Hosted QA rehearsal — 14 November 2026, 21:26 UTC

Project: QA V2 `ubotbpjngtfvolthpfec`. Production `ejpzcsfwqziqxwhvqnay` was not modified.

| Canonical file version | Hosted QA version | Addition |
| --- | --- | --- |
| 20261114184148 | 20261114212626 | Dimensional opening distribution |
| 20261114201716 | 20261114212634 | Dated center/branch registry |
| 20261114204837 | 20261114212641 | Approved-only dimensional report context |
| 20261114205354 | 20261114212652 | Complete registered group scope |

- Inspected existing source tables and permission function before applying additive migrations.
- All four migrations applied successfully. Compared **98 catalog objects** against the observed disposable-schema fingerprints: **98 matched, zero differences**.
- Executed the dimensional opening, dated registry and group-control acceptance SQL on hosted QA. All passed; each transaction rolled back every synthetic user, organization, assignment, allocation and control record.
- Security baseline: anonymous executable-function warnings remain 2 (unchanged); password-protection warning unchanged. Four new private RLS tables intentionally expose no direct policies. Eight new authenticated RPCs are deliberate permission-checked entry points. No anonymous access was added.
- The hosted migration versions differ because the management API assigns application timestamps. Do not reapply these additions by canonical filename alone; reconcile names and checksums.
- Source-bound two-company browser acceptance added on head `9a5df09b026ac9109017c1ba5ec2285bfa56c633`; its new run must be inspected before claiming the end-to-end worksheet complete.

### Two-company test follow-up

Run 43642697600 passed replay, production parity and compatibility. Its browser job passed all existing flows, including all center statements and source review, then rejected the new revenue fixture because its nullable `cost_center_id` was omitted. The fixture now sends explicit null, matching the native command contract; no production validation was weakened. Six source-bound service tests and TypeScript validation pass, including malformed server evidence returning a source error rather than a client-input error. The corrected actual worksheet test still requires a successful run.

## Verified actual group preview and temporal center projection

- Head `56e260d5a437121f71aa1d55634a9826aea5f793`: all four jobs in Opening acceptance run **43643444642** passed. Job 132595817504 explicitly passed the actual two-company source-bound worksheet (2026-11-14 21:39:13 UTC), including excess-amount rejection, unchanged company sources and revoked subsidiary access. This proves the preview path, not final consolidation approval.
- The next local change adds contiguous dated center/branch slices from fiscal start through report end. Every original GL leg uses its transaction date; opening allocations use fiscal start. Gaps, overlaps, unapproved mappings and mismatched historical branches fail explicitly.
- A center may now produce separate historical branch rows; the existing center UI/export already sums all matching rows when All branches is selected. This does not move opening balances or create transfer journals. A registry transfer alone has no accounting effect.
- 33 targeted registry, dimensional projection/source/service and opening tests passed. A new final-head CI run and actual midperiod-transfer acceptance remain required. Frozen closed-year dimensions and cross-branch reversal attribution remain protected, not silently inferred.

## Source-document outstanding check — 15 November 2026

All seven workflows on `ff103afcff528217cda7602a544bef467419c83f` completed successfully, including full-schema browser acceptance 43644457775.

The next change binds balance-elimination preview to the selected invoice obligation. The authenticated reader loads actual root obligations, credit/debit notes, allocations, event dates/statuses and reversal links using tenant filters, exact row counts, pagination and decimal-text amounts. Permissions and the complete evidence are read again. Missing/ambiguous obligations, incomplete pages, inconsistent reversals, over-settlements and concurrent source changes fail closed. Balance adjustments use the report closing date. Income eliminations do not incorrectly require an unpaid invoice.

22 targeted tests pass. The actual two-company acceptance now also checks native outstanding amounts of 100 and 60. This new reader still needs its final-head actual CI acceptance. It does not prove reciprocal counterparties and does not implement an approved consolidation ledger; no final export or Production deployment is enabled. No hosted schema migration is required by this change.
