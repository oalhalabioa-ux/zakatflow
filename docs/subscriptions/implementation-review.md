# Organization trials and subscriptions — implementation review

Date: 30 October 2026. Branch: `feat/organization-trials-20261030`.

## Scope and source of truth

Extend the existing `platform_plans`, `platform_subscriptions`, `platform_organizations` and `platform_audit_events`. Keep legacy user-level `subscriptions` rows untouched. `/api/billing` delegates to the organization-scoped subscription endpoint; no prices are invented or charged. The organization-scoped API requires an organization ID and active membership.

A new organization is created atomically with its owner membership and one 30-day, five-seat trial. UTC elapsed seconds define durations, including across daylight-saving transitions. The database disregards client-supplied enrollment mode and creation time. A unique lifetime trial constraint prevents another account restarting the same organization. Verified email is required by the enrollment trigger; Google and password identities share this same path. Existing organizations without a subscription retain explicit `legacy` access and are not enrolled, charged, expired, or assigned paid status.

Invitations remain pending without consuming seats; a row lock shared by membership activation paths enforces the cap including owner, direct inserts, invitation acceptance and reactivation. Existing role permissions are preserved. Independent organizations use independent subscriptions and counters.

## Access enforcement

Database triggers enforce subscription restrictions independently of RLS, including writes performed inside privileged RPCs. Old AND new row scope are checked, including foreign-key-linked children and both sides of intercompany transfers. Private helpers cannot be executed by public clients. They do not confer additional user permissions. Existing SELECT policies are not replaced.

Budget plans previously used company names. A nullable durable organization FK is added, with identity binding on authorized saves, immutable existing binding, ambiguity rejection, and a compatibility lookup protecting old name-linked rows. No existing budget data is backfilled or rewritten.

A generated `subscription_private.guard_coverage` lists every guarded public business table. Identity, preferences, reference catalogs, notification delivery and the existing private billing control plane are exceptions. No application Storage upload path was found in the reviewed source. Review every scope path and any future business table using preflight/postflight before release; the synthetic acceptance fixture is not a full audit of the live financial schema.

Effective expiry is computed using database time for each write and each status read; it does not depend on a scheduler or the browser clock. Expired, suspended, past_due and cancelled subscriptions retain reads and exports within existing membership permissions. No customer data is deleted. Explicit billing/account/auth operations remain available.

## Interfaces and administration

- Account onboarding routes fresh verified accounts without memberships to organization creation. Existing members, invited users with accepted memberships and older accounts retain their existing paths.
- Bilingual trial/read-only banner with server-computed days, user-timezone dates, active seats and a plans link.
- In-app notices at 7/3/1/0 days, uniquely recorded per subscription/deadline/milestone (suspending and resuming does not resend the same notice). An internal sweep can materialize notices/status without an open browser. No external email delivery or paid scheduler is enabled.
- Platform-owner register with search/status filtering, pagination, trial metrics, settings, trial extension, suspension/resumption, manual activation and history.
- Existing legacy organizations can receive a manual subscription only through an explicit audited owner action; no trial is fabricated for them.
- Plan setup supports reference prices, currency and monthly/yearly cadence, without any payment gateway, settlement record, automatic renewal or charge. Manual activation requires an active plan, future expiry and sufficient seats.
- Owner mutations require live server-side owner authorization, a reason and expected revision. Audit records retain actor, before/after values and reason. Stale writes fail rather than overwriting another administrator.

## Verification and release boundary

Local TypeScript, unit, build and PostgreSQL compatibility results are recorded alongside the tests. Disposable Supabase/browser acceptance is configured in `subscription-trials-qa.yml`: it creates only local synthetic accounts and services, has no hosted secrets, tests real simultaneous invitation acceptance, API enforcement, CSV export and bilingual responsive UI, and destroys the stack afterward. Its result must be inspected; a prepared workflow is not itself a passed test.

No Production or shared QA database, Google settings, main branch, Production hosting, external email recipients or paid service was changed. Automatic Vercel deployment is disabled for this branch so it cannot inherit a Production database by accident. The isolated acceptance server is a temporary preview; no persistent hosted preview is asserted.

Latest validation results, tested commit, isolated preview screenshots and remaining acceptance limits are maintained in [Draft PR #316](https://github.com/oalhalabioa-ux/zakatflow/pull/316).

## Approval required before release

1. Review the migration, runtime source/coverage manifest, full deployed financial schema and advisors in an isolated replica. Resolve schema drift; do not replay historical Production migrations blindly.
2. Confirm a release policy for existing legacy organizations. This change preserves their current access without converting them.
3. Review screenshots and acceptance evidence, including a real Google sign-in on an approved isolated provider configuration. No fresh Google OAuth completion is claimed by the synthetic/password tests.
4. Approve the target database and deployment separately. Apply schema before releasing code; otherwise atomic creation and new RPCs will be absent.
5. Optionally schedule the internal lifecycle sweep using existing approved infrastructure. Without scheduling, effective access expiry and in-app notices on access still work; unattended notice materialization waits for the sweep.
6. Payment services, automatic collection and external trial emails remain future decisions.

Emergency rollback should disable NEW enrollment and route to the previous application while retaining trial/subscription/audit rows. Do not drop tables, delete customer records, change all organizations to legacy, or remove write guards to hide a migration error. Prepare any target-specific rollback only after isolated compatibility acceptance.
