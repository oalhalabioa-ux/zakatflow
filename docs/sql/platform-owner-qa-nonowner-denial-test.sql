-- QA only. Simulates an authenticated non-owner; no production data or persistent writes.
-- Uses an impossible synthetic UUID and rolls back every change.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000123',true);
do $$
begin
 begin
  perform public.owner_list_payment_transactions(1);
  raise exception 'FAIL: non-owner payment read allowed';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.owner_change_subscription_status('00000000-0000-4000-8000-000000000124'::uuid,'trialing','cancelled');
  raise exception 'FAIL: non-owner subscription change allowed';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.owner_upsert_plan('qa-nonowner','QA nonowner',1,'SAR','monthly',true,null);
  raise exception 'FAIL: non-owner plan edit allowed';
 exception when sqlstate '42501' then null; end;
end $$;
rollback;
