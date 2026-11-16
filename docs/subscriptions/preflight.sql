-- READ ONLY. Run on the isolated target first; live execution requires a release decision.
begin transaction read only;
select current_database(),version(),current_setting('TimeZone');
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('organizations','organization_members','platform_subscriptions','platform_plans','platform_audit_events','subscriptions','budget_plans') order by table_name,ordinal_position;
select 'legacy_user_subscriptions' source,count(*) rows from public.subscriptions
union all select 'organization_subscriptions',count(*) from public.platform_subscriptions;
select organization_id,count(*) from public.platform_subscriptions where status in ('trialing','active','past_due') group by organization_id having count(*)>1;
select pg_get_functiondef('public.owner_authorized()'::regprocedure);
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by p.proname;
rollback;
