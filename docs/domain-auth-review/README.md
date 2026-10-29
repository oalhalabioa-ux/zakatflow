# Domain and authentication candidate — 29 October 2026

Status: preview candidate; do not merge or release without final user approval.

## Approved scope

Preserve the marketing design served by app.yaqeenbiz.com at d6f5153. Prepare the same design for yaqeenbiz.com and www.yaqeenbiz.com. Keep app for the financial platform and /admin for the owner console. No registration tab or login redesign. Preserve accounts, authorization and financial data.

## Diagnosis

- Vercel production app alias points to d6f5153; apex/www respond from Hostinger. Hostinger dashboard subsequently confirmed its current main deployment is also d6f5153. Both public CSS bundles were identical by SHA256 on all three hosts during the review.
- Production Supabase is ejpzcsfwqziqxwhvqnay. Google and Email are enabled. Site URL is https://www.yaqeenbiz.com. The three allowed redirects include the legacy Vercel alias and www callback/reset, but not app. This conflicts with app-origin PKCE callbacks.
- Logs include reused OAuth state and missing refresh/session errors from www. These are observations, not proof of one exclusive root cause.
- Existing account aggregate: four have passwords, three do not. No accounts were modified.
- PR 309 already contains the focused carousel/mobile fix. This candidate includes its component, preserving the other marketing styles and assets.

## Implemented candidate

- Known production marketing hosts forward platform routes to app before auth starts. Preview origins remain isolated. Legacy login aliases and locale prefixes/query parameters are resolved centrally.
- In-flight OAuth/recovery links issued for a previous host restart sign-in/recovery on app. Their codes and tokens are not transported to another host; existing financial/account data is unaffected.
- Language and safe return routes survive OAuth, recovery and login-language changes; unsafe external return destinations are rejected.
- Request-scoped server refresh writes updated cookies and private/no-store headers. Callback and recovery exchanges are excluded from middleware refresh.
- Owner pages retain database authorization and disabled writes. Central bilingual text and navigation preserve language. Legacy localized admin routes redirect to the protected console.
- QA config fails closed when its expected Supabase project does not match or points to Production.

## Preview isolation

Branch: fix/domains-auth-bilingual-20261029.
Selected existing QA: weucywfwbdnomtlkjurl (Platform Admin QA). This has owner foundation data, not a full financial-core schema. No migrations were applied and no data was copied from Production. Branch-only Vercel preview variables select QA, and override inherited service-role credentials with a disabled value. No service-role key is needed for these auth and owner flows.

Google is disabled in this QA project. Successful real Google authentication is therefore **not accepted or claimed**. A build, unit test or Google selection screen is not a successful login. Enabling QA Google requires configuring the existing OAuth client and authorizing the QA Supabase callback in Google Cloud; no new client/project is proposed. Current Google Cloud access was unavailable during diagnosis.

## Production changes requiring specific approval

1. Set Supabase Production Site URL to https://app.yaqeenbiz.com.
2. Add https://app.yaqeenbiz.com/auth/callback** and https://app.yaqeenbiz.com/auth/reset-password** to the redirect allowlist; retain the existing entries during the transition.
3. Confirm the existing Google client accepts https://ejpzcsfwqziqxwhvqnay.supabase.co/auth/v1/callback. Do not rotate or replace its secret/client without separate evidence and approval.
4. After final release approval, deploy this same reviewed source on Hostinger for apex/www and on Vercel for app. Verify external redirects, session cookies and no-store behavior on both providers.

No database migration or role change is proposed.

## Acceptance still required

Use only designated QA/test identities. Test Google existing/new accounts in both languages, password success/failure, reset mail receipt and password change, refresh/reload/logout, and owner/ordinary user denial through UI and PostgREST. Do not reuse a real customer's credentials. Password changes through the browser require secure user entry. The QA database is not a full financial-module acceptance environment.

Recheck desktop/mobile design, swipe and vertical scroll at 390×844 and 360×800 in both languages. PR309's separate historical browser run is supporting evidence, not a rerun of this candidate.
