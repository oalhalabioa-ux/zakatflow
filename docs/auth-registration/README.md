# Bilingual authentication candidate — Task 2

User approved the six-state layout on 30 October 2026, with the existing live Yaqeen theme retained. This branch is a review candidate only; do not merge or publish without final approval.

## Implemented

- Sign In / Create Account tabs; password sign-in is the default. Email precedes the password / quick-link selector. Google remains below the divider.
- Full name, international telephone (including country calling code), email, password, confirmation and consent. Paired fields on desktop, one column on mobile. Standard HTML autofill; only optional remembered email is stored by the application.
- Supabase signup and dedicated magic-link requests (`shouldCreateUser: false`); password recovery remains separate. Verification waiting and expired/reused-link screens; a 60-second resend UI. Generic account-existence messages.
- No grace-period financial session. Existing Supabase Confirm Email stays enabled. Signup sessions returned by unexpected configuration drift are signed out. Callback and confirmation endpoints check authoritative email verification.
- Email scanner protection: GET displays a confirmation form; POST alone consumes the email token. POST validates same origin, uses Supabase verifyOtp, preserves locale and validated next/invite, and does not permit recovery tokens to impersonate magic links. OAuth PKCE and existing recovery callbacks remain supported.
- Separate AR/EN magic-link and signup templates in `supabase/templates/`. Supabase remains the authentication service; **Resend SMTP remains the approved Production delivery provider**. Do not switch Production to the Supabase built-in mail service.
- Bilingual **draft** Terms and Privacy pages at `/auth/legal?kind=terms&lang=ar` and `kind=privacy`. User requested drafts; they require review, completed operator/contact/retention details and approval before public acceptance.

## Email template prerequisites

Templates select requested language from the redirect URL, not stale profile metadata. `getEmailAuthCallbackUrl` puts `lang` first. Supabase Site URL must be the exact canonical origin **without trailing slash** (for QA, the tested Preview origin). Approved redirects must include that exact callback origin/path. Do not install these templates on Production until the matching application route is deployed and final approval is received. Keep the existing approved Resend sender and SMTP secret; never copy Production secrets to QA. Disable email click tracking / link rewriting for authentication messages.

## Verified environment observations (read only)

Cloud QA: `weucywfwbdnomtlkjurl`, Yaqeen Platform Admin QA. Confirm Email and Email provider enabled; Google disabled; email OTP expiry 3600 seconds. QA uses built-in email, unlike Production's configured Resend SMTP. Four existing QA users were observed in an aggregate count only; no changes were made to them. No database migrations or financial records are changed by this task.

Preview branch environment is restricted to this QA URL, key, project ref and `NEXT_PUBLIC_APP_ENV=qa`. The branch explicitly has no service-role credential. Global Production/Preview service-role inheritance is overridden with an empty value for this branch.

## Acceptance and release gates

Local TypeScript, tests and build must pass. GitHub Actions `Isolated bilingual authentication acceptance` starts a disposable real Supabase Auth + PostgreSQL + PostgREST + Mailpit stack, submits real signup requests and delivered local emails, verifies tokens through the application endpoint, checks passwords, recovery, sessions, reuse/invalid tokens and isolation with synthetic data. No cloud database or user is written. The minimal ownership fixture is not a full Production RLS re-audit.

Browser checks must cover the Preview AR and EN forms and all six states. Actual mobile browser screenshots remain a separate requirement when viewport/device controls are available; illustrative mockups do not count as mobile acceptance. Native password-manager save prompts depend on the browser and cannot be certified by field attributes alone.

Outstanding before release:

1. Configure/approve isolated QA Resend SMTP access and a controlled QA mailbox, then verify external delivery and click-through for both new templates. Production Resend already exists and must be preserved.
2. Explicitly approve a QA Google OAuth configuration/callback before claiming new-candidate Google end-to-end acceptance. Do not create or change a Google client or reuse Production secrets silently.
3. Decide the 24-hour email confirmation policy. The observed Supabase link lifetime is one hour. The proposed app does **not** claim 24 hours, disable confirmation, grant an unverified session, or delete an unconfirmed account. Changing the shared Supabase email OTP expiry to 86400 also lengthens quick-link/OTP lifetime; this requires explicit approval and a test, or a separately reviewed provider-supported approach. Expired links can be reissued without deleting the account.
4. Approve/finalize the legal drafts. Remove the draft notice and record the approved document version only after that review.
5. Full AR/EN browser sign-in, Google and external Resend acceptance on isolated QA; mobile device/viewport and autofill/password-manager checks; final merge and Production configuration approval.

Never present an untested release gate as passed. Existing accounts, roles and financial data must remain untouched.
