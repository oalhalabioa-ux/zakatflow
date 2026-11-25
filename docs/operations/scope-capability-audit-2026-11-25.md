# Personal and institutional scope — capability inventory

Audit date: 25 November 2026. Baseline: `222e7537c386dc1f4e04819bff7aefe60445f6fd`.

This inventory covers **all 65 localized page routes** present at the baseline, including detail routes and aliases. It records implemented applicability, data sources, deliberate feature gates and concrete defects. **Static inspection is not a passing browser, authorization, financial reconciliation or persistence test.** Candidate verification must be recorded separately with its exact SHA.

## Contract and applicable features

The banner is the only source of personal/institutional selection and organization, company/group, branch and center selection. A module must not silently change that selection, reuse the previous selection's data, or let a form choose a different owner. A global account-preferences page can be used from either scope without turning personal preferences into company configuration.

The two scopes intentionally differ. `components/settings/PersonalSetupPanel.tsx` expressly defines a simplified personal journey without company registration, institutional VAT or company invitations. `docs/financial-reports/personal-scope.md` defines personal estimated position and cash movements, with a read-only derived classification; it does not promise a second corporate chart, certified personal income statement or IAS 7 cash-flow statement. Corporate-only accounting and tax screens should be identified as such, rather than opened with personal data under an institutional heading.

### Applicability legend

- **Both:** independently implemented personal and institutional paths; each requires runtime isolation acceptance.
- **Personal:** personal owner records only; cannot be shown as the selected company's records.
- **Institution:** company permissions and a valid selected institution are required. Personal users use the identified personal equivalent where one exists.
- **Account:** account/global information; not company-owned records.
- **Gated:** intentionally restricted by rollout/QA flags or permission. A gate is not itself evidence of a regression.
- **Legacy/demo:** incomplete or superseded entry point; not evidence of a working production feature.

## Complete route inventory

Routes below are relative to `/{locale}/`, for both `ar` and `en`. The entry source of each row is `app/[locale]/<route>/page.tsx`; named components and services identify its principal implementation. “Review” is the baseline static finding, not a runtime pass.

