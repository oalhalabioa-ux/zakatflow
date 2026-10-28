# Full local Supabase acceptance

This supplements the 29 embedded PostgreSQL scenarios with real local Supabase Auth, signed user sessions, PostgREST and PostgreSQL 17. The stack runs only inside a disposable GitHub Actions runner, never against the hosted QA or Production projects. No repository secrets or service-role keys are used. Two synthetic users are created through public Auth signup with confirmation disabled only in that disposable local stack.

Workflow: `.github/workflows/owner-production-supabase-review.yml`.
Test: `tests/owner-production-review/supabase-http.mjs`.
Supabase CLI is pinned to 2.122.0. The PostgreSQL major version is explicitly 17. Source tables use the observed Production metadata; no Production rows or accounts are copied. Unrelated business modules are not a full Production clone.

The test applies the candidate transaction and postflight, provisions the synthetic existing owner with the separately guarded procedure, exercises all eleven ordinary-user and anonymous RPC denials, all nine owner reads, direct-table protections, disabled owner writes, genuine logout, refresh revocation and rejection of the old owner JWT by RPC. It also builds and serves the existing Next application against the local stack and checks all seven routes for owner, ordinary and anonymous requests, including absence of write forms.

Only sanitized check names and results are logged. Startup and CLI status credentials are not printed. Cleanup always stops the stack without retaining its database. A failed stack startup is a failure, with no fallback to hosted projects. No Vercel deployment or main merge is part of this workflow.

Foundation scope: Production `subscriptions` was checked read-only and contained zero rows, including zero technical/test rows linked to users. Packages and platform subscriptions start empty; the original source table is retained untouched. User accounts, permissions and data are preserved. All collection and mutation controls remain disabled.

The workflow result must be reviewed before any independent application approval. This document does not authorize Production DDL, owner enrollment, merge, deployment or billing enablement.

Result: **PASS**, including successful temporary stack cleanup. See supabase-http-result.json and foundation-final-review.md. Run: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40755325439
