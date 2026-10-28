# Platform Owner QA verification — 2026-10-28

**Release status: INCOMPLETE. No new Preview deployment.**

Repository: `oalhalabioa-ux/zakatflow`. Branch: `feature/platform-owner-dashboard-qa`.
Preserved original local commit: `d896390feaf1e211a6302131e43273b2563ecc3e`.
Verified remote base: `2bb68d88b9a6f0619c239410ff4bbb111ca83bc6`.

## Work preserved
The existing design, original uploaded logo bytes, four themes, selected tabs, sidebar icons and saved appearance controls are preserved. No financial behavior or database schema was changed. A branch-specific `git.deploymentEnabled` rule prevents a GitHub save from creating an untested deployment. Other branches and Production are not affected. See Vercel's official [Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

## Isolation: configuration audit passed
All project environment metadata and the effective branch-specific Preview entries were inspected. Browser/server Supabase clients both use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The URL and decoded anon JWT reference match **only** `weucywfwbdnomtlkjurl`; the JWT role is anon. The complete key also exactly matches an active publishable/legacy anon key returned by the allowed project itself. The branch service-role variable is a deliberate disabled placeholder, not a credential, and overrides the shared service-role default. No service-role secret was copied or enabled.

A Preview-only branch override for `NEXT_PUBLIC_APP_URL` was added and read back. It points to the existing QA branch alias, replacing inheritance of the general application alias. The three Supabase variables were not changed. No custom environment overrides exist for this branch, and no alternative database-connection variables were found. The runtime client source contains no other database endpoint. Financial Core endpoint constants are equality guards for separate inactive QA features, not alternate clients; their workflows were neither modified nor executed. The current configuration is isolated; no authenticated browser network trace has been captured.

No secret values are included in this report or its JSON companion. No Production/FATOORA QA/Financial Core QA database was queried or modified.

## Verification
- TypeScript: PASS. Vitest: **151 files / 789 tests PASS**.
- Next.js build: final repeat PASS. Existing CSS compatibility warnings remain outside owner files.
- Original uploaded assets: **4/4 byte-identical**, **4/4 successful HTTP image responses**.
- Built-server anonymous requests: **7/7 redirect to the corresponding login URL**. This used an inert placeholder key and tests routing only.
- Live allowed QA database, read-only rolled-back transactions: all **9 owner read RPCs** succeeded using existing owner claims; all **11 protected RPCs** rejected simulated nonowner claims, and the same **11** rejected anonymous calls. Direct nonowner reads of all platform tables returned zero visible rows or permission denial. Mutation RPCs received null arguments and failed on authorization; no writes occurred.

## Current acceptance attempt — Google authentication blocked

Starting remote commit was verified as `25cc334bc64111cf35d845ac96229dea4baed773`; no newer remote changes were present. A separate checkout was used; the original local history was not reset or overwritten.

The available cloud Chrome browser successfully opened the existing QA login screen through an authorized, expiring Vercel deployment access link. Vercel protection was not disabled. This existing deployment is built from **2bb68d88b9a6f0619c239410ff4bbb111ca83bc6**, so it is not browser acceptance evidence for the current branding/sidebar changes.

The application's visible Google sign-in button was clicked. The browser navigated to the allowed project's `/auth/v1/authorize` endpoint on **weucywfwbdnomtlkjurl.supabase.co**. Supabase returned:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

This is a disabled Google provider in the allowed QA project, not a wrong password, user refusal, Google bot block, or a browser-installation failure. The Google account chooser was never reached, no credentials were entered, no owner login occurred, and no authorized session was obtained. User consent alone cannot complete a flow whose provider is disabled. No authentication settings were changed and no alternative owner was created.

Per the user's stop condition, release work stopped at this essential gate. No ordinary test account was created because it could not close the blocked owner-login acceptance gate. Owner access to seven pages, ordinary-user browser/RPC denial with a real session, logout/session revocation, and the current commit's four-theme/responsive/sidebar/asset runtime checks remain **NOT EXECUTED**. Previous SQL claims simulations remain labeled simulations; the previous passing build/unit results are historical and were not rerun for this documentation-only update.

Required next prerequisite: the authorized administrator must configure/enable Google Auth for **only** `weucywfwbdnomtlkjurl` through a secure administrative session, without exposing OAuth credentials. Then resume the real owner login and remaining acceptance tests. This prerequisite was not performed in this task.

**No new Preview was created; branch automatic deployment remains disabled.** Production, other QA databases, passwords and service keys were not modified or used. No design or application code changed in this attempt. Temporary Vercel access was created for the existing deployment only; the access token, OAuth parameters and any credentials are omitted from the report.

## GitHub save and release decision
Git CLI push failed before upload because no CLI credential was configured. The authenticated GitHub connector saves the identical final file tree as a new commit based on the verified remote base; this gives a different remote SHA. The original local commit and its history remain intact. The branch update uses the expected remote SHA and rejects concurrent changes. No force update, main merge, Production deployment, payment collection or paid resource creation is performed.

**Do not deploy until real authorization and browser acceptance gates pass.** This task creates no new Preview and does not present an older READY deployment as the new result. Machine-readable sanitized evidence is in `platform-owner-qa-verification-20261028.json`.
