# PR302 disposable concurrency test

Verified PASS on 28 October 2026:
https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40620717803

See docs/pr302-concurrency-closure.md and docs/pr302-concurrency-results.json
for executed cases, evidence, scope and limitations.

The workflow is limited to review/pr302-isolated-concurrency-run and accepts
no hosted database URL or Production secrets. It starts an unlinked local
Supabase stack, runs bootstrap-local.sh and concurrency.mjs, uploads the report,
then stops the disposable stack. Run only in a disposable runner.

schema-history.sql reproduces original applied definitions from the isolated
branch, including the financial core foundation missing from repository
migrations. schema-manifest.json records provenance and excluded record-specific
data repairs. No application rows or users are exported.

The test uses real independent local Auth users for first issue/post and replay
in both directions and two companies. It records simultaneous PostgreSQL
backends, checks unique consecutive voucher numbers and reconciles cash,
events, lines, obligations, settlements and posting commands.

The year-boundary matrix uses SQL source fixtures and the real voucher trigger.
This is not browser E2E, a load test or general double-entry certification.
Never apply this fixture to an existing database. Keep this test branch separate
from PR302's eight approved application repair commits.
