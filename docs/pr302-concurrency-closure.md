# PR #302 concurrency closure — 28 October 2026

## Executed result
PASS: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40620717803
Tested commit: 71f74796d096bdb6651723626e66590325c9a645 (dedicated test branch).
The GitHub-hosted runner started unlinked local Supabase, recreated the schema,
completed preflight, ran the actual Auth/API tests, uploaded evidence and stopped
the disposable stack successfully. No hosted API URL or database credential is
used by the workflow.

## Authenticated first issuance and first posting
Two distinct users were created with the local official Supabase Auth admin API
and signed in independently. Both users are synthetic OWNER members of two
synthetic organizations; each organization starts with SAR 1,000 cash.
Four cases passed: PAYABLE and RECEIVABLE in each organization.
Each case simultaneously creates two different new loan contracts, cross-approves
the financial events and simultaneously posts the funding for the first time.
PostgreSQL pg_stat_activity evidence shows two active distinct backends for each
pair; expected lock serialization is allowed. The local-only timing trigger
widens the observation window but does not replace business functions.

For every case: two distinct consecutive source voucher numbers (1 and 2),
two actual financial events, two financial lines totalling SAR 200, obligations
totalling SAR 200, two posted cash settlements totalling SAR 200 and two posting
commands. PAYABLE increases cash to SAR 1,200; RECEIVABLE returns it to SAR 1,000.
Concurrent posting replay and creation replay preserve IDs, counts and amounts.

## Scope and year
The LR and LG sequences independently start at 1 in both companies.
A separate database-engine test concurrently inserts real synthetic EXPECTED
flow sources with timestamps immediately before and at midnight Riyadh:
2025-12-31T20:59:59Z -> year 2025;
2025-12-31T21:00:00Z -> year 2026.
CF sequences are consecutive within each company/year; current-year numbers
continue after the flows created by the loan cases. Other voucher types'
counters are unchanged. No duplicate canonical scope/type/year/sequence exists.
These year-boundary writes are SQL fixtures, not an authenticated browser test.
Custom company fiscal years remain a separate future requirement.

## Reproducible schema
The repository lacks the financial core foundation DDL used by the actual app.
Rather than invent tables or financial functions, schema-history.sql recovers
215 original migration definitions from the existing isolated branch metadata.
No application table rows or Auth users were exported. Two historical
record-specific data repairs are explicitly excluded in schema-manifest.json.
Original transaction boundaries are preserved. This is a test-only fixture;
never apply it to Production, shared QA or an existing database.

Read-only pg_get_functiondef hashes match between the isolated and Production
databases for create_debt_contract, post_debt_contract, ensure_voucher_number,
open_financial_account, approve_financial_event, financial_core_can and
effective_organization_permission. This verifies those business definitions;
it is not a full schema/policy equivalence audit.

## Hostinger
PR previews were disabled in hPanel using the independent PR preview control.
Read-back shows 'Turn on pull request previews', while auto-deployment remains
on and the live deployment is still 622acf084ae6dbea8a89592a956207d97462ed42
from main. Production variables were not changed. This prevents Hostinger PR
preview creation during the PR head update. Do not re-enable previews until
their database environment is independently isolated.

## Limits
This is an authenticated API/database concurrency test, not a new browser E2E
suite or a load/stress test. It reconciles this application's financial-event,
obligation and cash model; it does not certify a general double-entry journal.
Existing opening-balance and UI acceptance results remain those already
approved for 6a37c127. The eight repair commits must remain in original order;
the test-only branch must not be merged into main.

## Final release
PR #302 merged with a merge commit (no squash/rebase) on 28 October 2026:
da3d14b3c21641d4b9f96ce88a57ac12b8e1fac0.
Parents are original main 622acf084ae6dbea8a89592a956207d97462ed42 and approved
head 6a37c12770b6ed44f6920a98dba71750c273f38b; all eight repairs remain intact.

Fresh PR-head checks PASS:
- https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40621162525
- https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40621162411
TypeScript, 153 test files / 802 tests, production build and npm audit
(0 vulnerabilities) completed successfully before merge.

Vercel production deployment dpl_DBsoYiRJ5sNCMcLt2mTinnnkwDSe is READY
for main/da3d14b3 and assigned to app.yaqeenbiz.com.
Hostinger shows Completed / Current for main/da3d14b3.
Both https://yaqeenbiz.com/ar/login and https://app.yaqeenbiz.com/ar/login
rendered the expected Yaqeen login form after deployment.
No production write/E2E fixtures were created and no hosted migrations replayed.
Hostinger PR previews remain OFF; re-enable only after Preview data isolation.
Approved immutable preview remains:
https://zakatflow-gaiz0fh8p-oalhalabioa-9334.vercel.app

No remaining blocker for this PR's accepted scope. The limits above remain:
year-boundary checks are SQL fixtures, this is not a general double-entry/load
certification, and company-custom fiscal years are a future separate requirement.