| # | Route | Applicability | Principal source / gate | Review |
| --- | --- | --- | --- | --- |
| 1 | `account` | Account | `/api/settings`, authenticated profile | Account preferences; must preserve banner selection. |
| 2 | `admin` | Owner administration alias | Redirects to `/admin?lang=...` | Owner authorization is independent of personal/company switch. |
| 3 | `assessments` | Both | Personal register assessment; `ManualZakatAssessment` for institution | Institutional register calculation is deliberately unavailable; company manual workflow is separate. |
| 4 | `assessments/[id]` | Personal record detail | `/api/assessments/[id]`, confirmation endpoint | Needs explicit record-owner context and error-state acceptance; URL helper treats detail as unscoped. |
| 5 | `assets` | Both | `/api/assets`, catalog, source operations | Scope-aware register; test new/edit/sale/disposal and retained dialog state on switches. |
| 6 | `assets/dashboard` | Both | `AssetsDashboardWorkspace`; personal dashboard vs corporate financial register | Distinct readers exist. Company selection initially reads remembered company; test explicit URL and switch synchronization. |
| 7 | `billing` | Institution | `SubscriptionBillingWorkspace`, organization subscription APIs | Baseline duplicates organization picker inside content. Personal feasibility entitlement is a separate flow. |
| 8 | `budget-planning` | Institution | `BudgetPlanningWorkspace`, budget-plan APIs | **Defect B1:** personal Zakat dashboard feeds company budget projection. Six tabs. |
| 9 | `cash-and-banks` | Both | `FinancialRegisterWorkspace(view='cash')` | Personal cash and company cash use independent source branches. Personal alternative to corporate liquidity management. |
| 10 | `cash-vouchers/[id]` | Institution record detail | `financialEventSourceDetail(organization,id)` | Requires valid company and voucher access; must preserve company on return. |
| 11 | `chart-of-accounts` | Institution / gated | `FINANCIAL_OPENING_WORKSPACE`, financial chart service | Personal report classification is not this editable corporate chart. Work 02 owns chart templates. |
| 12 | `dashboard` | Both | `getDashboard` vs `getPlatformFinancialOverview` | **Defect N4:** new users without a company are redirected to company onboarding before personal scope is evaluated. |
| 13 | `dashboard/report` | Personal | `getDashboard`, metric-specific personal assets | Personal-only source; not an institutional dashboard drilldown. |
| 14 | `debt-advances` | Both | `FinancingScopeWorkspace(kind='ADVANCE')` | Personal financing vs corporate advances; no copying across owners. |
| 15 | `debt-collection` | Both | `DebtCollectionWorkspace`, scoped collection API | Personal hides payroll; corporation adds payroll/employee follow-up. |
| 16 | `debt-openings` | Institution | `LoansWorkspace(productMode='OPENING')` | Company opening debt vouchers; personal openings live in personal registers/contracts. |
| 17 | `debt-report` | Both | `FinancialRegisterWorkspace(view='debt-report')` | Scope-bearing API request; check owner, company, group and export. |
| 18 | `debts` | Both | `DebtFinanceOverview`, scoped overview API | Existing request versioning clears previous source data. Runtime race acceptance still required. |
| 19 | `employee-advances` | Institution | `LoansWorkspace(productMode='EMPLOYEE_ADVANCE')` | Correctly institution-specific; baseline sidebar exposes it under personal. |
| 20 | `enterprise` | Legacy/demo | `/api/consolidation`, legacy assessment reader | Corporate title but account-wide legacy assessments; no selected institution. Do not certify as current corporate consolidation. |
| 21 | `feasibility` | Both / gated | Feasibility grant + organization entitlement, rollout flags | Separate personal and company portfolios; self-enrollment and read-only expiry are intentional. |
| 22 | `feasibility/shared` | Institution / gated | `FEASIBILITY_ORG_SHARING`, `FEASIBILITY_ORG_QA`, authenticated inbox | Disabled sharing must remain disabled until separately approved; not a page-opening defect. |
| 23 | `feasibility/shared/review` | Institution / gated | Same flags; validated revision/proposal IDs | Review only for authorized owning organization and proposal. |
| 24 | `financial-events` | Institution / QA only | `assertFinancialBudgetQA`, pinned QA project | Deliberately unavailable on Production; operation sources use existing supported modules. |
| 25 | `financial-position` | Both | `FinancialRegisterWorkspace(view='position')` | **Defect N1:** main sidebar explicitly forces `scope=ORGANIZATION`. |
| 26 | `financial-reporting-policy` | Institution / gated | `assertLiveStatements`, policy RPC permissions | Corporate posting rules; no separate personal posting engine. Work 02 owns contract. |
| 27 | `financial-reports` | Both | `PersonalFinancialStatements` vs `FinancialStatementSource` | **Defect N2:** generic WorkspaceLink forces this route to institution. Personal route itself exists before corporate gate. |
| 28 | `governance` | Account / information | Static governance content | No transactional company/personal data. |
| 29 | `guide` | Account / information | Static guide content | Scope should not silently change while reading help. |
| 30 | `investments` | Both | `InvestmentWorkspace`, investment + personal/corporate participation APIs | **Defect F1:** form independently edits ownership and institution despite banner. |
| 31 | `invoice-register` | Institution alias | Redirects to `vat?section=unified` | Baseline redirect drops explicit organization/query context; preserve selected institution. |
| 32 | `liquidity` | Institution | `LiquidityWorkspace`, organization cash/flow APIs | Seven tabs; personal cash is `cash-and-banks`. Requires company selection, no personal fallback. |
| 33 | `loans` | Both | `FinancingScopeWorkspace(kind='LOAN')` | Personal contracts vs corporate financing are separate implementations. |
| 34 | `login` | Authentication | Supabase auth UI, configured login providers | No financial scope; must preserve approved Production Google-login policy. |
| 35 | `login/invitation` | Authentication / institution invitation | Invitation verification and acceptance | Validated invitation target, not remembered institution, is authoritative for acceptance. |
| 36 | `lots` | Both asset-filtered | `/api/lots`, asset organization filtering | Baseline owner-only service filter omits colleague-created corporate lots despite existing `assets.view` RLS; restore read parity without granting new permissions. |
| 37 | `lots/[id]` | Authorized asset record detail | `/api/lots/[id]` | Baseline detail helper defaults personal, back link loses explicit scope; needs record context and handled API errors. |
| 38 | `notifications` | Account, some company-targeted events | Notifications API and feasibility proposal links | Access is recipient-based; opening a notification must preserve/validate its intended company. |
| 39 | `onboarding` | Institution enrollment | `OrganizationOnboarding`, verified user | Must not be a mandatory prerequisite for personal assets/reports. |
| 40 | `opening-balances` | Institution / gated | `assertOpeningWorkspace`, `financial_opening_workspace` | Corporate accounting opening workspaces; personal balances use original personal registers. |
| 41 | `opening-balances/branches` | Institution / gated | Same gate, branch distribution | Requires company and fiscal start; branch allocation must not become personal data. |
| 42 | `opening-balances/centers` | Institution / gated | Opening gate + `FINANCIAL_CENTER_OPENINGS_ENABLED` | Deliberate additional gate; do not relax to open page. |
| 43 | `organizations` | Institution management | Organization and entity APIs | User's authorized organizations; not personal account balances. |
| 44 | `payables` | Both | `FinancialRegisterWorkspace`, personal payables vs company liabilities | Default is institution unless explicit personal; navigation must carry explicit scope. |
| 45 | `payments` | Both | `PersonalPayments` vs `CorporateZakatPayments` | Personal Zakat cash deduction vs corporate assessment liabilities/liquidity settlement. |
| 46 | `preview/fiscal-years` | Institution / preview only | `VERCEL_ENV=preview`, `FISCAL_YEAR_REVIEW_PREVIEW` | Design/QA route, not a missing Production feature. |
| 47 | `prices` | Both intended, baseline inconsistent | Commodity prices + institution FX administration | **Defect C1:** classified personal by banner while FX requires institution. Dedicated currency branch owns repair. |
| 48 | `qard-loans` | Institution alias | Redirect to `loans?scope=ORGANIZATION&product=QARD` | Institutional Qard alias is deliberate; personal contracts are at personal loans. |
| 49 | `receivables` | Both | `FinancialRegisterWorkspace(view='debts')` | Independent personal and company branches. |
| 50 | `reports` | Both main asset grid; legacy export mismatch | `AssetFinancialReports`, `/api/reports` CSV cards | **Defect E1:** CSV cards omit scope and organization; non-asset CSV API branches are account-wide. |
| 51 | `reports/print` | Personal | Profile, personal assessment/payment tables | **Defect E2:** universally exposed printable report opens personal data from institutional reports. |
| 52 | `settings` | Institution | `OrganizationDetailsWorkspace` | Company identity, with selected company/permission. Personal profile belongs to account. |
| 53 | `settings/financial` | Institution | `FinancialSettingsWorkspace` | Company accounting/fiscal configuration. |
| 54 | `settings/financial/fiscal-years` | Institution | Same workspace, fiscal years panel | Fiscal status, retained earnings and close are institution-specific. |
| 55 | `settings/financial/setup` | Institution | `FinancialSetupWizard` | Baseline personal sidebar also links here, despite separate personal setup route. |
| 56 | `settings/personal-setup` | Personal | `PersonalSetupPanel`, authenticated user | Separate simplified personal journey exists; parent SettingsFrame incorrectly labels it company setup. |
| 57 | `settings/regulatory` | Institution | `RegulatorySettingsWorkspace` | Legal/tax company settings; not applicable to personal register. |
| 58 | `settings/structure` | Institution | `OrganizationStructureWorkspace` | Company, branch, center configuration. |
| 59 | `settings/system` | Account | `GeneralSystemPreferences`, user profile/settings API | **Defect N3:** account preference page is forcibly classified institution. |
| 60 | `settings/team` | Institution | `TeamAccessWorkspace` | Company members/roles and permission checks. |
| 61 | `transactions` | Both | Asset operations + asset-owner filter | Scope filter exists; reset edit/create state on switch and test save target. |
| 62 | `transactions/[id]` | Authorized operation detail | `AssetOperationDetails`, operation reader | Topbar classifier omits dynamic route; verify record's owner/company and return context. |
| 63 | `users` | Institution | `TeamAccessWorkspace` alias | Not separate personal team management. |
| 64 | `vat` | Institution | Company VAT profile/documents/e-invoice APIs | Six main sections; VAT, invoices and ZATCA require selected institution and permissions. |
| 65 | `workflow` | Legacy/demo | Local React state, hardcoded assessment | **Defect W1:** demonstration falsely appears operational; no persisted review, payment or audit transitions. |

