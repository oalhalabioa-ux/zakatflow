do $migration$
declare t record;
begin
 if to_regprocedure('subscription_private.assert_writable(uuid)') is not null then
  for t in select c.oid,n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('financial_opening_workspaces','financial_opening_audit','financial_reporting_policies','financial_reporting_policy_audit') loop
   execute format('create trigger subscription_write_guard before insert or update or delete on %I.%I for each row execute function subscription_private.guard_write()',t.nspname,t.relname);
   insert into subscription_private.guard_coverage(schema_name,table_name,has_direct_scope,foreign_keys)
   select t.nspname,t.relname,true,(select count(*) from pg_catalog.pg_constraint where conrelid=t.oid and contype='f');
  end loop;
 end if;
end $migration$;
