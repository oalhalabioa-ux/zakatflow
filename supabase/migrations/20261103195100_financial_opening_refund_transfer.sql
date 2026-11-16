create or replace function private.financial_opening_sources(p_org uuid,p_cutoff date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; base text;
begin
 select base_currency into base from public.organizations where id=p_org;
 with
 active_events as (select e.* from public.financial_events e where e.organization_id=p_org
   and private.financial_opening_event_active(p_org,e.id,p_cutoff)),
 -- The posted note transfers only the excess credit to a separate refund obligation.
 refund_transfers as (
  select adj.adjusts_obligation_id, sum(refund.settleable_base_amount) amount
  from public.financial_event_obligations adj
  join active_events e on e.id=adj.event_id
  join public.financial_event_obligations refund on refund.organization_id=adj.organization_id
   and refund.event_id=adj.event_id and refund.obligation_key='note-refund'
  where adj.organization_id=p_org and adj.obligation_key='note-adjustment'
   and adj.adjustment_effect='DECREASE' and adj.adjusts_obligation_id is not null
  group by adj.adjusts_obligation_id
 ),
 obligations as (
  select o.id,o.event_id,o.obligation_type,e.counterparty_id,
   (o.settleable_base_amount+coalesce(rt.amount,0)+coalesce((select sum(a.settleable_base_amount*case when a.adjustment_effect='DECREASE' then -1 else 1 end)
    from public.financial_event_obligations a join active_events ae on ae.id=a.event_id
    where a.organization_id=p_org and a.adjusts_obligation_id=o.id),0)
   -coalesce((select sum(a.base_amount) from public.financial_event_obligation_allocations a join active_events ae on ae.id=a.application_event_id
    where a.organization_id=p_org and (case when o.obligation_type in('RECEIVABLE','PAYABLE') then a.obligation_id=o.id else a.source_advance_obligation_id=o.id end)),0)) amount,
   case when o.base_currency<>base then 'SOURCE_CURRENCY_MISMATCH' end issue
  from public.financial_event_obligations o join active_events e on e.id=o.event_id
  left join refund_transfers rt on rt.adjusts_obligation_id=o.id
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
    from normalized l where l.event_id=e.id),'[]'::jsonb)
    ||coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id::text||':refund:'||refund.id::text,
      'classificationId','VAT_NOTE_REFUND_'||refund.obligation_type::text,
      'baseAmount',refund.settleable_base_amount::numeric(24,4)::text,
      'cashDirection','NON_CASH','recognitionSign',case when e.original_id is null then 1 else -1 end
    ) order by refund.id)
    from public.financial_event_obligations refund
    where refund.organization_id=p_org and refund.event_id=coalesce(e.original_id,e.id)
      and refund.obligation_key='note-refund' and refund.settleable_base_amount>0),'[]'::jsonb))
    ||case when e.original_id is not null and e.original_date>=p_from then jsonb_build_object('reversesEventId',e.original_id) else '{}' end order by e.event_date,e.id),'[]'::jsonb)
 into result from source e;
 if jsonb_array_length(result)>10000 then raise exception 'REPORTING_SOURCE_TOO_LARGE';end if;
 return result||private.financial_reporting_legacy_events(p_org,p_from,p_to);
end $$;
revoke all on function private.financial_reporting_events(uuid,date,date) from public,anon,authenticated;
