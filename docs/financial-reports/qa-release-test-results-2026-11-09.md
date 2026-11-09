# QA release verification — 2026-11-09

## Follow-up on commit 446ae9f31734085399ff29ba916e490cd34da3c4

Full-schema acceptance run 42688866874 now PASSES all four jobs, including the native browser cycle, ledger/export reconciliation and general fiscal close reconciliation. The disabled approval button was caused by missing 1590 and 6200 subsidiary accounts in the test organization after lifecycle templates were added. The fixture now includes both; production validation was not weakened. A unit regression confirms that missing lifecycle leaves block complete-policy readiness and valid leaves satisfy it (16 default-rule tests passed).

The corrected parity fingerprint also passes in the disposable full-schema CI. Application code and deployed QA release remain unchanged; only tests/evidence were pushed. The automatically triggered unrelated Vercel preview was canceled; the stable QA alias was not moved.

Native reversal remains unresolved, independently of these passing suites. New rollback tests qa-native-debt-reversal-blocker.sql and qa-native-lending-reversal-blocker.sql execute actual create/approve/post/prepare-reverse/approve/post commands with SET CONSTRAINTS ALL IMMEDIATE. Both reproduce rejection and verify unchanged bank balance, original ACTUAL event, reversal COMMITTED event and PENDING request after the failed post. Immediate constraints are essential: rollback-only tests without them can miss deferred posting failures and falsely appear successful. These are negative blocker tests, not reversal certification; they are committed locally, not yet pushed.

The earlier results below describe the previous run and are retained as history.

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


## Native reversal repair follow-up

The earlier native borrowing/lending reversal blocker is now fixed in QA V2 by
`20261109201129_native_debt_reversal_components.sql`. No Production change.

- Native borrowing and lending commands passed against QA with all deferred constraints immediate. Both restored the bank, reused original detailed account resolutions, normalized a later reporting window and replayed without duplicate cash. All fixtures rolled back.
- Each original raw line produces a distinct persisted reversal line. Original line identity, amount, currency, exchange rate, direction, recovery and metadata are checked. Aggregate posting permission uses all lines.
- Isolated PostgreSQL/WASM tests passed multipart preparation, exact account resolution, tampered amount refusal and aggregate amount permission refusal. These use fixture persistence adapters and are not a full financing workflow certificate.
- RLS lineage suite: 22 passed, including both reversal cash directions and wrong line/amount/role rejection. TypeScript passed.
- Latest application preview still requires the matching lineage observer update. Do not describe the current preview as containing this repair until deployment is verified.
- Full CI on the new commit and broader native advance/financing reversal acceptance remain pending. Earlier successful CI covered the preceding commit.


### Extended native acceptance on QA V2
- `qa-native-finance-reversal.sql`: actual financed contract, recognized charge, two-line installment settlement, later native reversal and replay passed. Bank restored to 2,200; outstanding principal restored to 400 and finance charge to 12.4. Immediate capture verified two resolved reversal components. Entire transaction rolled back.
- `qa-native-advance-reversal.sql`: both supplier/customer advances, partial refund and refund reversal, partial noncash applications, overapplication refusal, application reversal and replay passed under detailed policies. Bank unchanged by applications/reversal; advance/invoice balances restored to 40/90 after reversing the last 40. All generated records rolled back.
- Source permission refusal passed in native borrowing/lending fixtures using an unrelated identity.
- Application fix pushed to PR branch as `fe93f6acf4bc6b6273cdeadff01e60f03656015a`; source tree matches local `81e610f`. Extended SQL fixtures in this follow-up are additional evidence and do not change application code.


The first repair CI passed canonical migration history, quality, settings UI,
full-schema parity, native reversal SQL and institutional compatibility. Its final
default-cycle browser check exposed a nondeterministic fixture selector: selecting
the first OPEX by type could select an inherited child rather than canonical OPEX.
The fixture now selects the exact canonical code and retains all accounting
assertions. Extended financing/advance rollback checks are included in CI.


## Final QA release verification — 2026-11-09

- Remote commit: `161ff57a6143ee7fac13221e21a4b6a61d472e77` (local equivalent `e5d4e70`, tree `e3275925cb21eab68f284632e54b352af5ec42b8`).
- All eight GitHub workflows passed: full-schema opening cycle, canonical migrations, quality, native settings UI, asset integration, authentication, financial reporting sources, subscription trials.
- Full-schema run `42693159097`: all four jobs passed, including native borrowing/lending/finance/advance SQL, complete browser cycle, report/export reconciliation and fiscal close reconciliation.
- QA deployment `dpl_8LGTiRGTjhZRe1zRRPdfbYvTbtQ4` READY; target preview, QA project only.
- Existing stable alias assigned to this deployment: https://yaqeen-financial-core-v2-qa-oalhalabioa-9334.vercel.app . Arabic login returned HTTP 200 after assignment.
- Native accounting acceptance ran with immediate constraints and rolled back all synthetic data. Browser acceptance ran against disposable CI databases; post-deploy smoke confirms reachability, not another authenticated accounting run on the hosted preview.
- Production, main and Hostinger unchanged. No production merge was performed.
