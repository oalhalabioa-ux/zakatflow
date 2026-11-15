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

## 2026-11-15 reciprocal documentary matching

- Added private, audited propose/approve/revoke commands for an explicit pair of original company documents. Both-company administrative and finance permissions are required; self-approval follows the existing organization approval policy. Anonymous and direct table access are denied.
- The immutable pairing fingerprint covers original event headers and lines. Changed, revoked, draft, foreign, duplicate or substituted evidence cannot validate an elimination worksheet. Missing documentary evidence remains explicitly incomplete.
- QA V2 rollback-only execution passed the database security/lifecycle acceptance; no migration or fixture was committed there. Observed catalog delta recorded; canonical count is now 276. Production untouched.
- Added actual native-voucher acceptance for unpaired → proposed → approved → revoked document evidence, including revoked child membership. Full CI remains to be observed on this commit.
- Fixed billing form exposure before selected organization data hydration; the existing real reload/save subscription acceptance must pass again.
- Still not final consolidated reporting: persisted/versioned elimination approval, final statements/export, and unsupported acquisition/NCI/FX scenarios require completion. Do not merge or describe the worksheet as approved consolidation on this evidence alone.

## 2026-11-15 group-only batch rehearsal

- Remote `0e0b6b7ed15e047c7bd63b84358b32c1af2ccb79`: all seven workflows succeeded, including subscription reload acceptance and real documentary propose/approve/revoke with original native vouchers. Opening run 43694134047, subscription run 43694134053.
- Added a draft-only batch migration with independent SQL validation of original GL legs, closing detail balances, dated open items, approved document pairing and whole-group permissions. Batch approval is versioned, auditable and supersedes only the matching group's exact period; it never writes company journals.
- Batch command service independently replays source validation before SQL. Six service tests and TypeScript passed. SQL definition compiled in a rolled-back QA transaction. Native batch acceptance and catalog observation remain pending; draft is applied ONLY to the disposable opening runner.
- Final consolidated projection/export and user workflow are still pending. Batch evidence is deliberately not labelled a final statutory consolidation. No Production deployment or merge has occurred.

## 2026-11-15 approved evidence reader and dated source acceptance

- Remote `50c94ad38ae4f10cfd42b86402acd3bd81f3c5da`: full Opening run **43694788749** passed all four jobs, including actual batch save/idempotency, optimistic version rejection, approval, replacement and documentary revocation. Company source ledgers were unchanged.
- Reader now verifies the approved batch against current database evidence and independently replays the original sources, then rechecks approved identity/version/fingerprint. View permission is distinct from administrative write permission. The approved version remains in the 50-row inventory even after many newer drafts.
- 11 batch service tests and 4 approved route tests pass locally; TypeScript passes. New actual acceptance includes dated branch-specific vouchers and position CSV through main-banner selectors; its CI result is still pending.
- Added a read-only approved-adjustment table to the group review, scoped exclusively by banner/company and report dates. It explicitly remains a worksheet, not complete consolidated financial statements. Revoked or changed evidence removes displayed amounts on refresh.
- Remaining release blockers: canonicalize the batch migration after final native verification and observed catalog comparison; complete final consolidation (including internal cash flow and investment/equity treatment), frozen closed-year center evidence, final release QA, merge and Production deployment. No Production mutation or merge has occurred.

- Run **43695537362** passed the actual approved evidence reader and documentary revocation. Its new dated-center acceptance reconciled historical/full/subperiod amounts and preserved original branches, then exposed a UI defect: the position/cash banner picker depended on a separate branch-income source and could not list the newly dated branch center.
- Corrected position/cash picker loading to use the same verified dimensional source as those reports, with branch-specific historical rows, exact-decimal aggregation, authorized names and a final source/permission reread. Added five targeted tests; retained the failing browser interaction as acceptance (no skipped assertion or longer timeout).
- Observed native catalog for the batch migration contains exactly **50 new objects** and no removals against canonical expected schema. Promoted the unchanged CLI-generated SQL from drafts into canonical history (277 files), recorded its observed delta, and removed the duplicate disposable-only application. Canonical file/digest validation passes locally; final bootstrap and browser acceptance remain required.

## 2026-11-15 closed-year dimensions (draft rehearsal)

- Canonical bootstrap passed on `5d37e79f840675fd3250999262039762d18ff46a`. Quality exposed a missing mock for the newly added dimensional-options route dependency; corrected the boundary mock and added an explicit feature-flag/branch route test. Local full suite: **286 files, 1700 tests passed, 1 existing skipped**.
- Actual approved-worksheet API passed; browser correctly refused to show a full-year approval while the selected period was year-to-date. Acceptance now explicitly checks that refusal, then selects the approved period through the date control. No scope validation was relaxed.
- New CLI-generated draft migration captures immutable center assignments, opening allocations, original source-line dimensions and center names in the actual year-close transaction. No historical backfill from current configuration. Unconfigured/legacy closes remain explicitly unavailable for dimensional reporting.
- Frozen reader rechecks current view permissions, the matching closed source and immutable evidence. Four targeted frozen-reader tests pass; existing live dimension and picker tests pass. Native actual-close acceptance and SQL catalog verification remain pending; draft is applied only immediately before the disposable browser run.

## 2026-11-15 native closed-center verification and internal cash rehearsal

