# Financial source integration, V3

Read-only QA slice at `/design-preview/financial-reports/source` uses the existing `financial_budget_report` RPC through the verified caller’s SSR/RLS client. It reuses the current finance sidebar, saved plan ownership and current permissions. No admin client, new reporting database, migration, production access, merge or deployment.

Recognized Core actual, legacy manual actual and gross cash settlement remain distinct. Currency, organization, plan, entity, center, fiscal start and source flags are validated before an exact decimal projection. Scope/month changes clear the previous snapshot. CSV/XLSX export uses the selected snapshot and preserves precise amounts.

Formal financial statements deliberately remain unavailable until a canonical balanced debit/credit ledger adapter exists. The positive-only event model cannot safely supply a balance sheet or statement of cash flows.

Validation: 1041 tests in 186 files passed locally. Isolated PostgreSQL SQL/RLS checks passed in the preceding session. The new disposable Supabase acceptance workflow exercises genuine Auth, PostgREST, SSR cookies, RLS, browser layouts in Arabic/English, XLSX contents and membership revocation. All eight acceptance groups passed on commit `35cf2d28caba902a7954a95b5b217b842277d7aa`: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41502400129 . The Quality build, audit and check workflow also passed: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/41502400118 . Four actual browser screenshots, two verified XLSX exports and the sanitized JSON results are retained in artifact `financial-reporting-source-acceptance` (ID 13169241935). Zero browser exceptions. The existing sidebar resize animation is allowed to finish before the 390px width assertion; its design/CSS is unchanged.

The disposable database uses a synthetic minimal schema and permission helpers, with report/fact SQL extracted from repository migrations. It does not certify the full deployed VAT/Core schema. Production requires a separate read-only acceptance pass on an authorized QA organization.

Source contract: four-decimal amounts are validated; large exact string amounts are retained. Numeric JSON values beyond safe four-decimal precision, or unsupported source scales, fail closed. A full QA acceptance must include allocation/rounding and large-value cases before rollout.
