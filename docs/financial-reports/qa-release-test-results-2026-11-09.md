# QA release verification — 2026-11-09

Release: `be73783c8864e4fa6ae573766aff023117d06313`.
Stable QA: https://yaqeen-financial-core-v2-qa-oalhalabioa-9334.vercel.app
Production was not modified.

## Completed CI

Seven workflows passed: canonical migration history, asset integration, bilingual authentication, quality, settings native UI, financial reporting sources, subscription trials.

Opening workspace full-schema acceptance failed (run 42686384213):
- `production-full-schema-parity`: stale fingerprint of financial_reporting_events after the reviewed nonposting reschedule migration. Corrected locally in commit 70e4a64; read-only contract passes on hosted QA. This correction has not been pushed or rerun in CI.
- `opening-auth-browser`: approve-rules button remains disabled in verify-default-opening-posting-cycle.mjs:95. Root cause is not confirmed. Do not bypass the disabled button or weaken detailed-account validation. The full actual-cycle and downstream statement/export reconciliation are not certified.
- Institutional fiscal/chart compatibility and isolated asset/debt replay jobs passed.

Before the browser failure, actual tests passed for organization isolation, setup workspaces, opening persistence/approval/export, personal scope, expired-subscription read/write restrictions, funded borrowing/lending, permission revocation, concurrent annual close, fiscal-calendar editing, bank rename/activation/link preservation, source voucher navigation, and settings across Arabic/English desktop/mobile.

## Hosted QA database verification

Nine pending migrations applied successfully; 31 changed function definitions match reviewed local catalog fingerprints. Native account inheritance and 12 asset-lifecycle assertions passed with rollback.

Additional rollback tests passed in this session:
- qa-financial-production-normalized-parts.sql: input VAT partition sum, identities, classifications and direction.
- qa-financial-production-legacy-sources.sql: source amounts, sale carrying cost/proceeds, transfer differences, tampering refusal and tenant isolation.
- qa-financial-production-legacy-approved-opening.sql: no duplicate recognition of sources consumed by approved openings.
- qa-financial-production-legacy-rls-gap.sql: least-privilege allocation visibility, trusted attestation, tampered amount/quantity refusal and nonmember denial.

These SQL tests do not certify a signed-in hosted browser journey. Native debt reversal lineage remains an independent production merge blocker. Automatic depreciation calculation remains deferred.

No additional Vercel release was created during this testing session.
