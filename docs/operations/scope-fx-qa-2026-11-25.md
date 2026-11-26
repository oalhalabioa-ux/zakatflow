# Scope and personal FX — integrated QA review, 25 November 2026

## Candidate and evidence boundaries

This record covers the authenticated hosted review of integration PR [#525](https://github.com/oalhalabioa-ux/zakatflow/pull/525), combining scope corrections #523 and personal FX #522. It supplements the [65-route capability audit](scope-capability-audit-2026-11-25.md).

| Item | Reviewed value |
| --- | --- |
| Branch | `integration/scope-fx-qa-20261125` |
| Hosted candidate | `c712dd65b89ee75af3cd1eb7e4bca4e56393a819` |
| Candidate tree | `d8a6fb33cc4e9ee690e0b53c73c3ebd6917d6aa0` |
| CI execution merge | `baf8828727e91f4119f95b57e3a18ca46f2417e9`, verified identical tree |
| Vercel deployment | `dpl_8oWxvXAr4JgZVtnFWicUz5AAJCM3`, READY, Preview |
| Stable QA address | <https://yaqeen-financial-core-v2-qa-oalhalabioa-9334.vercel.app> |
| QA database | `ubotbpjngtfvolthpfec` |
| Coordination | [Claim](https://github.com/oalhalabioa-ux/zakatflow/issues/426#issuecomment-7169687520), [hosted progress](https://github.com/oalhalabioa-ux/zakatflow/issues/426#issuecomment-7170470870), [result and release](https://github.com/oalhalabioa-ux/zakatflow/issues/426#issuecomment-7170905522) |

The first hosted candidate exposed two incomplete entry states when a company has no fiscal calendar. Follow-up source review found a separate pre-existing e-invoice FX defect and reproduced it locally. Consequently this record does **not** approve c712 for Production. Follow-up corrections and their exact checked/deployed revision must be recorded in #525 before a release decision.

No main merge, Production deployment or Production database change was performed in this integration phase. The older original scope audit has its own documented Production snapshot incident; this narrower statement does not rewrite that history.

## Completed candidate CI

All ten workflows passed on the candidate's exact tree:

| Gate | Run | Result |
| --- | --- | --- |
| Quality | [45663474787](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474787) | 2,903 tests passed, 45 skipped; typecheck, build and policy passed |
| Assets integration | [45663474624](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474624) | Passed; its repeated unit suite is not an additional 2,903 unique tests |
| Canonical migration history | [45663474969](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474969) | 305 migrations on a fresh disposable database, schema comparison and financial authorization checks passed |
| Workspace scope | [45663474758](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474758) | 98/98; zero page errors; six genuine FX integration cases and two separately labelled mocked save races |
| Subscription trials | [45663474875](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474875) | 34/34; 188 Elegant + 188 Modern route visits nested inside these checks |
| Opening full schema | [45663474836](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474836) | All four jobs passed; live script includes 58 SQL/Auth/API/browser checks |
| Reporting sources | [45663475020](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663475020) | 32 genuine checks and 22 separately identified preview/reference checks |
| Feasibility | [45663474693](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474693) | Passed |
| Settings native UI | [45663475175](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663475175) | Passed with synthetic API/auth UI fixtures; not a hosted persistence or permission proof |
| Loan table | [45663475044](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663475044) | Passed |

[Scope evidence artifact](https://github.com/oalhalabioa-ux/zakatflow/actions/runs/45663474758/artifacts/15047071080), SHA-256 `b414f0581d5f84fbb67f077990d93dd39c49c606340cf9f1feb3c1ba22483a6b`.

## Actual QA migration and isolation proof

Applied only canonical `20261125165000_personal_fx_rates.sql`, SHA-256 `612a5eac3887598035183c33a801502735a2ade5df9231da384b1f8dfe288ce3`, to QA V2. The provider assigned remote migration ledger version **`20261125173719`**, name `personal_fx_rates`; the local filename timestamp was not substituted for that remote version.

Post-application verification confirmed:

- RLS enabled; the three SELECT/INSERT/UPDATE policies bind ownership to `auth.uid()`.
- Authenticated users have SELECT/INSERT/UPDATE but not DELETE; anon has no SELECT.
- The opening command's entire definition equals the captured original with exactly the two reviewed source/order substitutions. Original MD5 `2ff58322dc139f12f8a3916c18b7ce68`; resulting MD5 `3aa9f41314ff3f8f602d221956aa0e33`.
- No new security-advisor finding for the personal FX table.

A single fail-fast SQL transaction on QA simulated the authenticated role and two existing synthetic QA profile claims. It checked owner save/retry/read, inverse quote, foreign read/update denial, forged-owner insertion denial, ownership reassignment denial and isolation in the reverse direction. The actual result was PASS and `rollback_left_no_probe_rows=true` after ROLLBACK. **This is a role/claim RLS proof, not live authentication or browser persistence.** No Auth/profile/company/asset records were created by that proof.

## Authenticated hosted FX and navigation

Secure browser authentication succeeded with an existing QA account. New-account creation was not used: automatic approval review had rejected entering synthetic account credentials through a model-visible browser. No credentials were extracted, logged or copied into a runner.

One identifiable personal QA fixture was used:

| Field | Final value |
| --- | --- |
| Source | `QA523-522-C712-CUA-20261125-P` |
| ID | `983831fc-3fd5-4bce-928a-4d77fd5dede8` |
| Pair | SAR → USD |
| Rate | 0.25 |
| Date | 2099-12-31 |

Observed checks:

1. Actual UI save and reload succeeded. Repeated UI save updated the same row to 0.25; database readback confirmed one row with the same ID.
2. The dated asset quote returned rate **4** and the exact personal quote row for USD → SAR on 2099-12-31.
3. The current-date quote remained at its pre-test `ASSET_SAVED_FX_RATE_MISSING` result after fixture correction; the future quote was excluded.
4. Personal → QA company A → QA company B → Personal hid the personal marker in both company views and restored it in Personal. Those company FX tables were empty; this does not prove hosted company-rate persistence.
5. An explicit unavailable company retained its requested URL, left the company selector blank, displayed the unavailable-company message and disabled FX save. It did not substitute a remembered company.
6. A direct company-A URL overrode prior company B. Native browser Back and Forward restored the correct company and URL.
7. Arabic and English Prices pages displayed the private personal row, and the Personal URL omitted company parameters.

The initial CUA date fill changed the displayed DOM value without retaining it through the form's next React render; the first saved fixture therefore carried the current date. Root moved **only that exact newly created QA fixture** to the intended future date, then used native ArrowUp/ArrowDown/Tab events, forced another form render, and verified the subsequent genuine UI upsert/reload at 2099-12-31. This is recorded as a test-input correction, not a demonstrated application date-input defect. No current-date probe row remains. The marked future fixture is retained for reproducibility.

No company prices, asset entries, invoices, transactions, balances or approvals were deliberately saved during this hosted smoke review. Company save/reload and separate outsider authentication remain supported by isolated CI rather than being claimed as additional hosted checks.

## Hosted entry matrix

The Arabic sidebar supplied **27 Personal targets and 42 Organization targets**. All 69 retained the requested scope. These are entry visits, not 69 complete financial workflows. Main content and selected-company controls were checked after hydration; custom feasibility selection and organization-catalog detail selection were inspected explicitly. Primary loaded-state markers were also checked for dashboards, assets, investments, cash, personal financial position, assessments, payments, personal reports and team settings.

`Opened` means that the requested page rendered in its proper scope. It does not mean every tab, role, calculation, export or write was exercised. Explicitly inactive and failed states remain separate below.

| Route (locale prefix omitted) | Personal | Organization |
| --- | --- | --- |
| `dashboard` | Opened | Opened |
| `assets/dashboard` | Opened | Opened |
| `assets` | Opened | Opened |
| `cash-and-banks` | Opened | Opened |
| `investments` | Opened | Opened |
| `transactions` | Opened | Opened |
| `lots` | Opened | Opened |
| `assessments` | Personal register/manual views | Institutional manual assessment |
| `payments` | Personal payment register | Institutional payment register |
| `financial-position` | Personal summary | Company summary |
| `reports` | Personal operational reports | Company operational reports |
| `workflow` | Explicitly inactive | Explicitly inactive |
| `debts` | Opened | Opened |
| `receivables` | Opened | Opened |
| `payables` | Opened | Opened |
| `loans` | Personal contracts | Company contracts |
| `employee-advances` | Company-only by plan | Opened |
| `debt-advances` | Opened | Opened |
| `debt-collection` | Opened | Opened |
| `debt-report` | Opened | Opened |
| `financial-reports` | Loaded personal sources; no source error | Failed prerequisite display without fiscal year; loaded real source hub in configured company |
| `feasibility` | Personal portfolio loaded | Company portfolio loaded; QA438 study remained in company context |
| `prices` | Save/reload/isolation checked | Scope selection, personal exclusion and unavailable-company denial checked |
| `notifications` | Opened | Opened |
| `guide` | Opened | Opened |
| `settings/personal-setup` | Opened | Personal setup is not an institutional workflow |
| `settings/system` | Opened | Opened; shared preferences intentionally omit company parameters |
| `account` | Opened | Opened; same account identity/preferences by design |
| `vat?section=dashboard` | Company-only by plan | Opened |
| `vat?section=invoices` | Company-only by plan | Opened |
| `liquidity?tab=overview` | Personal cash uses `cash-and-banks` | Opened |
| `budget-planning?tab=dashboard` | Company-only by plan | Opened with selected company |
| `opening-balances` | Separate personal asset openings | Failed empty-state without fiscal year; full workspace loaded in configured company |
| `chart-of-accounts` | Personal simplified reporting model | Opened |
| `financial-reporting-policy` | Company-only posting setup | Opened |
| `organizations` | Explicit switch to institutional catalog | Catalog and selected company detail opened |
| `users` | Company-only administration | Opened |
| `settings/financial/setup` | Personal setup above | Opened |
| `settings` | Account preferences above | Selected-company form loaded |
| `settings/regulatory` | Company-only configuration | Opened |
| `settings/financial` | Company-only configuration | Opened |
| `settings/team` | Company-only administration | Access summary loaded |
| `billing` | Account/feature entitlements as planned | Selected-company trial/subscription view loaded |

No arbitrary fixture company or fiscal year was created to turn a blocked entry into a pass. The configured-company positive control was an already authorized QA company with a saved 2026 fiscal calendar. Its reports rendered `.fs-source-hub[data-statement-ready="overview"]` with no source error; its opening workspace truthfully displayed 19 unconfirmed balances and an unsaved draft. No Save/Approve action was clicked.

## Follow-up defects and bounded corrections

### E-invoice historical FX default

The e-invoice component independently selected the first direct/inverse FX row, including future quotes, and did not recompute its default when the invoice date changed. Both its accounting and e-invoice save requests used that value. The defect predates #522/#523.

An actual local Next/Chromium form reproduced **4.25 selected instead of the eligible 3.75**. The bounded fix uses the existing date-aware VAT resolver, exposes the selected quote metadata for the hint, and preserves deliberate manual rates and rates attached to saved drafts/accounting/original-invoice sources. No backend policy, migration or posting logic is changed.

Local commit `7f50e888c556df08d8fb0f328b0e7c8a7aa86bac`: 7/7 browser cases, 14/14 focused unit cases, typecheck and independent review passed. Browser responses are synthetic and both save endpoints are asserted; this evidence is not described as database persistence. The test is wired as a separately labelled workspace-scope CI step.

### Corporate reports and opening balances without a fiscal year

Read-only live context returned authorized companies with empty fiscal-start/end values. The report effect returned without fetching statements, while the UI offered no prerequisite explanation. The opening component similarly returned before fetching a workspace and rendered an empty main.

The implemented correction shows clear bilingual prerequisites and a link scoped to the authorized selected company's fiscal-year settings, keeps exports disabled, distinguishes user-cleared dates from missing setup, and renders truthful context loading. The opening workspace hides the previous company's data immediately when its embedded context changes, including while the new context is pending or fails. It does not invent dates, fabricate zero statements, create a fiscal calendar, change permissions or alter financial RPC behavior.

Local commit `3efe7488bd831fad2386012fef6e4622814e0c43`, integrated after the FX correction as `d5aacb232be32bb612d50804b2e5afa376d2b53f`: 8/8 actual-component Chromium cases, 31 focused unit cases, typecheck and independent review passed. The browser cases use mocked GET responses and recorded zero page errors, write requests or unexpected reads. They cover missing-period companies, configured-company recovery, clearing dates during a pending request, source/context errors and retry, delayed embedded context, and explicit-date validation. Baseline tests reproduced both missing prerequisite messages on c712. This is local component evidence, not a hosted database or Auth claim; its CI step is separate from genuine acceptance.

## Release and remaining boundaries

The first QA slot was released after the hosted findings were recorded. The stable hostname and separate feasibility alias were preserved, as were feature flags and authentication protection. Work02/03 changes remain excluded. The c712 acceptance does not certify compatibility with a later combination of those branches; any such integration needs its own exact-revision validation.

A follow-up QA deployment is justified only for the new validated revision that addresses these observed defects, after its successful CI and a fresh coordination check in #426. Do not describe local changes or successful CI as a live deployment.

The complete route inventory does not imply every planned feature is implemented. Personal financial reports remain labelled estimates from personal registers; institutional VAT, employee administration, budgets and posting setup keep their intended institutional scope. The generic workflow is deliberately inactive. Production release remains a separate approval under AGENTS.md.
