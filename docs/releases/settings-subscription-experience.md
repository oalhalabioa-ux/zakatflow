# Organization settings and account experience

Keep Users & permissions and My account independent in the existing sidebar. Settings expands to Organization details, Subscription & plans and System settings, with matching page tabs and organization context preserved through navigation. The organizational structure stays independent. Existing billing URLs remain valid.

Replace the all-page subscription card with compact, contextual notices only for read/export-only restrictions, excluded modules or the last seven trial days. Ordinary active/legacy access has no work-page banner. Full usage and pricing details remain on the subscription page. A dismissed approaching-expiry reminder can reappear at the next 3/1-day threshold or a different organization/deadline. Database expiry/capability/seat guards are unchanged.

Organization settings reuse existing RLS-protected organization APIs. System settings show actual base currency and links to established module configuration; personal calendar/nisab/language/timezone stay in My account. No nonfunctional financial configuration is introduced. Users/roles pages and Google/OAuth configuration are unchanged.

My account now loads and persists the actual profile and preferences used by the application, preserving saved currencies and settings rather than resetting to SAR. It includes phone/timezone, loading/retry/save states and independent sign-out, with no demo-user references. Personal settings responses are private/no-store and writes require the existing same-origin policy. Preferences remain usable after organization expiry.

Owner subscription management retains its server-authorized per-organization register with responsible-user email and member count. Selected-organization actions now show the responsible user and scope, offer valid state transitions and show only the fields required for the chosen action. No new membership-editing surface is created.

No database migration, shared QA mutation or production test data is required. Validate with unit/type checks and disposable real Auth/PostgREST/browser checks covering navigation, legal-name persistence, personal preferences/timezone persistence, contextual notices and AR/EN mobile/desktop layouts. Review screenshots before merge, then verify the exact production release.
