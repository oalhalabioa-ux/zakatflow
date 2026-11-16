# Feasibility invitations by email — QA V2 acceptance and release gates

## Implemented (not activated)
- Existing owner-only personal feasibility invitations still use verified email-bound 256-bit single-use codes and permit VIEWER/REVIEWER roles.
- Manual copy remains available and unchanged.
- Optional delivery `EMAIL` uses Resend with a verified sender, provider-level idempotency key based on the invitation UUID, and 10-second network timeout.
- The server refuses EMAIL before creating an invitation if configuration is missing. Only a provider acknowledgement creates a successful EMAIL response; the code is not returned to the browser in EMAIL mode. If delivery fails, the server attempts to revoke the pending token before reporting failure. Delivery acknowledgement is not proof of inbox receipt.
- Emails give the recipient a one-time code and a fixed, trusted HTTPS destination. They do not accept the client's Origin/Host as a destination, and they never embed the invitation code in an HTTP request URL.
- The invitation recipient must still authenticate using the **matching confirmed email**, have an eligible feasibility entitlement and explicitly redeem the code. Receiving an email does not grant anonymous read access.
- The Personal portfolio shows accepted collaborations under **Shared with me** as read-only remote study records; it never imports those documents into editable legacy per-user localStorage or personal JSON exports. Personal cloud restore now restores **owner-held** studies only.

## Required QA Preview configuration (not set by this PR)
1. Server-only `FEASIBILITY_INVITATION_EMAIL_QA=true` after domain and provider checks.
2. Secret `RESEND_API_KEY` in QA V2 Preview only, never NEXT_PUBLIC and never in GitHub.
3. `FEASIBILITY_INVITE_FROM_EMAIL` set to a verified sender belonging to the Yaqeen domain.
4. `FEASIBILITY_INVITE_PUBLIC_ORIGIN` fixed to a verified HTTPS QA destination with no path, query or credentials.
5. `NEXT_PUBLIC_FEASIBILITY_EMAIL_INVITES_QA=true` for QA Preview to show the extra email delivery selector **only after** the server settings are confirmed.
6. Supabase QA Auth custom SMTP using a verified sender is a separate requirement for accounts that need signup/confirmation.

The deployment has not been updated with those secrets or flags. **Do not send real email**, change Production or enable anonymous study access based on this implementation alone.

## Tests to accept the feature
- Valid owner + configured provider sends one email with hidden code, owner/invitation ID and expiration recorded.
- Unconfigured provider creates no token. Failed provider response attempts atomic invitation revocation and never returns raw secret.
- No exposure of API key or secret in response, analytics, logs or client bundle.
- New recipient signup using verified invited address, existing recipient acceptance, mismatched/unconfirmed identity, revoked/expired tokens, replay, and owner revoke.
- Shared study appears in "Shared with me" only after acceptance, opens read-only, never appears as an editable personally owned draft after logout/login or JSON backup.
- Two users and three unrelated organizations: no cross-tenant access. A received email is not acceptance or permission.
- Load/concurrency/rate limits, audit of sends/revokes, destination and domain approval, real inbox/bounce evidence, and entitlement/seat policy for invited people are **still pending** for commercial activation.

## Remaining work
- Institution-owned study invitation creation and institution→person/organization receipt flows, requiring institutional officer approval.
- Fine-grained CONTRIBUTOR/EDITOR permissions, server-side access checks and audit.
- Verified end-to-end browser QA, operational rate limits and delivery retry audit.
- Release gates in #411 / #412; never merge or activate Production based on unit tests alone.