- Head `561ec4efed39086a9d576cf49b8368b09cf9d4f6`: full-schema Opening run **43696941793** passed all four jobs, including native annual close, frozen center amounts/names after live metadata changes, membership denial, dated branch selection and CSV, approved exact-period worksheet and documentary revocation. Artifact **14155315800** records the evidence. Quality, assets, settings, canonical history and isolated reporting source also passed; subscription run was still running at observation.
- Promoted the unchanged closed-dimension SQL after observing exactly **13 new catalog objects**, no removals. Canonical history now contains **278** migrations; no hosted application or Production mutation.
- Added source-bound internal cash worksheet: exact original cash legs, explicit approved documentary pairing, member/period validation, duplicate/over-consumption protection, activity-specific removal and unchanged opening/closing cash. Five new primitive tests pass; 30 focused cash/document/batch/source tests pass.
- Integrated cash requests into the existing independently verified batch service and approved worksheet UI. New CLI-generated SQL replacement remains a **draft**, applied only in disposable CI. New native acceptance creates actual receipt/payment through Liquidity, tests direct-RPC excess rejection, approval, unchanged source ledgers and revoked evidence. Its runtime result is pending.
- Still blocked from final consolidation/merge/publication: complete investment/equity treatment and scope completeness workflow, cash draft native verification, final release QA and hosted migration reconciliation. This is not yet final consolidated financial reporting.

- All seven workflows on `561ec4ef` are now observed successful, including actual subscription acceptance. Full local suite after cash support: **287 files, 1705 passed, one existing skipped**.
- The next opening runner exposed an upgrade-rehearsal ordering issue: its intentionally old initial schema does not yet contain `financial_year_closures`. The new closure evidence migration now runs after the legacy fiscal upgrade in that runner; full fresh canonical/parity ordering remains unchanged. No database requirement was weakened.
- Added prospective transfer native acceptance (past-date/stale-version rejection, invalid-destination rollback, one audited transfer and preserved historical report rows). Corrected reversal dimension validation to use the original source's dated branch assignment while retaining the reversal's actual reporting date; targeted projection/frozen tests pass.

## 2026-11-15 verified cash exclusions, prospective transfer and hosted QA

- Head `f886448aaa5bc28842770134a61ef2f0779fd3d5`: Opening run **43698234102** passed all four jobs. Artifact **14155656337** includes actual paired receipt/payment, approved internal cash exclusions, direct-RPC amount protection, unchanged company sources and documentary revocation, plus prospective center transfer, stale/past/invalid destination rejection, atomic rollback and unchanged historical reports.
- Observed cash SQL delta changes exactly one private function, with no removals. Promoted the unchanged migration to canonical history (279); removed duplicate disposable application. Final-head fresh bootstrap remains required.
- Applied only the three previously verified canonical additions to QA `ubotbpjngtfvolthpfec`: documentary matches → hosted `20261115092148` (md5 `762e91943c14fc563627a21b58eeca2f`); elimination batches → `20261115092155` (`32f85931d8d759e484192030bd611600`); closed dimensions → `20261115092204` (`aa3e298542cc51106ba7687aa91e5fb0`). No organization records or Production schema changed. All three private tables have RLS and deny direct anon/authenticated SELECT. Post-change advisors show no new anonymous function grants; authenticated RPC additions are intentional and permission checked. Existing unrelated trigger-function notices remain.
- Center-selected reports now suppress unrelated company/branch source errors and source-register fallback. Center export uses the standard compact action container. Native acceptance explicitly checks absence of the unrelated error/card while exporting the center.
- Remaining: final consolidation investment/equity/completeness and final statements/export, final release verification, merge and Production publication. Approved worksheets remain explicitly non-consolidated; this checkpoint does not declare the full task complete.

## 2026-11-15 post-control capital contribution rehearsal

- Added a narrowly scoped capital contribution pair: subsidiary share-capital debit and direct parent's investment credit, wholly owned relationship, exact closing date, actual original post-control sources, available leaf balances and documentary pairing. It does not infer goodwill, acquisition-date net assets, reserves, retained earnings or NCI.
- 43 targeted primitive/service tests and TypeScript passed; new scenarios reject reversed ownership, partial ownership, reserves substitution, pre-control sources, excess amounts, duplicate capacity and wrong date. Native receipt/recognition and SQL approval acceptance is prepared and remains pending.
- SQL remains in drafts and is applied only to disposable CI. Canonical/hosted schema is not changed by this draft. This remains an adjustment worksheet, not certified final consolidation.
- Accounting boundary reviewed against IFRS 10 B86: https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/ . General acquisition elimination requires additional evidence; a post-control contribution is only one supported component.

- Verified cash migration additionally applied to QA as hosted `20261115093130` (`financial_group_cash_eliminations`, SQL md5 `c281bbac539598b462889317ecacd6b5`). This is the unchanged canonical cash migration already tested in run 43698234102; capital contribution draft is NOT applied to hosted QA.

## 2026-11-15 capital contribution acceptance and canonical promotion

- All seven workflows passed on `99bc6a799a7923fd7407898f81a3ada690b178f2`. Full-schema run **43706630083**, artifact **14159175342**, verifies actual capital source creation, approved documentary pairing, direct-RPC excess/reversed ownership rejection, batch save/approval, unchanged company ledgers and invalidation after revocation.
- Corrected SQL CASE parsing and fixture setup: draft-only policy version, detailed rule flag, full authorized chart lookup and native creation of missing fixture accounts. Accounting/security guards were not weakened.
- Promoted the unchanged CLI-generated capital draft after QA V2 rollback-only observation: private evidence function fingerprint `df00945689a1a29a64258689f5ea4af2`; anon/authenticated direct EXECUTE both denied. No hosted change was committed. Canonical history now has 280 migrations. Removed the duplicate disposable draft application; final canonical bootstrap still requires verification on the new head.
- Remaining: final consolidated statements/export and complete acquisition/NCI/FX/scope evidence, hosted QA rehearsal, main reconciliation and release readiness. No Production mutation, merge or deployment.
