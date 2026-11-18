# Yaqeen Business — institution-owned study sharing (QA V2 design gate)

**Status:** design and acceptance plan only. No organization invitation schema/endpoint/permission is enabled by this document. Do not change Production, Financial Core V1, existing personal JSON, or owner of a study.

## Current QA evidence
- One saved organization study belongs to the organization principal (`organization_id` set, `owner_user_id IS NULL`); creator provenance is distinct and immutable.
- Existing organization OWNER has active QA trial; RLS tests on the saved study confirm active VIEWER may SELECT, cannot INSERT/UPDATE, and a SUSPENDED **organization membership** cannot SELECT. Fixtures are rolled back.
- Existing feasibility licence policy deliberately retains read/export in READ_ONLY/SUSPENDED/CANCELLED states (see `lib/feasibility/access.test.ts`). It denies changes. Do not silently reinterpret status semantics; a policy change requires separate approval.
- Current `/api/feasibility/invitations` and `feasibility_accept_project_invitation` are **personal-only**: the request checks `owner_user_id=auth.uid()`, and the secure RPC refuses projects with a NULL personal owner. Reusing them for a corporate invitation without modification will fail and must never bypass that check.
- All active members of an organization can currently read its feasibility studies through RLS, but only OWNER/ADMIN may edit. This internal organization access is NOT a cross-organization invitation.

## Distinct scopes and role matrix
| Principal | May view | May edit assumptions | May invite/revoke | May approve/handoff |
| --- | --- | --- | --- | --- |
| Personal study owner | yes | yes with active licence | yes with active licence | future versioned approval |
| Organization OWNER/ADMIN | yes | yes with active licence | yes with active licence | future authorized workflow |
| Internal organization VIEWER/ADVISOR | yes (RLS) | no | no | no |
| External named VIEWER | after verified acceptance only | no | no | no |
| External named REVIEWER | after verified acceptance only | no | no | review annotations only when implemented |
| External named CONTRIBUTOR | after verified acceptance | scoped contribution only after audited permission model | no | no |
| External named EDITOR | after verified acceptance | scoped versioned edit after RLS+API checks | no | no |
| Organization-to-organization grant | **not** equivalent to sharing with an individual user | future approval of both organizations | authorized institutional officers only | future |

Never silently transfer study ownership between PERSON and ORGANIZATION. Sharing grants access to the same source record; it is not a copy or an accounting entry.

## Recommended separate QA-only implementation
1. Add new **private institutional invitation state and audit** with an explicit organization scope, project ID FK, creator, recipient verified email (or recipient organization for an approved organization-level flow), role, 256-bit random secret hashed as SHA-256, expiry <=7 days, one-time redemption, revocation, and immutable acceptance.
2. Use a distinct server-only feature flag `FEASIBILITY_ORG_SHARING_QA` default OFF plus a separate private database rollout switch default OFF; leave the existing `FEASIBILITY_ORG_QA` on for normal organization creation.
3. In a single locked transaction, check inviter's current OWNER/ADMIN membership, active organization and edit entitlement; check recipient's authenticated, **confirmed** email against invite; check token digest, expiry, revocation, project/organization integrity; insert a project-specific, revocable grant with audit. Never trust client-provided role, membership or target organization.
4. Add a **restrictive read path** for an accepted named collaborator on the specified project only. No access to any other study in the source organization and no inferred membership of that organization. External write roles require separate server validations, RLS WITH CHECK + revision checks and audit first.
5. Keep manual code delivery available until QA Resend sender, SMTP/signup and bounce/abuse controls are verified. Do not put secrets in URLs, browser logs, JSON exports, analytics or database invitation plaintext.
6. Add `Shared with me` for institution-originated personal invites without mixing them into owner-held PERSONAL localStorage or the user's own ORGANIZATION portfolio. Main global topbar remains the only organization selector.
7. Apply no Production migrations; test in QA against 2 distinct authenticated users and 2 organizations using transaction-scoped fixtures with full rollback; then staged browser account checks, auditor proof and approval gates in #411 and #412.

## Next acceptance checklist
- Authenticated company OWNER/ADMIN may issue and revoke a pending invitation; internal VIEWER and unrelated user both denied, including direct API/DB calls.
- A verified recipient accepts exactly once; wrong email, unconfirmed email, replay, revoked/expired token, bad origin and absent licence all denied without leaking existence.
- Accepted invite opens **only** its project in read-only mode; no cross-organization listing or unintended editable local copy.
- EDITOR/CONTRIBUTOR are not offered until authorized diff, optimistic conflict (409), audit and separation of duties tests pass.
- Expiring/suspending a membership or revoking the project-specific grant blocks that external read; changing the creator employee does not change company ownership.
- No impact to the saved water study, current organization membership, personal dairy local draft, subscriptions, Financial Core V1 or Production.

**Release rule:** Do not mark institutional invitations as built based solely on this design. Keep #418 Draft; use a single stable QA V2 alias after exact-head automated checks.