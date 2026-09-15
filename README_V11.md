# ZakatFlow V11 — Production-Ready MVP Package

V11 completes the main operational surface of ZakatFlow and hardens the connected MVP.

## Included
- Arabic/English responsive application shell.
- Ledger-first asset and transaction model.
- Automatic Lot creation and Hawl tracking.
- FIFO withdrawal/sale allocation and auditable Lot drill-down.
- Internal transfers without double-counting, preserving Lot/Hawl lineage.
- Gold purity calculation and market-price history.
- Silver/Gold Nisab valuation and FX history.
- Zakat assessment snapshots, line-level explanations and confirmation workflow.
- Assessment detail page with "Why this amount?" traceability.
- Transaction detail + safe reversal action.
- CSV reports for assessments, transactions, Lots and payments.
- Printable Zakat report suitable for browser PDF printing.
- Notification center and scheduled Hawl reminder processing endpoint.
- Audit logging hooks for transactions, assessments, payments, prices and FX.
- Enterprise/organization, governance, workflow, billing and consolidation foundations retained from V10.
- V11 database hardening migration.

## Database deployment
Run in Supabase SQL Editor in this order:
1. `database/schema.sql`
2. `database/migration-production.sql`
3. `database/migration-v4.sql`
4. `database/migrations/005_enterprise.sql`
5. `database/migrations/006_consolidation.sql`
6. `database/migrations/007_v7_commercial.sql`
7. `database/migrations/008_v8_workflow.sql`
8. `database/migration-v11.sql`

Use the project's final migration set consistently. If your existing Supabase project already contains earlier migrations, run only the missing ones and then V11.

## Environment
Copy `.env.example` to `.env.local` and configure:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `CRON_SECRET`

## Run locally
```bash
npm install
npm run check
npm run build
npm run dev
```

## Scheduled notifications
Call `POST /api/notifications/process` from a trusted scheduler with header `x-cron-secret: <CRON_SECRET>`.

## Important production governance gates
1. Have qualified Sharia reviewers approve the exact active rulesets and source references.
2. Replace the tabular Hijri adapter with a vetted calendar implementation if the selected methodology requires it.
3. Connect trusted market-price and FX providers and preserve provider/source timestamps.
4. Configure transactional email/push delivery.
5. Configure backups, monitoring, error tracking and a production domain.
6. Complete RLS, penetration, concurrency and E2E testing against the actual Supabase project.
7. Do not enable paid billing until the selected payment provider is configured and legally reviewed.

## Verification note
The supplied environment did not complete `npm install` within the available execution window, so a final local TypeScript/Next build could not be truthfully marked as passed here. The source package is complete and should be run through `npm run check` and `npm run build` in the deployment environment before public release.
