# Yaqeen recovery email

Configured 2026-10-29. Supabase Production: `ejpzcsfwqziqxwhvqnay`; isolated template review: `weucywfwbdnomtlkjurl`.

## Templates
- `preview-ar.html` / `preview-en.html`: design previews with dummy links, no reset tokens.
- `recovery-ar.html` / `recovery-en.html`: language-specific email-safe HTML.
- `recovery-supabase.gohtml` / `recovery-subject.gotmpl`: deployed conditional body and subject. Match the existing getRecoveryRedirectUrl() contract, based on RedirectTo and SiteURL; no user metadata or role changes. Arabic fallback for legacy/unknown redirects.
- `production-template-before.json`: prior public subject/body for rollback. Contains no credentials or user tokens.

## SMTP
Resend SMTP, `smtp.resend.com:465`, username `resend`. Sender `Yaqeen Business | يقين الأعمال <no-reply@auth.yaqeenbiz.com>`. Stored SMTP credential encrypted by Supabase; never copied into this repository. Current key label: `Yaqeen Supabase Auth SMTP - active`, sending-only, restricted to `auth.yaqeenbiz.com`. The earlier unused setup key was deleted after explicit owner approval; Resend confirmed only the active key remains. No paid plan was purchased.

Domain ID: `c9063272-eb0a-440d-bb52-44c556ec410b`, Ireland. Resend showed Verified after the owner added the three DNS records in Hostinger. No website or apex email record was modified by this task. Receiving is disabled; tracking metrics were not configured. Optional root DMARC was not added without reviewing the existing zone.

## Validation
- SMTP enabled and fields persisted after dashboard reload; stored password hidden.
- Auth recovery requested from the real official app; Resend reported Delivered to the owner's authorized company mailbox. Delivery means the recipient mail server accepted the email, not verified inbox placement.
- Body reviewed on isolated QA and exactly compared with source after removing Dashboard's preview-only CSS. Production source also compared and reloaded.
- First sends used a cached old template; a later Arabic message used the new subject/body. Actual Arabic message verified RTL, correct branding, no English body, no unrendered Go placeholders, and callback locale=ar on app. No token-bearing URLs were logged or saved.
- Actual English message verified new English subject/body, LTR, no Arabic body, no unrendered Go placeholders, branding and callback locale=en on app. Both new-language messages were Delivered. No tracking rewrite was found in either message.
- Full reset and subsequent password login remain user acceptance steps. No password or role was changed; no financial data or database migrations.

## Operational notes
Supabase Auth caches rendered templates (current upstream default max age is 10 minutes); do not assume a just-saved template is immediately in use. Confirm actual subject/body from a delivered message. Dashboard Preview displays unexecuted Go conditions and is not evidence of locale rendering.

For Monaco: focus Editor content, Control+a (lowercase a), Backspace, then insert the template once. Compare through preview iframe srcdoc, accounting for preview-only injected CSS. A fill against Monaco's textarea can otherwise replace only its visible context.

## Acceptance / rollback
Check actual AR and EN messages, one-use links and expired links using an authorized test account. The owner must enter/submit any new password. Test mobile/email-client rendering before claiming client compatibility. To roll back templates restore `production-template-before.json`; to roll back SMTP disable custom SMTP only with owner approval. Existing passwords and OAuth settings are unchanged.
