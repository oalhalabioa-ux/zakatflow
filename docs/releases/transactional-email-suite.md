# Transactional email suite — preparation, not Production activation

All new messages use the existing navy/gold identity, approved logo, Arabic RTL and English LTR. Copy lives in `lib/email/copy.json`. Regenerate the Supabase templates with `node scripts/generate-auth-email-suite.mjs`.

| Operation | Message | Status |
|---|---|---|
| Auth user invitation | Accept invitation, verify email, set initial password | Template + safe confirmation route |
| Organization invitation | Organization, invited address, scoped role, exact expiry, acceptance link | Server renderer + authorized send button/API |
| Email change | Separate confirmation message for Supabase's existing confirmation policy | Template + scanner-safe wrapper |
| Sensitive-action reauthentication | Verification code, never in subject | Template prepared |
| Password change | Security notification | Template prepared |
| Email change completed | Security notification | Template prepared |
| Sign-in identity linked/unlinked | Separate security notifications | Templates prepared |
| Phone change | Security notification | Prepared; does not enable phone login/SMS |
| MFA enrollment/removal | Separate security notifications | Prepared; does not enable MFA |

Existing signup verification, quick sign-in and recovery templates remain unchanged. Google OAuth configuration, Supabase SMTP, sender and Resend DNS remain unchanged. No financial or organization schema migration is required.

## Organization invitation delivery

The endpoint requires an authenticated, active organization OWNER/ADMIN before reading one invitation with a server-only service client. The stored recipient, token, role, organization and expiry determine the message; client-supplied replacements are ignored. Expired/accepted invitations fail closed. Only the existing permitted member roles are represented, never OWNER/ADMIN/platform owner. Acceptance continues to require the invited verified email through the existing invitation RPC.

The Next.js server needs an authorized `RESEND_API_KEY` to call the existing Resend account. Supabase's configured SMTP credential is not automatically available to Next.js. No Production credential was extracted or copied. If unavailable, the email button is disabled and manual link sharing continues. A successful API response means Resend accepted the request, not proven delivery. The invitation ID is the provider idempotency key (24-hour deduplication); create a replacement invitation if a new email is necessary.

## Activation order — requires final approval

1. Review Preview and isolated CI results. The Preview has blank privileged/email credentials and cannot send invitations.
2. Deploy application routes before installing the new invitation/email-change templates.
3. Check whether an existing server Resend key is already configured without revealing it; add a server-only key securely only if specifically approved. Do not use `NEXT_PUBLIC_` for secrets.
4. Apply the three authentication templates and seven optional security templates listed in `supabase/templates/email-suite-manifest.json`. Keep confirmation, secure email change, token expiry, Google and SMTP settings unchanged.
5. Enable approved security notifications (password/email/identity changes are recommended). Phone/MFA templates can remain dormant while those features are unused.
6. Send only to an authorized test mailbox, verify inbox, links, invited address restrictions and role acceptance in both languages. Do not invite real users as a test.
7. Confirm real Resend delivery/events separately; local Mailpit is not evidence of external delivery.

No merge, Production activation, real invitation sending or security-notification toggle has been performed by this preparation change. No account is deleted or automatically promoted. The 24-hour email verification requirement remains removed.

## Verification scope

Unit tests cover render escaping, allowed origins/roles, expiry, transport failure, fixed sender, idempotency and authorization before privileged lookup. Email-change wrapper tests cover native same-origin form submission, scanner protection, malicious destinations and wrong-purpose links. The isolated Auth workflow installs actual Go templates in disposable Supabase/Mailpit and exercises existing bilingual browser flows plus real Auth invitations and password-change notifications. Organization route authorization tests use mocked clients; they are not a full Production RLS audit or external Resend end-to-end test.
