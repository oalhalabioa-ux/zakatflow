-- Read-only postflight; does not run a write RPC.
begin read only;
do $checks$
declare t text; f record; n integer;
begin
 foreach t in array array['platform_admins','platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events'] loop
 if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then raise exception 'RLS missing: %',t; end if;
 if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
 then raise exception 'unsafe direct privilege: %',t; end if;
 if t<>'platform_admins' and has_table_privilege('authenticated','public.'||t,'SELECT') then raise exception 'direct admin read granted'; end if;
 end loop;
 select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('owner_authorized','owner_user_count','owner_organization_count','owner_subscription_summary','owner_list_users','owner_list_organizations','owner_list_plans','owner_list_subscriptions','owner_list_payment_transactions','owner_list_audit_events','owner_upsert_plan','owner_change_subscription_status');
 if n<>12 then raise exception 'expected 12 owner functions, got %',n; end if;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('owner_authorized','owner_user_count','owner_organization_count','owner_subscription_summary','owner_list_users','owner_list_organizations','owner_list_plans','owner_list_subscriptions','owner_list_payment_transactions','owner_list_audit_events','owner_upsert_plan','owner_change_subscription_status') loop
 if not f.prosecdef or not ('search_path=""'=any(f.proconfig)) or has_function_privilege('anon',f.oid,'EXECUTE') or not has_function_privilege('authenticated',f.oid,'EXECUTE')
 then raise exception 'unsafe function privileges/settings: %',f.proname; end if;
 end loop;
end $checks$;
rollback;

