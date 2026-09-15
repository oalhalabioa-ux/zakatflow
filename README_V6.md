# ZakatFlow V6 — Enterprise & Approval Layer

V6 adds:
- Organizations and workspaces
- Members and roles
- Multiple entities (person/family/company)
- Entity-level membership foundations
- Assessment approval workflow and reviewer action
- Report job queue foundation for PDF/XLSX/CSV
- Subscription/plan foundation
- RLS policies for enterprise data
- Authenticated server-side ownership (no browser-supplied owner_id)

## Apply migration
Run `database/migrations/enterprise-v6.sql` after the previous migrations in Supabase SQL Editor or your migration pipeline.

## Production notes
- Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Payment provider integration is intentionally a foundation only; no real billing is enabled by this package.
- Sharia rules still require qualified review before commercial use.

## Validation
The source tree is packaged with its dependencies declared in `package.json`. Dependency installation was not completed in the build sandbox, so final `npm run typecheck`/`npm test` should be run after `npm install` in a normal Node environment.