## Embedded modules and source boundaries

| Module | Personal implementation | Institutional implementation | Expected acceptance |
| --- | --- | --- | --- |
| Dashboard | Owner assets, personal Zakat and cash sources | Selected company's overview and authorized group | Personal → A → B → personal; reload, direct URL and history agree. |
| Assets / operations / lots | Owner assets and personal sale/proceeds/FIFO | Corporate source events, approval, sale/disposal/depreciation | New form and existing details cannot remain bound to prior scope. |
| Zakat | Register/manual personal assessment, finalization and payments | Separate manual assessment/approval/liability and corporate cash settlement | No personal assessment/payment reused as corporate amount. |
| Cash and debts | Personal bank/cash, payables, receivables, contracts, transfers | Corporate cash, obligations, financing, employees and counterparties | Same source totals as authoritative registers; no duplicate source rows. |
| Liquidity | Use personal cash/register; corporate calendar/scenarios not promised here | Overview, position, calendar, forecast, scenarios, transfers, counterparties | Seven tabs; company/group changes update all data and prevent stale saves. |
| Budget | No separate personal budget product evidenced in current plan | Dashboard, monthly, five-year, variance, forecast, cash flow | Six tabs; corporate Zakat source only, explicit/manual forecasts. |
| Tax / invoicing | Institutional VAT explicitly not applicable to personal setup | Dashboard, aggregate, invoices, unified, reports, e-invoicing | Six sections; selected company's profile and source documents. |
| Feasibility | Own grant/portfolio, local legacy drafts and cloud opt-in | Company-owned portfolio plus separately enabled/accepted shares | Owner-specific data and attachments; no hidden ownership transfer; feature flags respected. |
| Financial reports | Estimated current position, classified register, cash movements and per-currency export | Six statements panels plus openings/chart/posting rules; Work 03 adds period ledger/Trial Balance in separate PRs | Current implemented outputs reconciled to their existing source; missing recognition models remain explicitly incomplete. |
| Settings | Personal setup, account/profile preferences | Organization, regulatory, financial, team, system preferences, billing | Account-wide preferences preserve scope; institutional selectors live only in banner. |

