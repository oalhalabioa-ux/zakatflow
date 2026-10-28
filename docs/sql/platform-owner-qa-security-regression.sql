-- Run in a dedicated disposable local Supabase test database, never shared QA or Production.
begin;
do $$
declare v text;
begin
 select proconfig::text into v from pg_proc where oid='public.owner_change_subscription_status(uuid,text,text)'::regprocedure;
 if v not like '%search_path=%' then raise exception 'subscription RPC missing hardened search path'; end if;
 if has_function_privilege('anon','public.owner_change_subscription_status(uuid,text,text)','EXECUTE') then raise exception 'anon can change subscriptions'; end if;
 if has_function_privilege('anon','public.owner_upsert_plan(text,text,numeric,text,text,boolean,uuid)','EXECUTE') then raise exception 'anon can edit plans'; end if;
 if has_function_privilege('anon','public.owner_list_payment_transactions(integer)','EXECUTE') then raise exception 'anon can read payment ledger'; end if;
 if has_table_privilege('authenticated','public.platform_payment_transactions','INSERT') or has_table_privilege('authenticated','public.platform_payment_transactions','UPDATE') or has_table_privilege('authenticated','public.platform_payment_transactions','DELETE') then raise exception 'payment ledger has direct authenticated writes'; end if;
 if not (select relrowsecurity from pg_class where oid='public.platform_payment_transactions'::regclass) then raise exception 'payment ledger RLS disabled'; end if;
end $$;
-- These calls must reject an unauthenticated context without touching data.
do $$
begin
 begin
  perform public.owner_change_subscription_status(gen_random_uuid(),'trialing','active');
  raise exception 'FAIL: anonymous subscription transition accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.owner_upsert_plan('qa-test','QA',1,'SAR','monthly',true,null);
  raise exception 'FAIL: anonymous plan upsert accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.owner_list_payment_transactions(1);
  raise exception 'FAIL: anonymous payment read accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
