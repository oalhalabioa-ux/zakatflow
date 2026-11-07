-- Additive, READ-ONLY finance attestation. Never widen raw allocation RLS.
-- A finance-authorized user receives only a true/exception result, not
-- another operator's asset lots, transaction allocations or cash register.
-- The check is a separate snapshot from the caller's statement snapshot.
-- It is a consistency/evidence gate, not same-transaction revision proof.
create or replace function public.financial_reporting_legacy_attestation(
 p_org uuid, p_from date, p_to date, p_expected_events jsonb
) returns boolean language plpgsql stable security definer
set search_path = '' as $$
declare
 actual jsonb; expected_sorted jsonb; actual_sorted jsonb;
 sale record; allocation_count bigint; allocation_lots bigint;
 allocation_quantity numeric; allocation_cost numeric;
 broken_lots bigint; cost numeric; metadata_cost numeric;
 report_event jsonb; book_parts jsonb; proceeds_parts jsonb;
begin
 if auth.uid() is null or not exists(
  select 1 from public.organization_members m
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE'
 ) or public.financial_core_can(p_org,'financial_core.view') is distinct from true
 then raise exception 'REPORTING_ACCESS_DENIED'; end if;

 if p_from is null or p_to is null or p_from>p_to
    or p_to>p_from+interval '2 years'
 then raise exception 'REPORTING_PERIOD_INVALID'; end if;
 if jsonb_typeof(p_expected_events) is distinct from 'array'
    or jsonb_array_length(p_expected_events)>10000
    or pg_column_size(p_expected_events)>8000000
 then raise exception 'REPORTING_LEGACY_SOURCE_UNVERIFIED'; end if;

 -- Compare the ENTIRE legacy set (not an RLS-visible subset), including
 -- source identities, split roles, classification, direction and amounts.
 actual:=private.financial_reporting_legacy_events(p_org,p_from,p_to);
 if jsonb_typeof(actual) is distinct from 'array' then
  raise exception 'REPORTING_LEGACY_SOURCE_UNVERIFIED'; end if;
 if (select count(distinct e->>'id') from jsonb_array_elements(p_expected_events) x(e))
    <>jsonb_array_length(p_expected_events)
    or (select count(distinct e->>'id') from jsonb_array_elements(actual) x(e))
    <>jsonb_array_length(actual)
 then raise exception 'REPORTING_LEGACY_SOURCE_UNVERIFIED'; end if;

 select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) into expected_sorted
  from jsonb_array_elements(p_expected_events) x(e);
 select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) into actual_sorted
  from jsonb_array_elements(actual) x(e);
 if expected_sorted is distinct from actual_sorted then
  raise exception 'REPORTING_LEGACY_SOURCE_UNVERIFIED'; end if;

 -- Independently certify the cost used for each unintegrated asset SALE.
 -- The private normalization source prefers allocations when present; those
 -- rows may be invisible through the finance user's direct RLS query.
 -- No implied zero cost, incomplete FIFO, duplicated lots or cross-org lots.
 for sale in
  select t.* from public.transactions t
  join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=p_org
  where t.organization_id=p_org and t.transaction_date between p_from and p_to
   and t.transaction_type::text='SALE'
   and a.asset_type::text not in('CASH','BANK','RECEIVABLE')
   and not coalesce((t.metadata->>'recognition_pending')::boolean,false)
   and not (t.metadata ? 'financial_event_id')
   and not exists(select 1 from public.financial_events e
    where e.organization_id=p_org and e.source_record_id=t.id)
   and not exists(select 1 from public.financial_event_links l
    join public.financial_events e on e.id=l.event_id and e.organization_id=p_org
    where l.organization_id=p_org and l.target_module='transactions'
      and l.target_record_id=t.id)
 loop
  select count(*),count(distinct a.lot_id),coalesce(sum(a.quantity),0),
   coalesce(sum(a.value_base),0),
   count(*) filter(where l.id is null or l.organization_id is distinct from p_org
      or l.asset_account_id is distinct from sale.asset_account_id
      or a.quantity<=0 or a.value_base<0)
  into allocation_count,allocation_lots,allocation_quantity,allocation_cost,broken_lots
  from public.transaction_allocations a
  left join public.lots l on l.id=a.lot_id
  where a.transaction_id=sale.id;

  metadata_cost:=coalesce(nullif(sale.metadata->>'cost_basis_base','')::numeric,
                           nullif(sale.metadata->>'disposed_cost_base','')::numeric);
  if allocation_count>0 then
   if broken_lots>0 or allocation_lots<>allocation_count
      or allocation_quantity is distinct from sale.quantity
      or (metadata_cost is not null and metadata_cost<>allocation_cost)
   then raise exception 'REPORTING_LEGACY_COST_ALLOCATION_INVALID'; end if;
   cost:=allocation_cost;
  else
   cost:=metadata_cost;
  end if;
  if cost is null or cost<0 or sale.quantity<=0 or sale.base_value<=0
  then raise exception 'REPORTING_LEGACY_COST_UNATTESTED'; end if;

  select e into report_event from jsonb_array_elements(p_expected_events) x(e)
   where e->>'id'='transaction:'||sale.id::text;
  if report_event is null then
   raise exception 'REPORTING_LEGACY_SOURCE_UNVERIFIED'; end if;
  select coalesce(jsonb_agg(l),'[]'::jsonb) into book_parts
   from jsonb_array_elements(report_event->'lines') x(l)
   where l->>'id'='transaction:'||sale.id::text||':BOOK';
  select coalesce(jsonb_agg(l),'[]'::jsonb) into proceeds_parts
   from jsonb_array_elements(report_event->'lines') x(l)
   where l->>'id'='transaction:'||sale.id::text||':PROCEEDS';
  if jsonb_array_length(proceeds_parts)<>1
     or (proceeds_parts->0->>'baseAmount')::numeric<>sale.base_value
     or proceeds_parts->0->>'cashDirection'<>'NON_CASH'
     or (proceeds_parts->0->>'recognitionSign')::integer<>1
     or jsonb_array_length(book_parts)<>case when cost>0 then 1 else 0 end
  then raise exception 'REPORTING_LEGACY_SALE_RECONCILIATION_FAILED'; end if;
  if cost>0 and ((book_parts->0->>'baseAmount')::numeric<>cost
     or book_parts->0->>'cashDirection'<>'NON_CASH'
     or (book_parts->0->>'recognitionSign')::integer<>1)
  then raise exception 'REPORTING_LEGACY_SALE_RECONCILIATION_FAILED'; end if;
 end loop;
 return true;
end $$;
revoke all on function public.financial_reporting_legacy_attestation(uuid,date,date,jsonb)
 from public,anon,authenticated;
grant execute on function public.financial_reporting_legacy_attestation(uuid,date,date,jsonb)
 to authenticated;
