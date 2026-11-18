# Trial and package access

## Approved behavior

| Account or organization | Read and export | Create and edit |
| --- | --- | --- |
| Existing or new active organization trial | Allowed | Active owner/admin |
| Expired organization trial | Allowed | Denied |
| Active subscription containing feasibility in its purchased snapshot | Allowed | Active owner/admin |
| Active subscription linked to an active plan that adds feasibility | Allowed for previous and new subscribers | Active owner/admin |
| Package excluding feasibility | Existing authorized legacy reads only | Denied |
| Suspended subscription or membership | Existing read policies apply | Denied |
| Unrelated organization or unauthenticated caller | Denied | Denied |

Adding feasibility to an active plan takes effect at the next authorization request for existing subscriptions linked to that plan. The purchased subscription snapshot remains authoritative for its contracted features. A current plan can supplement feasibility access. Prices, trial dates, periods, limits, revisions, plan snapshots and existing studies retain their stored values.

The original trial deadline determines write access. Expiry continues to preserve reading and export. A renewed personal trial cannot extend an institution's trial. Company write authorization comes from the selected organization's server capability and RLS, independently of an individual's personal feasibility grant.

A user without personal access can select institutional scope through the main banner. Personal scope continues to show its own enrollment or read-only state. Existing explicit platform-admin personal restrictions retain their precedence in personal authorization.

## Verification

The isolated PostgreSQL test uses synthetic accounts and the installed subscription state resolver. It verifies existing and newly created trials, original expiry, an active-plan addition for previous and new subscriptions, purchased custom bundles, excluded plans, legacy accounts, suspended membership, viewer and outsider denial, read-only expiry and unchanged subscription records.

Run the following commands with the existing local dependencies.

```bash
npm run check
FEASIBILITY_PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/feasibility/trial-plan-entitlements.mjs
node tests/migration-history/verify-files.mjs
```

The subscription acceptance workflow also exercises the real disposable Auth, API and browser paths. An authorized corporate owner can create through an active trial. Personal and institutional portfolios retain separate ownership.

## Rollout

Migration `20261118174233_feasibility_trial_and_plan_entitlements.sql` replaces three resolver functions. It performs no customer-row updates. Earlier migration files remain intact.

QA V2 requires its existing compatibility workspace RPC, the new migration and the matching application candidate. Production institutional rollout remains subject to the separate release approval and feature gates. Neither the migration nor a passing CI result activates a disabled production feature gate.

## Approved production release

User approval was received on 18 November 2026 after the QA V2 trial and package results at `efe840d0d4b7491ed57794c1e0e41f9e64a491b6`. The release integrates main `d4c12a1dcaed74ee5ed78d0d03a52679094ad0b9` and retains the implementation ancestry of PR #437 within PR #438.

The integrated source passed TypeScript and 1,987 repository tests, with one existing skip. The release candidate requires exact-commit CI and the coordinated production merge through #426.

Production preflight confirmed that the foundation and self-service migrations are already installed. Apply only the subsequent organization sharing, sharing permissions, share proposals, share audit, evidence documents and trial/plan resolver migrations in canonical order. Verify stored-data hashes and canonical migration versions before activating institutional trial/package access.

The rollout covers the two general templates, institutional portfolios and the approved trial/package behavior. External invitation and sharing rollout gates retain their separate release controls. Visual differences remain recorded in `royal-design-parity.md`.
