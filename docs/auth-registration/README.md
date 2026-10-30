# Bilingual authentication candidate — Task 2

User approved the six-state layout on 30 October 2026, with the existing live Yaqeen theme retained. This branch is a review candidate only; do not merge or publish without final approval.

## Implemented

- Sign In / Create Account tabs; password sign-in is the default. Email precedes the password / quick-link selector. Google remains below the divider.
- Full name, international telephone (including country calling code), email, password, confirmation and consent. Paired fields on desktop, one column on mobile. Standard HTML autofill; only optional remembered email is stored by the application.
- Supabase signup and dedicated magic-link requests (`shouldCreateUser: false`); password recovery remains separate. Verification waiting and expired/reused-link screens; a 60-second resend UI. Generic account-existence messages.
- No grace-period financial session. Existing Supabase Confirm Email stays enabled. Signup sessions returned by unexpected configuration drift are signed out. Callback and confirmation endpoints check authoritative email verification.
- Email scanner protection: GET displays a confirmation form; POST alone consumes the email token. POST validates same origin, uses Supabase verifyOtp, preserves locale and validated next/invite, and does not permit recovery tokens to impersonate magic links. OAuth PKCE and existing recovery callbacks remain supported.
- Separate AR/EN magic-link and signup templates in `supabase/templates/`. Supabase remains the authentication service; **Resend SMTP remains the approved Production delivery provider**. Do not switch Production to the Supabase built-in mail service. The new templates reuse the previously approved recovery-email header, logo, typography, colors and table layout. Production SMTP is smtp.resend.com:465, username resend, with sender no-reply@auth.yaqeenbiz.com; the stored sending-only domain-scoped secret is unchanged and never copied.
- Bilingual **draft** Terms and Privacy pages at `/auth/legal?kind=terms&lang=ar` and `kind=privacy`. User requested drafts; they require review, completed operator/contact/retention details and approval before public acceptance.

## Email template prerequisites

Templates select requested language from the redirect URL, not stale profile metadata. `getEmailAuthCallbackUrl` puts `lang` first. Supabase Site URL must be the exact canonical origin **without trailing slash** (for QA, the tested Preview origin). Approved redirects must include that exact callback origin/path. Do not install these templates on Production until the matching application route is deployed and final approval is received. Keep the existing approved Resend sender and SMTP secret; never copy Production secrets to QA. Disable email click tracking / link rewriting for authentication messages.

## Verified environment observations (read only)

Cloud QA: `weucywfwbdnomtlkjurl`, Yaqeen Platform Admin QA. Confirm Email and Email provider enabled; Google disabled; email OTP expiry 3600 seconds. QA uses built-in email, unlike Production's configured Resend SMTP. Four existing QA users were observed in an aggregate count only; no changes were made to them. No database migrations or financial records are changed by this task.

Preview branch environment is restricted to this QA URL, key, project ref and `NEXT_PUBLIC_APP_ENV=qa`. The branch explicitly has no service-role credential. Global Production/Preview service-role inheritance is overridden with an empty value for this branch.

## Acceptance and release gates

Local TypeScript, tests and build must pass. GitHub Actions `Isolated bilingual authentication acceptance` starts a disposable real Supabase Auth + PostgreSQL + PostgREST + Mailpit stack, submits real signup requests and delivered local emails, verifies tokens through the application endpoint, checks passwords, recovery, sessions, reuse/invalid tokens and isolation with synthetic data. No cloud database or user is written. The minimal ownership fixture is not a full Production RLS re-audit.

Browser checks must cover the Preview AR and EN forms and all six states. A QA-only `/design-review/auth-mobile` route renders the real AR/EN login pages in 375×812 CSS browser viewports. This verifies responsive CSS and scrolling, not touch hardware or a native mobile browser. It returns 404 outside QA. Illustrative mockups do not count as responsive acceptance. Native password-manager save prompts depend on the browser and cannot be certified by field attributes alone.

Outstanding before release:

1. User explicitly instructed preserving existing Production Resend SMTP settings. Do not replace the sender, key, port or provider. Review the two new template contents and validate external delivery/click-through using a controlled mailbox before claiming the new templates are Delivered. No fresh key or QA SMTP reconfiguration is required without a separate request.
2. User confirmed Google works in Production and explicitly instructed keeping all Google settings unchanged. Preserve the existing provider, OAuth client and callback contract. QA Google is disabled, so this candidate must not claim a fresh full Google login from QA; validate the unchanged request/callback contract and record the existing Production confirmation.
3. The user explicitly removed the 24-hour requirement because no workspace access is granted before verification. Retain the existing one-hour Auth link expiry, confirmation and resend policy. Do not change Production email expiry, disable confirmation, grant an unverified session or delete an unconfirmed account.
4. Approve/finalize the legal drafts. Remove the draft notice and record the approved document version only after that review.
5. Complete isolated AR/EN Auth acceptance and browser responsiveness; record Google as user-confirmed in existing Production and unchanged in this branch. Finish native device/autofill and new-template external delivery acceptance where available. Obtain final merge/release and template-installation approval.

Never present an untested release gate as passed. Existing accounts, roles and financial data must remain untouched.
