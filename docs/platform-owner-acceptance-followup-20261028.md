# Platform owner acceptance follow-up — 2026-10-28

- Branch checked: `feature/platform-owner-dashboard-qa`.
- Remote application commit: `c7ccd1ae808b7a3f6db93ab9d8384ae52eb25207`.
- Local working tree clean before testing. No application changes in this follow-up.
- QA database exclusively: `weucywfwbdnomtlkjurl`.
- Existing Preview: https://zakatflow-git-feature-platform-owner-da-f420a6-oalhalabioa-9334.vercel.app
- No new deployment, production change, database schema change, service-key use, or financial mutation.

## Actual logout and access checks completed in this follow-up

The existing real owner session rendered the protected owner overview. Navigated to the existing /ar/account page and used the actual Sign out control. The browser subsequently displayed /ar/login.

Read-only database evidence before logout: 1 auth user, 1 platform owner, 7 auth sessions.
Read-only database evidence after logout: 0 auth sessions and 0 non-revoked refresh tokens.
No credentials or token values were retrieved or recorded.

Each route below was opened independently after logout. All seven redirected to /ar/login with the corresponding next parameter; the login heading rendered and no .owner-shell was present:

- /admin
- /admin/users
- /admin/companies
- /admin/subscriptions
- /admin/payments
- /admin/analytics
- /admin/settings

This demonstrates logout, server-side session removal, refresh-token revocation, and unauthenticated page denial. It does not prove immediate invalidation of previously issued JWT access tokens: no old bearer token was extracted or replayed.

## Earlier visual checks on the same application commit

The preceding review verified all seven owner pages at widths 360, 390, 600, 768, 850, 1024 and 1440 (49 cases), actual pointer navigation, four theme icon controls and persistence, original light/dark logos, and sidebar preferences. TypeScript and Next.js build passed. The earlier UI iteration passed 151 unit-test files / 789 tests; those unit tests were not rerun in this documentation-only follow-up.

## Remaining acceptance gate

A real ordinary-user session and its protected RPC denials remain NOT TESTED. Read-only user counts confirm QA currently contains only the owner. The existing UI creates accounts through an emailed sign-in link (shouldCreateUser=true); it has no password signup screen. Completing this flow requires a user-controlled test mailbox and its secure verification. No ordinary account was created, no owner permissions changed, no service key used, and no credentials invented.

Historical SQL claim simulations in the earlier report are not substitutes for real-session tests. The earlier Google-provider-disabled finding still applies; later email/password owner login succeeded.

Status: PARTIAL ACCEPTANCE; no merge or additional deployment until the ordinary-user gate is closed.
