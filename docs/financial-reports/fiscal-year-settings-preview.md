# Fiscal year management — preview review

Base: merged PR #351, main `4c1907458021b5a1d0b03e89ca9b884dffebda80`.

## Scope

Canonical location: Settings → Organization settings → Financial & accounting settings → Fiscal year management (`/ar/settings/financial/fiscal-years`, with `/en/` equivalent).

Organization details links to financial settings. Opening balances and posting policies link to the same management page; they do not duplicate its configuration or closing forms. Year rows use the existing fiscal-period calculator, combine the surrounding display window with recorded historical periods, and never create accounting years or journal entries just by displaying or expanding the table. Recorded closed/superseded years retain their history; calendar mismatches are marked for review.

The management API uses the caller's existing RLS client and fiscal RPC permission check, reads only period metadata, includes budget bindings, and rechecks permission before returning data. Calendar save, close and reopen continue through the existing audited engine commands. Current/future years cannot be closed from the UI. Used calendars are read-only. Approved successor corrections remain enforced by the existing engine.

## Budget protection

The existing budget module stores an independent `financial_budget_plan_ownership.fiscal_start`. The new page checks those bindings against the organization calendar without altering any plans.

One **new, unapplied** migration (`20261104165205_fiscal_calendar_budget_guards.sql`) proposes two private triggers: prevent a used calendar change or an initial configuration that conflicts with existing budgets, and prevent mismatched or closed/approved budget date changes. It creates no tables, years, plans, entries or row backfills. It does not rebuild the fiscal engine. Original PR #351 migrations are unchanged. Production remains at 241 migrations until separate approval.

## Validation

- Local build and TypeScript check passed.
- 201 unit test files: 1,145 passed, 1 evidence-dependent test skipped.
- PostgreSQL/WASM execution passed actual guard SQL for independent January/July calendars, wrong budget dates, approved binding protection, preserving records after rejection and review of legacy unconfigured budgets.
- Full disposable Supabase Auth/PostgREST/browser acceptance is configured in `financial-opening-workspace-qa.yml`; the existing canonical history is bootstrapped only into a fresh temporary test database. Production is never targeted.
- The read-only review route `/ar/preview/fiscal-years` uses the same management component with fictional January/July fixtures, closed years and budget alignment. It performs no data API commands. Both `VERCEL_ENV=preview` and the branch-scoped `FISCAL_YEAR_REVIEW_PREVIEW=true` flag are required. It is unavailable on Production. Middleware exempts only this exact fictional-data route when both Preview gates are set; real settings and data APIs retain authentication.

No Production merge, deployment, migration, customer configuration or customer data changes are authorized for this task.
