# ZakatFlow V8

V8 adds the operational end-to-end workflow layer: case management, accountant/Sharia approval states, workflow audit events, consolidated assessment snapshots, and report job queue foundations.

## Database
Apply migrations in order, including `database/migrations/008_v8_workflow.sql`, to a Supabase/PostgreSQL project.

## Workflow
DRAFT → IN_PROGRESS → ACCOUNTANT_REVIEW → SHARIA_REVIEW → APPROVED → PAID → CLOSED. Rejection can return the case to the relevant prior stage.

## Production note
The project is application source code, not a deployed SaaS instance. Configure Supabase Auth, environment variables, apply migrations, install dependencies, then run `npm run typecheck && npm test && npm run build` in a normal Node environment.
