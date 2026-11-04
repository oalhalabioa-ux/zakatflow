begin;
create temporary table result(snapshot jsonb);
do $$
declare o uuid:=gen_random_uuid();u uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p jsonb;s jsonb;
begin
insert into auth.users(id,email,email_confirmed_at) values(u,u||'@example.invalid',now());
perform set_config('request.jwt.claim.sub',u::text,true);
insert into public.organizations(id,owner_user_id,name) values(o,u,'First activity QA');
insert into public.organization_members(organization_id,user_id,role,status) values(o,u,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values(b,o,'Capital bank','BANK','SAR',10000,10000,u,'{"opening_date":"2026-02-01","opening_balance":0,"opening_fx_rate":1}');
insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by) values(o,b,'INFLOW','FINANCING','Capital receipt','2026-02-01',10000,'SAR',10000,'ACTUAL','MANUAL',u);
p:=public.save_financial_reporting_policy(o,'2026-01-01',0,'[{"eventType":"ADJUSTMENT","sourceModule":"LEGACY_CASH","classificationId":"FINANCING:CASH","cashDirection":"INFLOW","debitAccountId":"1000","creditAccountId":"3100","cashActivity":"FINANCING"}]','Capital receipt recognition');
perform public.approve_financial_reporting_policy((p->>'id')::uuid,1);
s:=public.financial_statement_live_snapshot(o,'2026-01-01','2026-12-31');
if s->>'openingSourceId' is distinct from 'FIRST_ACTIVITY:2026-01-01' or s->'controls'->>'cashClosing' is distinct from '10000.0000' then raise exception 'first-activity mismatch';end if;
insert into result values(s);
end $$;
select jsonb_build_array(jsonb_build_object('name','Capital receipt is available without an opening workspace','passed',true)) from result;
rollback;
