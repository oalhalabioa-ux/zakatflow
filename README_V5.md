# ZakatFlow V5

V5 adds the Enterprise Layer on top of the V4 calculation and governance foundation.

## New capabilities
- Organizations / family workspaces
- Multiple legal/person entities under a workspace
- Organization roles: Owner, Admin, Accountant, Advisor, Viewer, Sharia Reviewer
- Invitations with expiring tokens
- Entity-linked assets, transactions, lots and assessments
- Consolidated assessment data model
- Consolidation calculation engine
- Organization-level RLS policies

## Database deployment
Run the existing schema/migrations in order, then:
1. `database/migrations/005_enterprise.sql`
2. `database/migrations/006_consolidation.sql`

Supabase Auth remains the identity source. Do not expose service-role credentials to the browser.

## Production roadmap
- invitation acceptance + email delivery
- full organization role middleware
- consolidated assessment UI and PDF/Excel reporting
- provider adapters for metal prices and FX
- E2E tests and production observability
