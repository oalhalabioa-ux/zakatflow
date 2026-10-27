# Platform owner dashboard — QA acceptance

Branch: `feature/platform-owner-dashboard-qa`. Do not merge until checks pass.

## Environment prerequisites
- Vercel preview must explicitly target QA Supabase project `mbilbpaxnuxfgyweztsa` for both public URL and server-only service role key. Never use a production service-role key with a QA URL or vice versa.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only; never prefix it with `NEXT_PUBLIC_`.
- Migration `20261027050000_platform_admins.sql` is applied to QA.
- Create two test accounts through the QA authentication flow, using controlled test emails; do not copy production users.
- Grant `platform_owner` to one verified test user's exact `auth.users.id` via privileged SQL only:
```sql
insert into public.platform_admins(user_id,role)
values ('REPLACE_WITH_VERIFIED_QA_AUTH_USER_UUID','platform_owner');
```
Never execute this example without confirming the target project and account identity.

## Required tests
1. Anonymous request to `/admin` redirects to login.
2. Signed-in ordinary QA user sees access denied at `/admin` and `/admin/users`.
3. Verified owner sees `/admin` and paginated user register at `/admin/users`.
4. Ordinary user cannot select other users' membership records through RLS.
5. Ordinary user cannot insert/update/delete `platform_admins` rows.
6. Theme changes remain independent of standard dashboard theme.
7. No service-role key or other secrets are sent to browser bundles.
8. Check TypeScript, production build, desktop/mobile and Arabic/English.
9. Ensure all admin links resolve before production release. Unimplemented links must be disabled or clearly marked.
10. Confirm preview and production Supabase endpoints are isolated.

## Current status
- Schema and self-membership RLS applied in QA; QA auth.users was empty when inspected.
- No QA owner account provisioned; no authenticated end-to-end test run.
- User list is real data only after secure configuration.
- Companies, payments, subscriptions and analytics are not yet implemented.
