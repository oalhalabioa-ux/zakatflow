# Ordinary-user browser acceptance update

Application commit tested: c7ccd1ae808b7a3f6db93ab9d8384ae52eb25207.
Branch checked before documentation: 03d193df7f4cf8e2b022ed2fd7c47bb2af8536ec, feature/platform-owner-dashboard-qa.
Database exclusively: weucywfwbdnomtlkjurl.

## Confirmed actual tests
The user created an auto-confirmed disposable ordinary QA account directly in the Supabase dashboard, without email delivery. Read-only checks confirmed email verification, a configured password, and no platform_admins membership. Password values and hashes were never retrieved.
The user supplied credentials through the secure browser-auth form. Actual login succeeded; database evidence confirmed a sign-in and one active session.
Independently opened /admin, /admin/users, /admin/companies, /admin/subscriptions, /admin/payments, /admin/analytics and /admin/settings.
All seven rendered the access-denied heading and zero .owner-shell elements.
Used the application's actual /ar/account Sign out control; the login page rendered afterward.
Read-only checks confirmed zero remaining sessions and zero active refresh tokens for this test account.
This does not prove immediate invalidation of an already-issued JWT bearer token; no token was extracted or replayed.

## QA authentication configuration
User approved changing QA Site URL from the old unique Preview to the stable QA branch alias and adding exact /auth/callback and /auth/reset-password paths for that alias.
These values were saved and verified through the allowed project's Supabase dashboard. No production or other QA project configuration was accessed or changed.
A magic link requested in the agent browser and opened on the user's device failed the PKCE exchange. A new ordinary account and password login resolved the browser acceptance blocker.

## Remaining gate
Protected RPC requests using the actual ordinary-user session remain NOT EXECUTED. Existing SQL role-claim simulations are not actual-session RPC tests.
No merge, new deployment, service key use, financial action, or application source change was performed in this follow-up.
Automatic branch deployments remain disabled. The existing Preview still serves application commit c7ccd1a.
Overall acceptance remains partial pending actual-session RPC verification.
