-- Read-only preflight; run again immediately before any approved application.
begin read only;
select current_setting('server_version') as server_version;
select n.nspname,c.relname,c.relkind,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth') and c.relname in ('users','sessions','organizations','organization_members','subscriptions','platform_admins','platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events') order by 1,2;
select p.proname,pg_get_function_identity_arguments(p.oid) as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'owner_%';
-- Confirm no target collision, schema drift, missing source columns or unexpected grants before proceeding.
rollback;

