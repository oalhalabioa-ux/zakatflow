-- Full Production-history disposable Supabase ONLY. This seed is rolled back
-- regardless of success; never run against a hosted customer database.
-- Checks raw legacy source records against the ACTUAL Production SQL adapter.
begin;
do $$
declare
 actor uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();
 asset uuid:=gen_random_uuid();
 purchase uuid:=gen_random_uuid();
 cash uuid:=gen_random_uuid();
 transfer uuid:=gen_random_uuid();
 source_account uuid:=gen_random_uuid();
 destination_account uuid:=gen_random_uuid();
 outgoing uuid:=gen_random_uuid();
 incoming uuid:=gen_random_uuid();
 events jsonb;
 rowdata jsonb;
 part jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at)
 values(actor,actor::text||'@legacy-parity.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.organizations(id,owner_user_id,name,base_currency)
 values(org,actor,'Temporary legacy financial source parity','SAR');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(org,actor,'OWNER','ACTIVE');

 insert into public.asset_accounts(id,user_id,asset_type,name,currency,
  organization_id,ownership_scope)
 values(asset,actor,'GOLD','Temporary legacy asset','SAR',org,'ORGANIZATION');
 insert into public.transactions(id,user_id,asset_account_id,transaction_type,
  transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,
  organization_id,metadata)
 values(purchase,actor,asset,'PURCHASE','2026-03-02',2,300,'SAR',600,
  'SAR',600,org,'{}'::jsonb);

 insert into public.liquidity_flows(id,organization_id,direction,title,due_date,
  amount,currency,base_amount,status,created_by)
 values(cash,org,'INFLOW','Temporary cash receipt','2026-03-03',
  250,'SAR',250,'ACTUAL',actor);

 -- A transfer_id must refer to an actual transfer between two accounts,
 -- not an arbitrary UUID. Seed all FK prerequisites in the disposable DB.
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,created_by)
 values(source_account,org,'Temporary transfer source','BANK','SAR',actor),
       (destination_account,org,'Temporary transfer destination','BANK','SAR',actor);
 insert into public.liquidity_transfers(
  id,organization_id,source_account_id,destination_account_id,
  source_amount,source_currency,source_base_amount,
  destination_amount,destination_currency,destination_base_amount,
  exchange_rate,fx_difference_base,transfer_date,created_by)
 values(transfer,org,source_account,destination_account,
  100,'SAR',100,105,'SAR',105,1.05,5,'2026-03-04',actor);
 -- Two real flow records represent a transfer with a 5 SAR difference;
 -- only the net difference belongs in the reporting adapter.
 insert into public.liquidity_flows(id,organization_id,direction,title,due_date,
  amount,currency,base_amount,status,created_by,transfer_id)
 values(outgoing,org,'OUTFLOW','Temporary transfer out','2026-03-04',
   100,'SAR',100,'ACTUAL',actor,transfer),
  (incoming,org,'INFLOW','Temporary transfer in','2026-03-04',
   105,'SAR',105,'ACTUAL',actor,transfer);

 select private.financial_reporting_legacy_events(org,date '2026-01-01',date '2026-12-31')
 into events;
 if jsonb_typeof(events)<>'array' or jsonb_array_length(events)<>3
 then raise exception 'PARITY_LEGACY_EVENT_COVERAGE_MISMATCH';end if;

 select item into rowdata from jsonb_array_elements(events) item
 where item->>'id'='transaction:'||purchase::text;
 if rowdata is null or rowdata->>'sourceModule'<>'LEGACY_ASSET' or
   rowdata->>'sourceKey'<>purchase::text or
   jsonb_array_length(rowdata->'lines')<>1
 then raise exception 'PARITY_LEGACY_ASSET_SOURCE_INCOMPLETE';end if;
 part:=rowdata->'lines'->0;
 if part->>'id'<>'transaction:'||purchase::text||':BOOK' or
    part->>'cashDirection'<>'NON_CASH' or
    (part->>'baseAmount')::numeric<>(select t.base_value from public.transactions t where t.id=purchase) or
    (part->>'recognitionSign')::int<>1
 then raise exception 'PARITY_LEGACY_ASSET_VALUE_MISMATCH';end if;

 select item into rowdata from jsonb_array_elements(events) item
 where item->>'id'='flow:'||cash::text;
 if rowdata is null or rowdata->>'sourceModule'<>'LEGACY_CASH' or
    rowdata->>'sourceKey'<>cash::text or jsonb_array_length(rowdata->'lines')<>1
 then raise exception 'PARITY_LEGACY_CASH_SOURCE_INCOMPLETE';end if;
 part:=rowdata->'lines'->0;
 if part->>'id'<>'flow:'||cash::text or
    part->>'cashDirection'<>'INFLOW' or
    (part->>'baseAmount')::numeric<>(select f.base_amount from public.liquidity_flows f where f.id=cash)
 then raise exception 'PARITY_LEGACY_CASH_VALUE_MISMATCH';end if;

 select item into rowdata from jsonb_array_elements(events) item
 where item->>'id'='transfer:'||transfer::text;
 if rowdata is null or rowdata->>'sourceModule'<>'LEGACY_CASH' or
    rowdata->>'sourceKey'<>transfer::text or jsonb_array_length(rowdata->'lines')<>1
 then raise exception 'PARITY_LEGACY_TRANSFER_SOURCE_INCOMPLETE';end if;
 part:=rowdata->'lines'->0;
 if part->>'id'<>'transfer:'||transfer::text or
    part->>'cashDirection'<>'INFLOW' or
    (part->>'baseAmount')::numeric<>(
       select abs(sum(case when direction='INFLOW' then base_amount else -base_amount end))
       from public.liquidity_flows where organization_id=org and transfer_id=transfer)
 then raise exception 'PARITY_LEGACY_TRANSFER_VALUE_MISMATCH';end if;

 if (select count(distinct item->>'id') from jsonb_array_elements(events) item)<>3
 then raise exception 'PARITY_LEGACY_DUPLICATED_OUTPUT';end if;
end $$;
rollback;
