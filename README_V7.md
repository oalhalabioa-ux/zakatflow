# ZakatFlow V7 — Commercial & Enterprise Layer

Adds:
- Consolidated Zakat dashboard/API across confirmed/paid assessments.
- Enterprise workspace billing/plan foundation.
- Subscription and billing-event tables with RLS.
- Plan capacity model.
- Enterprise and Billing pages.
- Production migration 007.

## Next production integrations
Connect a payment provider server-side; never trust browser-supplied plan/status. Add webhook signature verification and idempotency before accepting paid subscriptions.

Run `database/migrations/007_v7_commercial.sql` after V6 migrations.