## Baseline defects with evidence and ownership

| ID | Severity | Evidence in baseline | Required correction / owner |
| --- | --- | --- | --- |
| N1 | High | `components/CorporateShell.tsx` asset sidebar sets `financial-position?scope=ORGANIZATION` | Preserve banner scope. Central navigation work. |
| N2 | High | `components/WorkspaceLink.tsx` forces all financial-reporting paths to organization; personal financial hub itself is implemented | Preserve personal hub, carry organization/group only when institutional; keep legitimate corporate-only routes explicit. Central navigation, coordinate Work 03. |
| N3 | Medium | `lib/topbar-navigation.ts` forces all settings to institution except personal-setup; account/global pages fall back to personal | Correct applicability; system preferences are account-owned. Personal setup headings/links must match its scope. |
| N4 | High | `app/[locale]/dashboard/page.tsx:34–36` checks onboarding before scope; `20261030150759_organization_trial_entitlements.sql:317–322` marks verified new accounts with no organization membership | Personal dashboard must not require company enrollment. Keep institutional onboarding required where applicable. |
| C1 | High | `prices` absent from scoped paths; `app/[locale]/prices/page.tsx` FX editing requires organization | Separate currency/session branch owns page/API contract. Integrate only reviewed version and test same-account separation. |
| E1 | High | `app/[locale]/reports/page.tsx` calls `/api/reports?type=...`; `app/api/reports/route.ts` non-asset exports filter only by user | Send and validate scope; use matching authorized module sources or explicitly restrict legacy export to personal. Never relabel mixed or personal data as company export. |
| E2 | High | `/reports/print` ignores scope and selects user Zakat tables; report page links it in both scopes | Personal-specific link/guard or genuine scoped corporate report; no company-title alias for personal output. |
| B1 | High | `components/BudgetPlanningWorkspace.tsx:118–119` loads personal `/api/dashboard`, copies its Zakat due/date into selected company plan assumptions and ZAKAT lines | Remove personal baseline from corporate budget; use authorized corporate assessment source, preserve explicit manual estimate. No historical plan mutation without separate reconciliation. |
| F1 | High | `components/InvestmentWorkspace.tsx:160–161` form edits ownership and institution independently | Fix owner/company to banner at form creation, validate again before save, dismiss stale form on scope/company change. |
| W1 | Medium | `/workflow` uses hardcoded `ZF-2026-0018`, Al Noor Family, SAR 32,112.50; state transition only calls `setStatus` | Mark as demo/incomplete or replace entry with actual assessment review; do not claim real approval/payment. |
| S1 | Medium | `BillingOrganizationPicker` rendered directly in billing content | Move/reuse banner organization control; no second selector. |
| A1 | Medium | `/invoice-register` alias ignores search parameters | Preserve explicit company and approved query state. |
| L1 | Medium | `/enterprise` calls unscoped legacy consolidation and uses corporate title | Retire/redirect legacy page or enforce explicit actual source; this is not current V2 consolidation. |
| B2 | High | `services/budget-planning.ts` lists owner plans and resolves updates by organization name/cost center; the existing schema already has `budget_plans.organization_id` | Use authorized organization ID or a visible authoritative adoption. Name-only inference is unsafe even when currently unique: adoption RLS can hide a former institution after membership removal. Preserve owner-only history and require verified mapping. |
| R1 | High | `FinancialRegisterWorkspace.tsx` restores `organization` but falls back to holding/first company if explicit URL is unavailable; organization/group changes do not dismiss all dialogs | Exact URL/preferred-company resolution, history synchronization, stale-response suppression and form reset. |
| D1 | High | `lots/[id]` and `transactions/[id]` load a record without matching banner ownership; detail classification and back/replacement links lose scope | Verify authorized record/asset ownership against scope/company/group; scoped return links, explicit mismatch/error state, actual-owner currency context. |
| D2 | Medium | `services/lots.ts` and `/api/lots/[id]` add creator-only filtering while migration `20261010124856_asset_acquisition_and_register.sql:37` already permits corporate `assets.view` readers | Restore list/detail parity for authorized corporate colleagues through existing RLS and explicit scope checks; no new grant or permission. |

