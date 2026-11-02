# Financial source integration, V3

Read-only QA slice at `/design-preview/financial-reports/source` uses the existing `financial_budget_report` RPC through the verified caller’s SSR/RLS client. It reuses the current finance sidebar, saved plan ownership and current permissions. No admin client, new reporting database, migration, production access, merge or deployment.

Recognized Core actual, legacy manual actual and gross cash settlement remain distinct. Currency, organization, plan, entity, center, fiscal start and source flags are validated before an exact decimal projection. Scope/month changes clear the previous snapshot. CSV/XLSX export uses the selected snapshot and preserves precise amounts.

Formal financial statements deliberately remain unavailable until a canonical balanced debit/credit ledger adapter exists. The positive-only event model cannot safely supply a balance sheet or statement of cash flows.

Validation: 1041 tests in 186 files passed locally. Isolated PostgreSQL SQL/RLS checks passed in the preceding session. The new disposable Supabase acceptance workflow exercises genuine Auth, PostgREST, SSR cookies, RLS, browser layouts in Arabic/English, XLSX contents and membership revocation. Its actual CI result must be checked before claiming end-to-end acceptance.

The disposable database uses a synthetic minimal schema and permission helpers, with report/fact SQL extracted from repository migrations. It does not certify the full deployed VAT/Core schema. Production requires a separate read-only acceptance pass on an authorized QA organization.
