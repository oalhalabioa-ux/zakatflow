# ZakatFlow — Zakat Management Platform

ZakatFlow is a ledger-first bilingual Arabic/English web platform for managing zakatable wealth, Lots, Hawl, Nisab, valuation, FX, assessments and payments.

## Current build

- Next.js + React + TypeScript
- Supabase Auth + PostgreSQL + RLS
- Ledger-first transaction model
- Automatic Lots for qualifying inflows
- FIFO withdrawal allocation with database row locks
- Internal transfers preserving the source Lot/Hawl instead of double counting
- Gold/Silver support and Nisab
- Gregorian and tabular Hijri Hawl calculation (the Hijri ruleset must receive Sharia review before production use)
- Market valuation + FX inputs
- Zakat assessment snapshots
- Explainable assessment lines
- Payment tracking and paid/partial status
- Arabic RTL / English LTR shell
- CSV operational reports
- Audit-ready reversals instead of destructive deletion

## Supabase setup

1. Create a Supabase project.
2. In SQL Editor run `database/schema.sql`.
3. Run `database/seed.sql`.
4. Run `database/migration-production.sql`.
5. Enable Email/OTP authentication in Supabase Auth.
6. Add environment variables from `.env.example`.
7. Install dependencies and run `npm run dev`.

The production migration creates the `auth.users` → `profiles` trigger and atomic database functions for withdrawals, transfers and reversals.

## Environment

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Important Sharia governance note

The platform is an accounting/calculation engine, not a religious authority. Zakat methodologies, Nisab standards, Hawl rules, asset treatment and exceptions are configurable and should be reviewed and approved by qualified Sharia scholars before commercial launch.

The default Hijri engine is a tabular/civil calendar algorithm. It should not be presented as a universal moon-sighting ruling.

## Build roadmap

The current codebase is the functional foundation. Remaining production work includes:

- external market-price/FX providers with source/version retention
- institutional roles and admin console
- scholar review workflow for rulesets
- PDF/Excel financial reports
- scheduled notifications/email
- automated E2E tests
- rate limiting, monitoring and production observability
- formal security review and penetration testing
- mobile/PWA refinement

## V4 additions
- Admin Console and Sharia Governance screens.
- Versioned rule review workflow with approve/reject/change-request decisions.
- Scholar/source metadata tables.
- Organization and multi-role foundation (owner/admin/accountant/advisor/viewer/sharia reviewer).
- Notification job scheduling for 30/15/7-day Hawl reminders.
- CSV exports for assessments, transactions and lots.
- Provider configuration foundation for market-price integrations.

Run `database/migration-v4.sql` after the production migration.

### Scheduled notifications
Configure `CRON_SECRET` and invoke `POST /api/notifications/process` from a trusted scheduler. The endpoint uses the service-role key server-side only.
