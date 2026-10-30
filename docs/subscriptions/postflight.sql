-- READ ONLY structural checks. No test user or customer state is modified.
begin transaction read only;
select * from subscription_private.guard_coverage order by table_name;
-- Must return zero: every public business table present during installation still has its guard.
select c.table_name from subscription_private.guard_coverage c where not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||quote_ident(c.table_name))::regclass and t.tgname='subscription_write_guard' and t.tgenabled='O');
-- Must return zero: review any new public table added since the installer ran.
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'platform\_%' escape '\' and c.relname not in ('organizations','profiles','user_settings','currencies','zakat_methods','reference_prices','subscriptions','billing_events','notifications','nisab_prices','price_sources') and not exists(select 1 from subscription_private.guard_coverage g where g.table_name=c.relname);
-- Must return zero: anonymous/private helper execution or public schema access.
select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='subscription_private' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));
select organization_id,count(*) from platform_subscriptions where trial_started_at is not null group by organization_id having count(*)>1;
rollback;
