# QA V2 — Manual invitation schema evidence

Migration name: `feasibility_email_bound_invitation_qa_v2`.

**Applied only to** Supabase `ubotbpjngtfvolthpfec` (Yaqeen Financial Core QA V2). The canonical Production migration-history files are untouched.

Tables: `public.feasibility_project_invitations` (UUID ID, project, creator, verified intended email, VIEWER/REVIEWER role, SHA-256 digest, expiry, acceptance timestamp, revocation timestamp, created timestamp).

RLS: owner-only SELECT and INSERT, tied to `auth.uid()` and authoritative project ownership. The authenticated client has no direct UPDATE or DELETE permissions on invitations; no client writes to `feasibility_project_members`.

RPCs: `public.feasibility_accept_project_invitation(token_digest text)` validates `auth.uid()`, `auth.users.email_confirmed_at`, and exact case-normalized recipient email; locks the invitation and atomically activates the member. `public.feasibility_revoke_project_member(project_id uuid,user_id uuid)` checks owner before revocation. Both have an empty SQL search path and only `authenticated` EXECUTE privileges.

The owner provides a random code manually to its intended email recipient; the SHA-256 digest is persisted. Links, automatic emails and payment activation are deliberately disabled.

### Tested QA evidence

A rollback-only transaction created a sample owned project and invitation, verified owner visibility, rejected acceptance from a mismatched account, and confirmed that a foreign user could not view it. The transaction was rolled back and all study, member and invitation tables remained empty.

### Before enabling in customer-facing environments

Run full browser QA with two actual confirmed test identities, verify refusal for unconfirmed/wrong email, replay, expired and revoked codes, exercise owner revocation, configure rate limits, audit and subscription seats, and inspect Supabase security advisor for intended SECURITY DEFINER RPC exposure. Never add to Production until approved.
