# PR 302 disposable concurrency test — unverified preparation

This branch is a candidate, not a passing test. The historical schema order is
from README_V11.md and must be demonstrated on a clean local Supabase stack.
The workflow starts a fresh unlinked stack in a temporary runner directory,
then applies each bootstrap and migration file with ON_ERROR_STOP. It stops at
the first failure. No existing project is linked, reset, or contacted.

If all migrations succeed, the Node test uses the official local Supabase Auth
admin API to create two independent synthetic users and signs in separately.
The local-only fixture grants both test users OWNER to permit posting and
cross-approval. Two first-time loan creation requests and two funding-post
requests are issued concurrently. Assertions check distinct consecutive annual
voucher sequences, two financial events and obligations, two posted cash
settlements, two posting commands, and the resulting cash balance. These checks
reconcile amounts in this application's financial event model; they do not
prove a general debit/credit journal balance. This is an API/database test,
not a browser end-to-end test. Promise.all dispatches requests concurrently but
does not instrument server-side overlap. The full multi-year, type, company,
and contention/retry matrix remains to be added.

The test is unexecuted on a real database and may expose missing prerequisites
or behavioral defects. No credentials are included in the patch or artifact.
The workflow writes only migration status and test results to its artifact.
Local service startup output, which can contain local credentials, is not
uploaded. Run it only in a disposable GitHub-hosted runner: it uses fixed
localhost ports and local development credentials and removes its own stack.

GitHub requires a new workflow_dispatch file on the default branch before a
manual run is exposed. Do not modify main, push this branch, or update PR 302
until the effects on all external deployments are independently verified.
