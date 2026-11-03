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

create or replace function private.financial_opening_sources(p_org uuid,p_cutoff date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; base text;
begin
 select base_currency into base from public.organizations where id=p_org;
 with
 active_events as (select e.* from public.financial_events e where e.organization_id=p_org
   and private.financial_opening_event_active(p_org,e.id,p_cutoff)),
 obligations as (
  select o.id,o.event_id,o.obligation_type,e.counterparty_id,
   (o.settleable_base_amount+coalesce((select sum(a.settleable_base_amount*case when a.adjustment_effect='DECREASE' then -1 else 1 end)
    from public.financial_event_obligations a join active_events ae on ae.id=a.event_id
    where a.organization_id=p_org and a.adjusts_obligation_id=o.id),0)
   -coalesce((select sum(a.base_amount) from public.financial_event_obligation_allocations a join active_events ae on ae.id=a.application_event_id
    where a.organization_id=p_org and (case when o.obligation_type in('RECEIVABLE','PAYABLE') then a.obligation_id=o.id else a.source_advance_obligation_id=o.id end)),0)) amount,
   case when o.base_currency<>base then 'SOURCE_CURRENCY_MISMATCH' end issue
  from public.financial_event_obligations o join active_events e on e.id=o.event_id
  where o.organization_id=p_org and o.adjusts_obligation_id is null
 ),
 debt_rows as (
  select 'debt:'||o.id id,
   case when c.id is not null then 'loans' when o.obligation_type in('CUSTOMER_ADVANCE','SUPPLIER_ADVANCE') then 'advances'
    when o.obligation_type='PAYABLE' then 'suppliers' else 'customers' end tab,
   case when c.id is not null then case when o.obligation_type='PAYABLE' then '2200' else '1200' end
    when o.obligation_type='CUSTOMER_ADVANCE' then '2400' when o.obligation_type='SUPPLIER_ADVANCE' then '1300'
    when o.obligation_type='PAYABLE' then '2100' else '1100' end code,
   coalesce(c.description,cp.name,e.description) name,
   case when o.obligation_type in('PAYABLE','CUSTOMER_ADVANCE') then -o.amount else o.amount end amount,
   case when o.obligation_type in('PAYABLE','CUSTOMER_ADVANCE') then 'CREDIT' else 'DEBIT' end normal,
   'financial_event_obligations:'||o.id canonical, e.source_event_key reference,
   case when o.obligation_type not in('RECEIVABLE','PAYABLE','CUSTOMER_ADVANCE','SUPPLIER_ADVANCE') then 'UNSUPPORTED_OBLIGATION_TYPE'
    when o.amount<0 then 'NEGATIVE_OBLIGATION_REQUIRES_REVIEW' else o.issue end issue
  from obligations o join active_events e on e.id=o.event_id
  left join public.liquidity_counterparties cp on cp.id=o.counterparty_id and cp.organization_id=p_org
  left join public.debt_contracts c on c.financial_event_id=e.id and c.organization_id=p_org and c.deleted_at is null
 ),
 missing_parties as (
  select 'party:'||cp.id||':'||side id,case when side='DEBIT' then 'customers' else 'suppliers' end tab,
   case when side='DEBIT' then '1100' else '2100' end code,cp.name,null::numeric amount,side normal,null::text canonical,null::text reference,null::text issue
  from public.liquidity_counterparties cp cross join lateral
   (select 'DEBIT'::text side where cp.party_type not in('SUPPLIER','VENDOR')
    union all select 'CREDIT' where cp.party_type not in('CUSTOMER','CLIENT')) sides
  where cp.organization_id=p_org
   and not exists(select 1 from obligations o where o.counterparty_id=cp.id
    and (case when side='DEBIT' then o.obligation_type='RECEIVABLE' else o.obligation_type='PAYABLE' end))
 ),
 cash_movements as (
  select s.account_id,s.settlement_date date,s.base_amount*case when s.direction='INFLOW' then 1 else -1 end amount
  from public.liquidity_settlements s where s.organization_id=p_org and s.status in('POSTED','REVERSED')
  union all
  select f.account_id,f.due_date,f.base_amount*case when f.direction='INFLOW' then 1 else -1 end
  from public.liquidity_flows f where f.organization_id=p_org and f.status='ACTUAL'
   and not exists(select 1 from public.financial_core_cash_event_flow_links l join public.liquidity_settlements s
     on s.financial_event_id=l.financial_event_id and s.organization_id=p_org
     where l.organization_id=p_org and l.liquidity_flow_id=f.id)
   and not exists(select 1 from public.liquidity_flow_settlement_allocations a join public.liquidity_settlements s on s.id=a.settlement_id and s.organization_id=p_org where a.organization_id=p_org and a.flow_id=f.id and s.status in('POSTED','REVERSED'))
 ),
 cash_rows as (
  select 'cash:'||a.id id,'cash' tab,'1000' code,a.name,
   case when coalesce(nullif(a.metadata->>'opening_date','')::date,a.created_at::date)>p_cutoff then null else a.current_balance_base-coalesce((select sum(m.amount) from cash_movements m where m.account_id=a.id and m.date>p_cutoff),0) end amount,
   'DEBIT' normal,'liquidity_accounts:'||a.id canonical,coalesce(a.metadata->>'opening_request_id',a.id::text) reference,
   case when exists(select 1 from cash_movements m where m.account_id=a.id and m.amount is null) then 'CASH_BASE_AMOUNT_MISSING' end issue
  from public.liquidity_accounts a where a.organization_id=p_org and (a.active or a.current_balance_base<>0)
 ),
 asset_books as (
  select a.*,private.financial_opening_asset_book(p_org,a.id,p_cutoff) book from public.asset_accounts a
  where a.organization_id=p_org and a.ownership_scope='ORGANIZATION'
   and a.asset_type::text not in('CASH','BANK','RECEIVABLE') and not coalesce((a.metadata->>'archived')::boolean,false)
 ), asset_rows as (
  select 'asset:'||a.id id,'assets' tab,'1500' code,a.name,
   case when (book->>'known')::boolean then (book->>'gross')::numeric end amount,'DEBIT' normal,
   case when (book->>'known')::boolean then 'asset_accounts:'||a.id||':COST' end canonical,a.id::text reference,book->>'issue' issue
  from asset_books a
  union all
  select 'depreciation:'||a.id,'assets','1590',a.name||' · مجمع الإهلاك',
   case when (book->>'known')::boolean then -(book->>'depreciation')::numeric end,'CREDIT',
   case when (book->>'known')::boolean then 'asset_accounts:'||a.id||':DEPRECIATION' end,a.id::text,book->>'issue'
  from asset_books a
 ),
 legacy_account_rows as (
  select 'legacy-account:'||a.id id,case when a.asset_type::text='RECEIVABLE' then 'customers' else 'cash' end tab,
   case when a.asset_type::text='RECEIVABLE' then '1100' else '1000' end code,a.name,
   case when (b.book->>'known')::boolean then (b.book->>'gross')::numeric-(b.book->>'depreciation')::numeric end amount,
   'DEBIT' normal,case when (b.book->>'known')::boolean then 'asset_accounts:'||a.id||':LEGACY' end canonical,a.id::text reference,
   coalesce(b.book->>'issue',case when (b.book->>'known')::boolean and (b.book->>'gross')::numeric<>(b.book->>'depreciation')::numeric then 'CANONICAL_ACCOUNT_LINK_REQUIRED' end) issue
  from public.asset_accounts a cross join lateral(select private.financial_opening_asset_book(p_org,a.id,p_cutoff) book) b
  where a.organization_id=p_org and a.ownership_scope='ORGANIZATION' and a.asset_type::text in('CASH','BANK','RECEIVABLE')
   and not coalesce((a.metadata->>'archived')::boolean,false)
 ),
 rows as (select * from debt_rows union all select * from missing_parties union all select * from cash_rows union all select * from asset_rows union all select * from legacy_account_rows
  union all select 'equity:'||v.code,'equity',v.code,v.name,null::numeric,'CREDIT',null::text,null::text,null::text
    from (values('3100','رأس المال'),('3200','الاحتياطيات'),('3300','الأرباح المحتجزة')) v(code,name))
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'tab',tab,'accountCode',code,'accountAr',name,'accountEn',name,'ar',name,'en',name,'normal',normal,
   'sourceIssue',issue,'vouchers',case when amount is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('canonicalId',canonical,
   'number',reference,'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text)) end) order by id),'[]'::jsonb)
 into result from rows;
 if jsonb_array_length(result)>20000 then raise exception 'OPENING_SOURCE_TOO_LARGE';end if;
 return jsonb_build_object('rows',result,'revision',md5(result::text),'financialRevision',md5((select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','vouchers',r->'vouchers','issue',r->'sourceIssue') order by r->>'id'),'[]') from jsonb_array_elements(result) r where jsonb_array_length(r->'vouchers')>0 or r->>'sourceIssue' is not null)::text));
end $$;
revoke all on function private.financial_opening_sources(uuid,date) from public,anon,authenticated;

create or replace function public.financial_opening_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; w jsonb; base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'OPENING_ACCESS_DENIED';end if;
 if p_fiscal_start is null or p_fiscal_start>current_date+366 then raise exception 'OPENING_PERIOD_INVALID';end if;
 select base_currency into base from public.organizations where id=p_org;
 s:=private.financial_opening_sources(p_org,p_fiscal_start-1);
 select to_jsonb(t) into w from public.financial_opening_workspaces t where organization_id=p_org and fiscal_start=p_fiscal_start
  and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'cutoff',p_fiscal_start-1,'currency',base,
  'chart',public.financial_reporting_chart(),'source',s,'workspace',w,'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_opening_workspace(uuid,date) from public,anon;
grant execute on function public.financial_opening_workspace(uuid,date) to authenticated;


create or replace function private.financial_reporting_events(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=p_org where t.organization_id=p_org and t.transaction_date between p_from and p_to and a.asset_type::text in('CASH','BANK','RECEIVABLE') and not (t.metadata ? 'financial_event_id') and not exists(select 1 from public.financial_event_links l where l.organization_id=p_org and l.target_module='transactions' and l.target_record_id=t.id)) then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
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
   case when coalesce(l.metadata->>'source_role',ol.metadata->>'source_role')='INPUT_VAT' then coalesce(nullif(l.metadata->>'recoverable_percent','')::numeric,nullif(ol.metadata->>'recoverable_percent','')::numeric,l.recoverable_percent,100) else 100 end recovery
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
returns jsonb language plpgsql stable security definer set search_path='' as $$
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

create or replace function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;pol public.financial_reporting_policies%rowtype;s jsonb;events jsonb;accounts jsonb;rules jsonb;opening jsonb;closing_cash numeric;opening_cash numeric;original_cash numeric;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into w from public.financial_opening_workspaces where organization_id=p_org and status='APPROVED' and fiscal_start<=p_from and p_to<(fiscal_start+interval '1 year') order by fiscal_start desc limit 1;
 if w.id is null then raise exception 'REPORTING_APPROVED_OPENING_REQUIRED';end if;
 s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
 if s->>'financialRevision' is distinct from w.financial_revision then raise exception 'REPORTING_HISTORICAL_SOURCE_CHANGED';end if;
 select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED' and fiscal_start=w.fiscal_start;
 if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
 events:=private.financial_reporting_events(p_org,w.fiscal_start,pol.fiscal_end);
 select jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',w.currency)) into accounts from jsonb_array_elements(public.financial_reporting_chart()) a;
 select jsonb_agg(jsonb_build_object('accountId',code,'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text)) into opening from
  (select r->>'accountCode' code,sum((r->>'debit')::numeric-(r->>'credit')::numeric) amount from jsonb_array_elements(w.approved_opening) r group by r->>'accountCode') t;
 select coalesce(jsonb_agg(r||jsonb_build_object('id',pol.id::text||':'||ord,'organizationId',p_org,'currency',pol.currency,'from',pol.fiscal_start,'to',pol.fiscal_end)),'[]'::jsonb) into rules from jsonb_array_elements(pol.rules) with ordinality x(r,ord);
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0) into original_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 select coalesce(sum((r->>'debit')::numeric-(r->>'credit')::numeric),0) into opening_cash from jsonb_array_elements(w.approved_opening) r where r->>'accountCode'='1000';
 s:=private.financial_opening_sources(p_org,p_to);
 if exists(select 1 from jsonb_array_elements(s->'rows') r where r->>'tab'='cash' and r->>'sourceIssue' is not null) then raise exception 'REPORTING_CASH_RECONCILIATION_REQUIRED';end if;
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0)+opening_cash-original_cash into closing_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',w.id,
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