The findings concern same-account personal/company separation and product correctness. They are **not** a claim that unrelated users' data has been exposed; that requires authenticated cross-user/API/RLS evidence.

## Explicit remaining capability gaps

The personal reporting plan documents unfinished classified income/expense recognition, historical net-worth snapshots, operating/investing/financing cash-flow classification, optional advanced personal chart editing, and reproducible base-currency translation. Navigation fixes do not complete these models. Keep current personal reports clearly described as estimated position and source cash movement, per currency.

Current corporate multi-currency consolidated statements, intercompany eliminations/ownership treatment, period ledger work and fiscal reversal/source contracts are owned by Work 03 (`#519`, `#521`) and Work 02 (`#520`). This audit must not introduce an alternate accounting engine or claim these unmerged PRs are in Production.

Feasibility sharing, invitation acceptance and evidence/upload functions have independent gates. A disabled rollout is not repaired by removing its authorization or rollout checks. Likewise, financial-events and fiscal-preview pages have deliberate preview/QA restrictions.

## Additional app surfaces outside the localized inventory

- `/` is the application entry route. The nonlocalized `/enterprise` is a separate legacy organization-creation form using `/api/enterprise`, not the localized unscoped consolidation page; this bounded candidate leaves that form unchanged.
- `/auth/legal` and `/auth/reset-password` are account/authentication flows.
- Seven owner administration routes exist at `/admin`, `/admin/analytics`, `/admin/companies`, `/admin/payments`, `/admin/settings`, `/admin/subscriptions`, `/admin/users`. Their owner-level access must remain separate from organization-member permissions.
- Twelve `design-preview`/`design-review` page routes are design fixtures. They do not prove working financial features or live authorization.

## Runtime acceptance and release evidence

### Observed baseline, signed-in Production reads

The lead audit session opened **22 personal routes**: `assets`, `cash-and-banks`, `investments`, `transactions`, `lots`, `assessments`, `payments`, `reports`, `debts`, `receivables`, `payables`, `loans`, `debt-advances`, `debt-collection`, `debt-report`, `financial-reports`, `financial-position`, `dashboard`, `prices`, `notifications`, `guide`, `account`. Personal feasibility was observed separately. A fresh read of personal cash-and-banks and investments reached the rendered workspace with no errors after network idle.

