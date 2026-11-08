# PR #360 — native settings and independent subscriptions

## Scope
The six attached Arabic references govern content layout: one settings navigation,
organization identity, independent legal/tax, finance, team, system preferences,
and a source-derived setup journey. Existing product topbar/sidebar stay in place.
Subscription & billing is now a separate `/[locale]/billing` workspace, with
Overview, Plans & upgrades, actual activation requests, and Billing identity.
No active payment checkout or fabricated subscription invoice has been added.

## Real integration
- Organization, legal and contact forms PATCH the existing organization record.
  The legal address remains separate from the VAT invoice seller address.
- The country is chosen by its localized name and validated against ISO codes.
- Fiscal calendar, chart, posting rules, banking, opening and users run as native
  components. No setup stage embeds another app page in an iframe.
- Successful chart/fiscal/posting/opening/identity changes refresh the independent
  server readiness check. A local review checkbox never authorizes accounting.
- Empty/ambiguous/inactive posting mappings retain their original validation,
  fiscal/version checks, source coverage and server approval permissions.
- Personal mode remains separate and does not acquire legal company requirements.
- Theme, account language/timezone/currency and existing notification preferences
  use `/api/settings`, with success displayed only after a confirmed save.
  Login/security policy is not modified by appearance settings.
- Every asynchronous billing load is generation- and cancellation-scoped. A late
  response from an old organization cannot replace the current tenant's state.

## Database deployment order
Apply existing pending PR migrations and the additive CLI-generated
`20261108145331_organization_settings_workspace.sql` on isolated QA before its
frontend. It adds only nullable profile fields to organizations. Existing RLS,
subscription guards, ledger sources, openings and currencies are not rewritten.
The canonical migration manifest includes the exact new SHA256/MD5. The new
schema-delta fingerprints are deterministic expectations; disposable PostgreSQL CI
must observe and validate them. They are not claimed as hosted QA observations.
No existing or previously applied migration was edited.

## Acceptance evidence
- Unit tests validate real ISO countries, profile normalization, contact format,
  date validity, existing financial mapping rules and organization navigation.
- Full-schema authenticated browser acceptance now asserts native forms,
  legal/contact save/readback, in-place VAT, source readiness, no duplicate shell,
  institutional bank scope, mobile overflow and organization isolation.
- Subscription acceptance follows separate billing navigation, real activation,
  VAT persistence, themes and read-only trials.
- Additional `Settings native UI acceptance` captures AR/EN desktop/mobile
  screenshots and save/reload flows with an explicitly LOCAL UI fixture. This
  fixture is not an authentication, PostgreSQL/RLS or financial certification.

## Release gates
Keep Draft. Latest-SHA CI and source-backed browser runs must pass, then compare
rendered screenshots with the attached references and perform hosted QA UAT.
The existing complete source snapshot/branch/consolidation/personal accounting
release gates remain. Country-specific tax engines outside Saudi Arabia and
online subscription collection are not represented as working features.
No Production migration, merge, domain change or deployment is authorized by this
implementation checkpoint.

## Hosted QA V2 checkpoint (2026-11-08)
The new nullable profile columns were applied only to `Yaqeen Financial Core QA V2`.
Read-only catalog inspection confirmed all eight columns and preserved organization
RLS. A rollback-only synthetic owner/outsider test passed owner save/readback and
cross-tenant SELECT/UPDATE denial. All fixture Auth/organization rows rolled back.
Production was not queried or changed for this checkpoint.


## Reference-layout corrections after visual review

The organization and legal forms no longer repeat links to sections already in the settings navigation. Subscription navigation lives in its separate workspace and contextual summary; the duplicate secondary navigation row is removed. The fiscal-year deep link now opens the same native financial workspace instead of the old shortcut panel.

Structure settings and the setup journey share a scoped native entity editor backed by the existing entities API. The entire organization directory is no longer mounted inside settings. Entity saves retain the selected organization, and aborted or stale reads cannot replace another organization's records.

Legal settings have separate identity, tax registration and e-invoicing sections. The invoice unit renders its original component; editing its tax number returns to the actual tax form. The financial overview preserves all active posting-account counts while grouping expense categories into the five main chart groups, and lists cash accounts from the scoped source register. Opening balances are never inferred from current bank balances.

System preferences display appearance, supported notification controls and read-only verified sign-in information in the reference card layout. No unsupported sign-in, two-factor or notification switches are represented as working controls. Saved role permissions are shown in a matrix; user overrides and approval policies still govern actual access.

The local UI fixture now checks eight settings/billing routes plus the setup journey in both languages at four viewport widths, native entity persistence, and pairwise control overlaps. These are UI checks, separate from genuine Auth/RLS and financial acceptance in the full-schema workflow. A passed browser suite is not a claim of pixel-identical hosted acceptance.

The unified fiscal workspace retains the unsaved-edit/busy guard for organization changes, section switches and returning to the overview. The disposable browser test dismisses and accepts the confirmation and checks that discarding a UI draft never writes a fiscal calendar.

Organization profile and legal forms submit only changed fields from their own section. The existing PATCH handler preserves the current saved name when it is omitted. Native UI and disposable API checks simulate concurrent edits in the other section and verify those records are retained.
