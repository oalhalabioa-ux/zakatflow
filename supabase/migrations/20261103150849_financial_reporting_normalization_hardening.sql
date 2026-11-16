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
    'lines',case when t.book_amount>0 then jsonb_build_array(jsonb_build_object('id','transaction:'||t.id||':BOOK','classificationId',coalesce(t.asset_class_code,t.asset_type::text)||':'||t.transaction_type::text||':'||coalesce(t.metadata->>'operation',t.metadata->>'reason',t.metadata->>'adjustment_direction','BASE')||':BOOK',
      'baseAmount',t.book_amount::numeric(24,4)::text,'cashDirection','NON_CASH','recognitionSign',1)) else '[]'::jsonb end
     ||case when t.transaction_type::text='SALE' then jsonb_build_array(jsonb_build_object('id','transaction:'||t.id||':PROCEEDS',
      'classificationId',coalesce(t.asset_class_code,t.asset_type::text)||':SALE:PROCEEDS','baseAmount',t.base_value::numeric(24,4)::text,'cashDirection','NON_CASH','recognitionSign',1)) else '[]'::jsonb end) event
  from tx t where t.book_amount>0 or t.book_amount=0 and t.transaction_type::text='SALE' and t.base_value>0
 ), invalid as (select 1 from tx where book_amount is null or transaction_type::text='REVERSAL')
 select case when exists(select 1 from invalid) then null else coalesce(jsonb_agg(event order by event->>'id'),'[]'::jsonb) end into result
 from (select * from cash_events union all select * from asset_events) events;
 if result is null then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 return result;
end $$;
revoke all on function private.financial_reporting_legacy_events(uuid,date,date) from public,anon,authenticated;

create or replace function private.financial_reporting_events(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from public.financial_events e join public.financial_event_lines l on l.event_id=e.id and l.organization_id=p_org
   where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
   and (l.vat_amount<>0 or l.base_amount<=0 or l.base_amount<>round(l.base_amount,4)
    or round(l.amount*l.exchange_rate,4)<>l.base_amount or coalesce(l.metadata->>'recognition_sign','1') not in('1','-1')))
 then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 with source as (
  select e.*,orig.id original_id,orig.event_date original_date,
   coalesce(orig.event_type,e.event_type) posting_type,coalesce(orig.source_module,e.source_module) posting_module
  from public.financial_events e left join public.financial_event_links rl on rl.event_id=e.id and rl.organization_id=p_org and rl.link_type='REVERSAL_OF'
   left join public.financial_events orig on orig.id=rl.related_event_id and orig.organization_id=p_org
  where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
 ), line_parts as (
  select l.*,coalesce(l.metadata->>'source_role',ol.metadata->>'source_role','BASE') source_role,case when e.original_id is not null then -coalesce((ol.metadata->>'recognition_sign')::int,1) else coalesce((l.metadata->>'recognition_sign')::int,1) end normalized_sign,
   case when l.metadata->>'source_role'='INPUT_VAT' then coalesce(nullif(l.metadata->>'recoverable_percent','')::numeric,l.recoverable_percent,100) else 100 end recovery
  from public.financial_event_lines l join source e on e.id=l.event_id left join public.financial_event_lines ol on ol.event_id=e.original_id and ol.organization_id=p_org and ol.line_number=l.line_number where l.organization_id=p_org
 ), normalized as (
  select l.*,v.part,v.amount part_amount from line_parts l cross join lateral (
    select case when l.source_role='INPUT_VAT' then 'INPUT_VAT_RECOVERABLE' else l.source_role end part,
      round(l.base_amount*l.recovery/100,4) amount
    union all select 'INPUT_VAT_NONRECOVERABLE',l.base_amount-round(l.base_amount*l.recovery/100,4) where l.source_role='INPUT_VAT' and l.recovery<100
  ) v where v.amount>0
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'organizationId',e.organization_id,'currency',e.base_currency,
  'date',e.event_date,'eventType',e.posting_type,'sourceModule',e.posting_module,'sourceKey',e.source_event_key,
  'status',case when e.status='REVERSED' and exists(select 1 from public.financial_event_links fl join public.financial_events re on re.id=fl.event_id and re.organization_id=p_org where fl.organization_id=p_org and fl.link_type='REVERSAL_OF' and fl.related_event_id=e.id and re.status in('ACTUAL','REVERSED') and re.event_date>p_to) then 'ACTUAL' else e.status end,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id::text||':'||l.part,
    'classificationId',l.classification_id::text||':'||l.part,'baseAmount',l.part_amount::numeric(24,4)::text,
    'cashDirection',l.cash_direction,'recognitionSign',l.normalized_sign) order by l.line_number,l.part)
    from normalized l where l.event_id=e.id),'[]'::jsonb))
    ||case when e.original_id is not null and e.original_date>=p_from then jsonb_build_object('reversesEventId',e.original_id) else '{}' end order by e.event_date,e.id),'[]'::jsonb)
 into result from source e;
 if jsonb_array_length(result)>10000 then raise exception 'REPORTING_SOURCE_TOO_LARGE';end if;
 return result||private.financial_reporting_legacy_events(p_org,p_from,p_to);
end $$;
revoke all on function private.financial_reporting_events(uuid,date,date) from public,anon,authenticated;

create or replace function public.financial_reporting_policy_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;pol jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 select to_jsonb(p) into pol from public.financial_reporting_policies p where organization_id=p_org and fiscal_start=p_fiscal_start and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 result:=private.financial_reporting_events(p_org,p_fiscal_start,(p_fiscal_start+interval '1 year'-interval '1 day')::date);
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'chart',public.financial_reporting_chart(),'classifications',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.financial_classifications where organization_id=p_org),'policy',pol,
  'events',result,'canSave',private.financial_opening_can(p_org,'financial_core.create'),'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_reporting_policy_workspace(uuid,date) from public,anon;
grant execute on function public.financial_reporting_policy_workspace(uuid,date) to authenticated;


create or replace function public.financial_statement_live_context()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',o.id,'name',o.name,'currency',o.base_currency,'fiscalStart',w.fiscal_start,'fiscalEnd',(w.fiscal_start+interval '1 year'-interval '1 day')::date) order by o.name,w.fiscal_start desc),'[]'::jsonb)
 from public.organizations o join public.financial_opening_workspaces w on w.organization_id=o.id and w.status='APPROVED'
 where private.financial_opening_can(o.id,'financial_core.view')
$$;
revoke all on function public.financial_statement_live_context() from public,anon;
grant execute on function public.financial_statement_live_context() to authenticated;

