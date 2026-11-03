-- Legacy actual registers use explicit source identities and reviewed posting rules.
-- They never use forecasts, market prices, or a second copy of integrated events.
create or replace function private.financial_reporting_legacy_events(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from public.liquidity_flows f where f.organization_id=p_org and f.status='ACTUAL' and f.due_date between p_from and p_to and (f.base_amount is null or f.base_amount<=0)) then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 with flows as (
  select f.*,case when f.direction='INFLOW' then f.base_amount else -f.base_amount end signed
  from public.liquidity_flows f where f.organization_id=p_org and f.status='ACTUAL' and f.due_date between p_from and p_to
   and not exists(select 1 from public.liquidity_flow_settlement_allocations a join public.liquidity_settlements s on s.id=a.settlement_id and s.organization_id=p_org where a.organization_id=p_org and a.flow_id=f.id and s.status in('POSTED','REVERSED'))
   and not exists(select 1 from public.financial_core_cash_event_flow_links l join public.financial_events e on e.id=l.financial_event_id and e.organization_id=p_org
    where l.organization_id=p_org and l.liquidity_flow_id=f.id and e.status in('ACTUAL','REVERSED')
    and (exists(select 1 from public.liquidity_settlements s where s.financial_event_id=e.id and s.organization_id=p_org)
     or exists(select 1 from public.financial_event_lines fl where fl.event_id=e.id and fl.organization_id=p_org and fl.cash_direction<>'NON_CASH')))
 ), cash_events as (
  select jsonb_build_object('id','flow:'||f.id,'organizationId',p_org,'currency',o.base_currency,'date',f.due_date,'eventType','ADJUSTMENT',
   'sourceModule','LEGACY_CASH','sourceKey',f.id,'status','ACTUAL','lines',jsonb_build_array(jsonb_build_object('id','flow:'||f.id,
    'classificationId',coalesce(f.category_id::text,f.flow_type)||':CASH','baseAmount',f.base_amount::numeric(24,4)::text,'cashDirection',f.direction,'recognitionSign',1))) event
  from flows f join public.organizations o on o.id=p_org where f.transfer_id is null and f.intercompany_transfer_id is null
  union all
  select jsonb_build_object('id','transfer:'||coalesce(f.transfer_id,f.intercompany_transfer_id),'organizationId',p_org,'currency',o.base_currency,
   'date',max(f.due_date),'eventType','TRANSFER','sourceModule','LEGACY_CASH','sourceKey',coalesce(f.transfer_id,f.intercompany_transfer_id),'status','ACTUAL',
   'lines',jsonb_build_array(jsonb_build_object('id','transfer:'||coalesce(f.transfer_id,f.intercompany_transfer_id),'classificationId','TRANSFER_DIFFERENCE:CASH',
    'baseAmount',abs(sum(f.signed))::numeric(24,4)::text,'cashDirection',case when sum(f.signed)>0 then 'INFLOW' else 'OUTFLOW' end,'recognitionSign',1)))
  from flows f join public.organizations o on o.id=p_org where f.transfer_id is not null or f.intercompany_transfer_id is not null
  group by coalesce(f.transfer_id,f.intercompany_transfer_id),o.base_currency having sum(f.signed)<>0
 ), tx as (
  select t.*,a.asset_type,a.asset_class_code,
   case when t.transaction_type::text in('OPENING_BALANCE','ADD','PURCHASE','TRANSFER_IN') then t.base_value
    when t.transaction_type::text in('SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT') then coalesce((select sum(ta.value_base) from public.transaction_allocations ta where ta.transaction_id=t.id),nullif(t.metadata->>'cost_basis_base','')::numeric)
    when t.transaction_type::text='ADJUSTMENT' then abs(coalesce(nullif(t.metadata->>'asset_effect_base','')::numeric,nullif(t.metadata->>'cost_basis_base','')::numeric,t.base_value)) end book_amount
  from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=p_org
  where t.organization_id=p_org and t.transaction_date between p_from and p_to and a.asset_type::text not in('CASH','BANK','RECEIVABLE')
   and not coalesce((t.metadata->>'recognition_pending')::boolean,false)
   and not (t.metadata ? 'financial_event_id')
   and not exists(select 1 from public.financial_events e where e.organization_id=p_org and e.source_record_id=t.id)
   and not exists(select 1 from public.financial_event_links l join public.financial_events e on e.id=l.event_id and e.organization_id=p_org where l.organization_id=p_org and l.target_module='transactions' and l.target_record_id=t.id)
 ), asset_events as (
  select jsonb_build_object('id','transaction:'||t.id,'organizationId',p_org,'currency',t.base_currency,'date',t.transaction_date,
    'eventType','ADJUSTMENT','sourceModule','LEGACY_ASSET','sourceKey',t.id,'status','ACTUAL',
    'lines',jsonb_build_array(jsonb_build_object('id','transaction:'||t.id||':BOOK','classificationId',coalesce(t.asset_class_code,t.asset_type::text)||':'||t.transaction_type::text||':BOOK',
      'baseAmount',t.book_amount::numeric(24,4)::text,'cashDirection','NON_CASH','recognitionSign',1))
     ||case when t.transaction_type::text='SALE' then jsonb_build_array(jsonb_build_object('id','transaction:'||t.id||':PROCEEDS',
      'classificationId',coalesce(t.asset_class_code,t.asset_type::text)||':SALE:PROCEEDS','baseAmount',t.base_value::numeric(24,4)::text,'cashDirection','NON_CASH','recognitionSign',1)) else '[]'::jsonb end) event
  from tx t where t.book_amount>0
 ), invalid as (select 1 from tx where book_amount is null or transaction_type::text='REVERSAL')
 select case when exists(select 1 from invalid) then null else coalesce(jsonb_agg(event order by event->>'id'),'[]'::jsonb) end into result
 from (select * from cash_events union all select * from asset_events) events;
 if result is null then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 return result;
end $$;
revoke all on function private.financial_reporting_legacy_events(uuid,date,date) from public,anon,authenticated;
