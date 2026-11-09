# Module bundle builder

Customer entry: subscription and billing → Build your bundle (`/ar/billing?section=builder`, retaining the selected organization). Administration: Subscriptions → Modules and pricing / Bundle quotes.

The approved white-card layout uses gold outline icons, restrained gold active underlines and small green selection checks. It uses the existing application shell and Arabic/English responsive layouts. The duplicated custom-plan creation action and placeholder catalog card are removed; normal Add plan remains available.

The catalog contains the seven actually gated modules. Assets and liquidity remain required by the existing capability contract. Reports, reading and export remain baseline access; no fictitious separately billable reports module is added. Existing plan records and prices are preserved. New module entries initially request a quote without invented prices. Administration can set monthly/annual prices, currency, visibility, descriptions, icon and acyclic dependencies.

Prices are computed in the database and snapshotted with module revisions. Mixed currencies and missing dependencies are rejected. Any quoted module requires a final offer, customer acceptance, then explicit owner activation. Fully priced selections request activation directly. Both paths retain manual activation and disabled card collection. Activation creates a private request-specific plan with accepted features/price/seat cap for one selected billing cycle; it never publishes that plan or edits an existing one. The current seat limit is displayed before submission. Quotes can revise the seat limit before customer acceptance.

Authorization uses existing active organization OWNER/ADMIN membership and platform owner session checks. New tables are private, RLS-enabled and have no direct API grants. Mutations use audited RPCs, same-origin API checks, optimistic revisions, a unique open request per organization and idempotency tokens. A later subscription revision blocks stale activation.

Validation: local TypeScript and 1461 unit tests passed (one existing skipped). Observed-schema PostgreSQL/PGlite tests exercise quote offer/accept/activate, immutable fixed price calculation, retry/conflict handling, forbidden users and preservation of prior plans. AR/EN browser fixture tests cover desktop/mobile, white cards, gold icons, selection and submit; these are UI fixtures, not hosted authentication evidence. Disposable Supabase browser acceptance includes real admin pricing save/reload, customer submission/reload, offer, customer acceptance and activation; see the current CI run for completion.

Migration `20261109035940_module_bundle_builder.sql` is additive and applied only to Financial Core QA V2. No Production migration, main merge or Production deployment is authorized by this change.
