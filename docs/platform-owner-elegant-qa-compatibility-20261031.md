# Platform Admin QA compatibility preflight — 2026-10-31

## Scope
Read-only diagnosis for project `weucywfwbdnomtlkjurl`, connected to PR #323 Elegant owner theme preview. No database migration, production setting or user data change is authorized by this document.

## Observed schema divergence
- `public.platform_admins`, `platform_organizations`, `platform_plans`, `platform_subscriptions` exist.
- `public.organizations`, `organization_members`, `profiles` are absent in this isolated administrative mirror.
- `public.owner_authorized()`, `owner_user_count()`, `owner_organization_count()`, and `owner_subscription_summary()` exist.
- `public.owner_trial_register(text,text,integer)`, `subscription_private.settings`, and `subscription_private.activation_requests` are absent.
- The mirror contains 1 owner, 0 plans, 0 subscriptions, and 0 mirrored organizations at inspection.

## Migration incompatibility
`20261030150759_organization_trial_entitlements.sql` references `public.organizations` and additional operational tables. The subsequent configurable plans and activation request migrations depend on this foundation. Running these production-oriented migrations against the mirror directly would fail or create misleading partial objects. Do not replay them as-is.

## Safe preflight (read-only)
```sql
select to_regclass('public.organizations') as operational_organizations,
       to_regclass('public.platform_organizations') as mirrored_organizations,
       to_regclass('public.organization_members') as memberships,
       to_regclass('public.platform_subscriptions') as mirrored_subscriptions,
       to_regclass('subscription_private.settings') as trial_settings,
       to_regclass('subscription_private.activation_requests') as activation_requests,
       to_regprocedure('public.owner_trial_register(text,text,integer)') as trial_register;
select table_name,column_name,data_type
from information_schema.columns
where table_schema='public'
  and table_name in ('organizations','organization_members','platform_organizations','platform_subscriptions','platform_plans')
order by table_name,ordinal_position;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'owner_%';
```

## Proposed safe routes
1. **Visual QA now:** Keep preview source and layout CSS isolated to PR #323. Use explicitly labelled placeholder/loading indicators, never fabricated live metrics. Verify by owner screenshots across desktop/mobile and languages.
2. **Functional subscription QA:** Provision an isolated full-schema test database or apply a reviewed, mirror-specific compatibility adapter only after comparing entity identity, role semantics, data sources, RLS and migration dependencies. Test owner/non-owner access before linking the app.
3. Do not create `public.organizations` as a superficial alias for `platform_organizations`; the latter has a different purpose and fewer columns, and such an alias may invalidate permissions and subscription ownership.
4. Do not use a production service-role key in preview, do not change current production auth redirects, and do not merge until authenticated visual and functional acceptance passes.

## Acceptance gates
- Schema and foreign-key preflight passes.
- Existing owner and other user role identities remain unchanged.
- All public exposed tables have RLS and appropriate grants; privileged functions verify `auth.uid()` and owner role.
- Owner list/metrics, plan editor and activation requests work under authenticated PostgREST.
- Ordinary user denied owner functions and all seven admin pages.
- RTL/LTR desktop/tablet/mobile visual review matches approved Yaqeen Elegant board.
