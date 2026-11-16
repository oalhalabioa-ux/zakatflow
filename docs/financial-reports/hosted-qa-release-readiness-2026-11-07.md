# Financial Core QA — read-only release prerequisite inventory (2026-11-07)

**Scope:** PR #360, hosted `ZakatFlow Financial Core QA` project. Observation only.
**Production, main, hosted QA tables and hosted customer records were not changed.**

## Confirmed through read-only SQL
The exact repeatable query is `tests/qa-financial-hosted-readiness.sql`.

| Prerequisite | Hosted Financial Core QA as observed |
| --- | ---: |
| Operating active branches | 0 |
| Approved financial opening workspaces | 0 |
| Branch-linked posted financial events | 0 |
| Financial events (all statuses) | 71 |
| Existing company live snapshot RPC | Present |
| Branch opening distribution private table | Missing |
| Effective-dated group control assessment private table | Missing |
| Server-side legacy-sale-cost attestation RPC | Missing |

Source: authenticated Supabase project administration's **read-only SQL**, not signed-in end-user RLS. The output includes no organization, employee, account, customer or monetary identifiers.

**Conclusion: BLOCKED.** Six green GitHub workflows validate the PR on disposable local databases, but do not make this hosted QA schema or its journal/opening population equivalent to the tested release. Reusing older hosted Financial Core QA data does **not** prove branch report correctness. The SQL always returns `productionReady=false` because server-wide inventory is not a same-snapshot authenticated source certificate or a complete human UAT. Schema/data counts alone must never unlock reporting.

## Work remaining, in order
1. **QA migration compatibility:** rehearse the existing Financial Core QA schema and data on a separate, restorable isolated copy. Identify differences between the QA's historical clone/migration track and the repository's canonical migrations, before applying anything to the existing QA project. Do not call `supabase db push` on a live project based only on a successful empty-database bootstrap.
2. **Representative legal company:** with explicit agreement for a separated QA-only fixture, prepare an authenticated owner and restricted finance operator; create HQ and at least two *active* operating branches, including one zero-opening branch, actual posted income/cash/asset sale/transfer events and an approved, versioned branch opening distribution.
3. **Same-revision certification:** deliver a versioned and narrow authenticated database certificate for every canonical opening and journal line, raw reversal, VAT refund, legacy asset lot/cost part and actual cash/transfer leg in one consistent PostgreSQL snapshot. Cross-check date/status, account mappings, account ownership, line amounts and reversal signs. Never infer zero cost from invisible RLS rows.
4. **Branch and HQ:** independently authorize and allocate all original line identities; prove per-journal and opening balance, source-to-branch reconciliation and clearing references. A balanced total without exact source coverage is not a pass.
5. **Legal group:** obtain independent authorized reads for all member companies plus dated ownership/control evidence; prove eliminations, FX translation and non-controlling interest. Keep statutory group output disabled until signed off.
6. **Personal scope:** separately verify personal opening provenance, ledger classifications, net profit, cash-flow categories and period-year transitions, without copying institutional chart behavior into personal.
7. **Release acceptance:** real Auth/RLS browser workflows (Arabic/English, desktop/mobile), source performance testing, qualified accounting sign-off, Production restorable backup and isolated restore rehearsal, rollback plan, then explicit merge/publish approval.

## Operational safeguards
- No write against the hosted QA project is implied by this report.
- No Production, `main`, Hostinger, subscriptions, customer or original financial rows were changed.
- `tests/qa-financial-hosted-readiness.sql` is aggregate-only and uses no DDL/DML.
- The same SQL is checked in the disposable full-schema GitHub acceptance job to guard against missing repository objects, but that job intentionally remains **BLOCKED** for authenticated hosted UAT.
- No client-side `complete` or GitHub CI green check is a financial source certificate.

## Gate
**Do not merge/deploy PR #360** on the basis of this inventory. Keep Draft; rerun the read-only query after an approved QA deployment or controlled isolated fixture work, then obtain independent authenticated source/branch/group sign-off.
