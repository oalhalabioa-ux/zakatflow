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
  'periodAssetOpenings',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'date',t.transaction_date,'name',a.name,'amount',t.base_value::text,'currency',t.base_currency) order by t.transaction_date,t.id),'[]'::jsonb)
   from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=t.organization_id
   where t.organization_id=p_org and a.ownership_scope='ORGANIZATION' and t.transaction_type='OPENING_BALANCE'
    and t.transaction_date>=p_fiscal_start and t.transaction_date<p_fiscal_start+interval '1 year'),
  'chart',public.financial_reporting_chart(),'source',s,'workspace',w,'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_opening_workspace(uuid,date) from public,anon;
grant execute on function public.financial_opening_workspace(uuid,date) to authenticated;


create or replace function public.financial_statement_live_context()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',o.id,'name',o.name,'currency',o.base_currency,'fiscalStart',w.fiscal_start,'fiscalEnd',(w.fiscal_start+interval '1 year'-interval '1 day')::date) order by o.name,w.fiscal_start desc),'[]'::jsonb)
 from public.organizations o join (
  select organization_id,fiscal_start from public.financial_opening_workspaces where status='APPROVED'
  union select organization_id,fiscal_start from public.financial_reporting_policies where status='APPROVED'
 ) w on w.organization_id=o.id
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
 if w.id is null then
  select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED'
   and fiscal_start<=p_from and fiscal_end>=p_to order by fiscal_start desc limit 1;
  if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
  w.fiscal_start:=pol.fiscal_start; w.currency:=pol.currency;
  s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
  if exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and fiscal_start=w.fiscal_start)
   or exists(select 1 from public.financial_events where organization_id=p_org and event_date<w.fiscal_start and status in('ACTUAL','REVERSED'))
   or exists(select 1 from public.transactions where organization_id=p_org and transaction_date<w.fiscal_start)
   or exists(select 1 from public.liquidity_flows where organization_id=p_org and due_date<w.fiscal_start and status='ACTUAL')
   or exists(select 1 from jsonb_array_elements(s->'rows') r where r->>'sourceIssue' is not null or exists(
    select 1 from jsonb_array_elements(r->'vouchers') v where (v->>'debit')::numeric<>0 or (v->>'credit')::numeric<>0))
  then raise exception 'REPORTING_PRIOR_BALANCES_REQUIRE_REVIEW';end if;
  w.approved_opening:='[{"accountCode":"1000","debit":"0","credit":"0"}]'::jsonb;
 else
  s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
  if s->>'financialRevision' is distinct from w.financial_revision then raise exception 'REPORTING_HISTORICAL_SOURCE_CHANGED';end if;
  select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED' and fiscal_start=w.fiscal_start;
 end if;
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
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',coalesce(w.id::text,'FIRST_ACTIVITY:'||w.fiscal_start::text),
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';

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
  select 'asset:'||a.id id,'assets' tab,case
    when a.asset_class_code='METALS' and a.metadata->>'holding_purpose'='INVESTMENT' then '1600'
    else '1500' end code,a.name,
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
