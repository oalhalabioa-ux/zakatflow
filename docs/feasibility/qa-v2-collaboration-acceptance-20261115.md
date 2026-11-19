# Yaqeen Business — Feasibility QA V2 Collaboration Acceptance

## Isolation and source

- Source branch: `feature/feasibility-v2-qa-activation-20261115`, created from merged feasibility baseline `e19af78185f1d0907c73193403b1d17e6e335737`.
- Authoritative QA V2 Supabase project: `ubotbpjngtfvolthpfec`; **no Production or legacy Financial Core V1 changes**.
- Feature flags `NEXT_PUBLIC_FEASIBILITY_STUDIES`, `NEXT_PUBLIC_FEASIBILITY_CLOUD_QA`, `NEXT_PUBLIC_FEASIBILITY_SHARING_QA` and `NEXT_PUBLIC_FINANCIAL_CORE_V2_HANDOFF` remain **disabled in Production**. This work does not authorize commercial activation.
- The current QA V2 Vercel project `yaqeen-financial-core-v2-qa` has a stable existing deployment, but is **not Git-linked** to this new feature branch. Source/DB verification does not substitute for authenticated browser QA on that deployment.

## 15 Nov 2026: invitation acceptance

**Problem:** The invitation redemption API and its elevated-authority PostgreSQL RPC previously accepted a confirmed-email invitation without enforcing the independent Feasibility subscription on the invitee. A valid invitation is not a license.

**Fix, branch-only application code:** `app/api/feasibility/invitations/accept/route.ts` checks `feasibility_access_grants` after authentication; permits only current `TRIAL` or `ACTIVE`, handles lookup failure with 503 and denies absent/expired/`READ_ONLY` entitlements without calling the RPC. Its source tests cover missing, expired, read-only and unavailable grants.

**Fix, QA V2 only SQL:** `qa-v2-invitation-entitlement-audit-20261115.sql` recorded in QA V2 migration history as `feasibility_invitation_entitlement_audit_qa_v2_20261115`.
- SECURITY DEFINER RPC checks active grants for **both** owner and recipient, requires a confirmed matching recipient email and a valid unused invite under row lock.
- Successful acceptance atomically inserts/updates the active member, marks the invitation accepted and inserts `feasibility.invitation_accepted` into the immutable platform audit table, without disclosing the random invitation secret.
- Test-before-apply: 9 rollback-only assertions **all true** — denied missing license, wrong email, read-only, inactive owner; accepted licensed invitation, reviewer read, replay denial, one audit event, one active membership.
- Post-apply: 6 rollback-only assertions **all true** — missing license denied; accepted; replay denied; reviewer read; exactly one audit event and active member.

## 15 Nov 2026: pending invitation revocation

**Problem:** The owner-only SECURITY DEFINER revocation RPC did not independently enforce that the owner still had an active license, even though its API route already checked.

**Fix, QA V2 only SQL:** `qa-v2-invitation-revoke-licence-20261115.sql`, QA migration `feasibility_invitation_revoke_licence_qa_v2_20261115`.
- Active owner grant required, plus owner-of-project, still-pending, creator and not-already-revoked conditions.
- Exactly one audit entry for an actual revocation; repeat returns false and creates no new audit.
- Rehearsed 6 rollback-only assertions **all true** — absent/read-only license denied; valid revoke, repeat no-op, one audit and revoked timestamp.
- API unit tests cover disabled, owner-only, cross-origin, expired/read-only and successful calls.

## Post-apply read-back verification

- Acceptance RPC: license guards for both parties + audit code present.
- Revocation RPC: active-license guard present.
- Both RPCs: anonymous EXECUTE permission **false**.
- Five Feasibility QA tables, temporary auth users and invitation acceptance audit events: **zero residual records**.
- No Production migration was applied and no real user, project or financial record was created.

## Release blockers (do not mark customer-ready)

- [ ] GitHub CI and isolated Feasibility suite green on the **exact** new PR HEAD.
- [ ] Stable feature-enabled QA V2 preview tied to this branch with isolated feature flags and validated backend; preserve existing stable QA deployment.
- [ ] Authenticated **browser** flow with two confirmed QA user identities (create study, save/reopen, optimistic revision conflict, manual JSON import/export, invite, wrong recipient, replay, revoke, local vs cloud, mobile/desktop).
- [ ] Commercial standalone module entitlement provisioning and audit (does not require Financial Core subscription).
- [ ] Reviewed Financial Core V2-only, non-posting handoff adapter and an approved separate Production data/schema rollout **before** customer activation.
- [ ] Explicit user authorization before any new Production merge or feature enablement.

**Boundary:** The QA SQL/RLS regression confirms database enforcement, **not** live browser acceptance or commercial billing activation.