The same session visited **27 sidebar destinations from institutional context**, spanning the corporate dashboard, assets, debts, investments, feasibility, organizations and users. This count includes workflow and four shared/context-changing destinations with baseline scope defects; it is **not a count of 27 independently validated institutional modules**. Subsequent tab visits overlap these routes and must not be added to the unique-route count.

| Additional observed surface | Read-only result |
| --- | --- |
| Liquidity | All seven tabs rendered. |
| VAT and electronic invoicing | Five VAT tabs and the electronic-invoicing route rendered. |
| Budget planning | All six tabs rendered. |
| Financial reports | Overview, statements, income, position, cash-flow and KPIs rendered. Position and cash-flow network-idle waits timed out, but the visible page heading/content had rendered without alerts or loading placeholders. This is a DOM/page-read observation, not a completed network-idle check or reconciliation. |
| Accounting foundations | `opening-balances`, `chart-of-accounts`, `financial-reporting-policy` rendered without alerts. |
| Settings and subscription navigation | All seven links rendered without alerts: `settings/financial/setup`, `settings`, `settings/regulatory`, `settings/financial`, `settings/team`, `settings/system`, `billing`. |

These are **read-only baseline page/tab observations**, not candidate verification. They do not certify creation, saved edits, approval, settlement, export, reconciled balances, denied access, unrelated-user isolation or all roles. The session also observed stale organization/company-level parameters in personal sidebar URLs, setup/system links forcing institution, and workflow/prices/account-wide pages changing an institutional banner to personal. No Production financial data was written during these observations.

### Candidate changes completed by the module audit work

- Settings use the banner portal for billing organization selection. Personal setup/system show personal headings and only applicable tabs; company/global preference query handling is explicit. Initial and history-restored billing selections reject unavailable explicit companies; `organization_id` and `organization` agree across selector and billing reader.
- Budget list/detail/save/status APIs require a selected authorized `organization_id`. Bound rows must match it; legacy rows remain owner-only and require an existing visible authoritative adoption. Name-only ownership inference is disabled, including a unique current company name, because an earlier adoption can be hidden by RLS after membership removal. Reads never bind or rename history. Same-name/cost-center collisions fail explicitly instead of changing another company's plan. Dashboard budget consumers now use durable/resolved company IDs. No migration was added. Plans retaining the old personal-Zakat assumption marker can be read or saved as draft, but cannot be submitted/approved until that source is reviewed and replaced.
- Financial registers no longer replace an unavailable explicit company with a remembered/holding/first company. URL aliases and browser history use the authorized catalog; company/group changes dismiss forms, and responses are keyed to the active endpoint to keep stale company or personal responses out of the current workspace.
- Lot and transaction detail pages validate authorized record/asset ownership against personal/company selection. Group detail access requires the authorized descendant tree. A mismatch offers an explicit link to the record's own workspace; it never silently changes scope. Back, replacement and original/corrected-voucher links retain ownership; currency presentation uses the record owner. Lot API selection adds ownership metadata. The API isolation work restores colleague read parity through the corporate asset permissions that existing RLS already grants; personal owner isolation and explicit scope checks remain required.
- Localized `enterprise` redirects to the genuine assessment workspace, preserving explicit company/group context and choosing corporate manual assessment where applicable. `workflow` now states that a unified approval workflow is inactive and links real scoped assessments/payments; fabricated status transitions, family, assessment and financial totals were removed. This does not implement a unified approval engine.

At the module-audit checkpoint, **33 focused tests passed in six files**: register URL/company selection (4), record owner/group/link boundaries (6), legacy redirect scope (3), settings render contracts (3), budget isolation/status service behavior (13), and platform budget summary (4). Full TypeScript checking passed. Final backend review then added two budget regressions (15 budget tests total): revoked adoption hidden by RLS with a colliding active company name, and omission of unrelated unbound history. That targeted budget/summary run passed **19 tests in two files**. This is local code verification; the lead must record the final combined suite, commit and authenticated runtime acceptance separately.

### Rollout prerequisite: historical budget ownership

