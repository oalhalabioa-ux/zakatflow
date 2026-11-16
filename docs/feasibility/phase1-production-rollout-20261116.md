# Feasibility Phase 1 database rollout

Related to #430 and release candidate #429. This migration starts from the canonical Production schema. On 2026-11-16, a read-only Production catalog check found canonical migration `20261110083244`, the required organization and membership columns and policies, and no Phase 1 feasibility tables.

| Scope | Phase 1 behavior |
| --- | --- |
| Personal drafts | Owner-scoped read, create, update and delete with an independent feasibility grant. A draft with an immutable review is retained. |
| Organization drafts | Disabled at the database by default. With the switch enabled, active members can read with a current read grant. Active owners and admins with a writable grant can save. Direct user deletes are denied. |
| Financial and billing boundaries | The migration issues no feasibility grants and makes no updates to subscriptions, customer records, saved studies, or financial posting tables. |
| Revision and review | Database-enforced sequential revisions. A personal review copies the stored document at the requested revision and is immutable. |
| Audit and QA collaboration | Private project audit contains IDs, action, revision and time only. Invitation email, collaboration membership, QA RPCs and a public sharing rollout are outside this migration. |

## Validation

`tests/feasibility/phase1-migration-rehearsal.mjs` runs the migration in disposable PostgreSQL via PGlite using synthetic records and the canonical organization policy migration. It exercises role and tenant boundaries, expiry and read-only mode, revision conflicts, the audit, preservation of seeded data, restoring database archives from before and after the migration, and reapplying on the restored baseline. CI uses pinned PGlite and no application secrets. The synthetic test does not validate the managed Production backup or the full hosted API.

## Release sequence

1. Record the exact release and base commits and passing required checks. Repeat the read-only Production catalog comparison, including the canonical migration history and absence of the new objects. Run the migration only against a compatible baseline. Shared QA V2 already has its separate feasibility history and tables.
2. Record a current managed Production database backup or recovery point. Restore to an approved private non-Production target and record the restore result, timestamp, target, and integrity checks in #430. Keep the restored database private with no user traffic or outgoing integrations. Attach no customer records or credentials to the issue.
3. Apply the migration on the isolated target first. Verify the three public RLS tables, no user access to the audit or switch, absence of grants issued by the migration, and a false database switch. With synthetic actors, repeat save/reload, isolation, denied writes, and billing isolation. Record exact commits for these checks and coordinate any QA V2 deployment in #426.
4. After release acceptance, schedule the approved Production schema apply with feasibility flags off. Keep `NEXT_PUBLIC_FEASIBILITY_STUDIES`, `NEXT_PUBLIC_FEASIBILITY_CLOUD_QA`, `FEASIBILITY_ORG_QA`, `NEXT_PUBLIC_FEASIBILITY_SHARING_QA`, `NEXT_PUBLIC_FEASIBILITY_BILLING_QA`, `FEASIBILITY_INVITATION_EMAIL_QA` and `NEXT_PUBLIC_FEASIBILITY_EMAIL_INVITES_QA` off. Confirm migration history, policies and the disabled database switch after apply.
5. Treat personal availability, organization availability, billing and sharing as explicit rollout decisions. A merge or migration does not issue a subscription, grant access or enable any flag.

## Rollback

A failed schema transaction rolls back before any release activation. For a post-apply application problem, disable feature exposure and keep the database switch off. Retain all studies, reviews and audit rows. Any schema removal or recovery that could discard data requires a separately reviewed recovery plan and a current snapshot first. Never roll back the shared environment to an earlier state as part of a rehearsal.
