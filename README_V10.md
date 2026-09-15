# ZakatFlow V10 — Connected MVP

V10 connects the main user-facing flows to the Supabase-backed services.

## Included
- Live dashboard data
- Asset and transaction ledger APIs
- Real assessment save endpoint and immutable calculation snapshot
- Assessment detail API
- Gold/silver preview and pure-gold calculation
- Workflow, organizations, governance, billing foundations
- RLS-ready Supabase schema
- Arabic/English locale shell

## Run
1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Apply database schema/migrations to Supabase.
4. `npm install`
5. `npm run check`
6. `npm run build`
7. `npm run dev`

## Production gates
- Validate the Sharia ruleset with qualified reviewers.
- Configure a vetted Hijri calendar adapter.
- Connect trusted market-price/FX providers.
- Configure email/push delivery and scheduled jobs.
- Add payment provider keys before enabling paid subscriptions.
- Complete E2E/security testing before public launch.