A historical plan with `organization_id IS NULL` and no visible authoritative `financial_budget_plan_ownership` row is excluded from company totals. If its old display name matches the requested company/group, the API returns an explicit reconciliation error instead of silently showing a partial or mislabeled company plan list; unrelated unbound histories do not block another company's list. Direct reads/updates of unresolved plans also fail closed. A revoked membership can hide an adoption row, so a unique currently authorized name does not prove ownership. These plans require a deliberate, verified ownership mapping before use in institutional budgets or dashboard totals. The dashboard marks the budget source unavailable while continuing its independent authorized cash, asset and VAT reads; an unresolved budget does not blank those other sources. Stored headers, lines, names and historical approval records are untouched. This candidate does not perform that mapping or add a migration.

### Read-only Production budget readiness check

A later read-only inspection of the Production database on 25 November 2026 found two saved budget plans. Both have a visible authoritative `financial_budget_plan_ownership` record and active membership for their plan owner; neither has a directly populated `organization_id`. There were zero unresolved legacy plans and zero conflicting ownership records. Thus the two current records do not require a guessed ownership backfill for this candidate. These counts describe the inspected snapshot, not future or unrelated historical records.

One of the two plans is `IN_REVIEW` and retains `assumptions.zakat_source = ZAKATFLOW_READ_ONLY_BASELINE`. Its stored amounts and status were not changed. The candidate prevents approving that plan until its personal-derived Zakat assumption is reviewed and replaced by the relevant institutional source or an explicitly reviewed manual estimate. The readiness queries used read-only transactions; no record identifiers or financial amounts are included in this report.

For every applicable row, record page opening, authenticated source, populated and empty state, denied/expired access, switching, reload, save where applicable, export where applicable, and expected result in Arabic/English and desktop/mobile. At minimum use personal owner A, independent owner B, company A, company B, and member with fewer permissions. Include slow/out-of-order responses and an open edit form while switching company/scope.

No module in this document is marked runtime passed on the basis of source inspection. No hosted QA deployment, production database mutation, merge or production deployment was performed by this inventory task.

### Combined candidate verification before the first PR run

- Complete local suite: **2,884 passed, 45 intentionally skipped; 385 passed files and five skipped files**. The skipped suites are not counted as acceptance evidence.
- Full TypeScript check passed after the scoped lot-service changes. A local production build passed; final PR build results must be checked for the committed revision.
- The rendered Chromium harness (`tests/workspace-scope/ui-scope.browser.cjs`) passed **eight scenarios with zero uncaught page errors**, including delayed A → personal → A saves, explicit organization URLs, budget Back/Forward, unavailable companies, group initialization, export links and corporate-only budget source requests. Its API responses are synthetic; it does not prove authentication, RLS or persistence.
- `tests/workspace-scope/acceptance.mjs` and `budget-checks.mjs` provide the separate genuine Auth/PostgREST/Chromium gate against an empty disposable database with the complete canonical migrations. The first CI result is pending at this checkpoint.
- Deployment policy and whitespace checks passed. No schema migration is included in this candidate. Personal currency changes remain in independent PR #522.

### Follow-up findings from authenticated CI

The first runnable scope gate passed thirteen genuine Auth/API checks: fresh personal access without an institution, retained institutional onboarding, colleague lot permissions, independent investment drafts and reads, rejected stale-scope writes, scoped CSV exports, and independent company budget creation/read/update/denial. It then exposed that system settings initially rendered six institutional tabs before hydration corrected an explicit personal URL. The server now passes the requested initial scope so the first rendered navigation is personal.

The existing full opening/report acceptance exposed an additional navigation regression after revoking a previously selected institution: topbar hydration had promoted that stale remembered ID into an explicit report URL. Hydration now preserves only explicit company parameters; the report publishes a fallback only after its current authorized context read, with page/scope/epoch guards. The real browser scenario retains both the revoked-memory fallback case and refusal of an explicitly unavailable company. Personal report navigation is checked before a deliberate switch to corporate statements.

The subscription/feasibility bridge also verifies an actual company choice through the banner after personal navigation removes stale institution parameters. Returning to Business restores a remembered company only after validating the page's authorized catalog, and writes that valid selection into the canonical URL. Personal project URLs do not select copy recipients. Existing persisted-copy, outsider denial, subscription and billing assertions remain in place.

These follow-up changes require the next combined CI run; completed results and the exact tested commit are recorded in [PR #523](https://github.com/oalhalabioa-ux/zakatflow/pull/523). A local or CI pass is not a hosted QA or Production deployment.
