-- REVIEW ONLY: non-destructive emergency access rollback.
-- Disable owner UI release FIRST; this retains records and leaves legacy business tables intact.
begin;
set local lock_timeout='3s';
do $disable$
declare f record;t text;
begin
 if current_setting('yaqeen.platform_owner_rollback_approval',true) is distinct from 'APPROVED_DISABLE_PLATFORM_OWNER_ACCESS'
 then raise exception 'rollback approval required'; end if;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('owner_authorized','owner_user_count','owner_organization_count','owner_subscription_summary','owner_list_users','owner_list_organizations','owner_list_plans','owner_list_subscriptions','owner_list_payment_transactions','owner_list_audit_events','owner_upsert_plan','owner_change_subscription_status') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 foreach t in array array['platform_admins','platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events'] loop
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $disable$;
notify pgrst,'reload schema';
commit;
-- Do not DROP/CASCADE or delete memberships/data. Re-enable only through separately reviewed grants.

