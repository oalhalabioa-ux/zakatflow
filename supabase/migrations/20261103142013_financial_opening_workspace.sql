-- Additive reporting opening workspace. Original registers remain authoritative.
-- A saved snapshot is audit evidence; only its supplements are new input.
create table public.financial_opening_workspaces (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 fiscal_start date not null, currency text not null check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','SUPERSEDED')),
 version integer not null default 1 check(version > 0),
 source_revision text not null, financial_revision text not null,
 source_snapshot jsonb not null, entries jsonb not null default '{}',
 approved_opening jsonb, reason text not null default '',
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id), approved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((status='DRAFT' and approved_by is null and approved_at is null and approved_opening is null)
  or (status<>'DRAFT' and approved_by is not null and approved_at is not null and approved_opening is not null))
);
create unique index financial_opening_one_draft on public.financial_opening_workspaces(organization_id,fiscal_start) where status='DRAFT';
create unique index financial_opening_one_approved on public.financial_opening_workspaces(organization_id,fiscal_start) where status='APPROVED';
create index financial_opening_org on public.financial_opening_workspaces(organization_id,fiscal_start,status);
create table public.financial_opening_audit (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.financial_opening_workspaces(id),
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references auth.users(id),
 action text not null check(action in ('SAVE','APPROVE','SUPERSEDE')), version integer not null,
 detail jsonb not null, created_at timestamptz not null default now()
);
create index financial_opening_audit_org on public.financial_opening_audit(organization_id,workspace_id,created_at);

create or replace function private.financial_opening_can(p_org uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE')
 and public.financial_core_can(p_org,p_permission)
$$;
revoke all on function private.financial_opening_can(uuid,text) from public,anon;
grant execute on function private.financial_opening_can(uuid,text) to authenticated;
alter table public.financial_opening_workspaces enable row level security;
alter table public.financial_opening_audit enable row level security;
create policy financial_opening_read on public.financial_opening_workspaces for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
create policy financial_opening_audit_read on public.financial_opening_audit for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_opening_workspaces,public.financial_opening_audit from public,anon,authenticated;
grant select on public.financial_opening_workspaces,public.financial_opening_audit to authenticated;

-- Reversed rows remain effective before the dated reversal, including allocations.
create or replace function private.financial_opening_event_active(p_org uuid,p_event uuid,p_cutoff date)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.financial_events e where e.id=p_event and e.organization_id=p_org
 and e.event_date<=p_cutoff and e.status in ('ACTUAL','REVERSED')
 and not exists(select 1 from public.financial_event_links l join public.financial_events r
 on r.id=l.event_id and r.organization_id=l.organization_id
 where l.organization_id=p_org and l.related_event_id=e.id and l.link_type='REVERSAL_OF'
 and r.status in('ACTUAL','REVERSED') and r.event_date<=p_cutoff))
$$;
revoke all on function private.financial_opening_event_active(uuid,uuid,date) from public,anon,authenticated;

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
  where cp.organization_id=p_org and (cp.active or exists(select 1 from obligations o where o.counterparty_id=cp.id and o.amount<>0))
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
 ),
 cash_rows as (
  select 'cash:'||a.id id,'cash' tab,'1000' code,a.name,
   a.current_balance_base-coalesce((select sum(m.amount) from cash_movements m where m.account_id=a.id and m.date>p_cutoff),0) amount,
   'DEBIT' normal,'liquidity_accounts:'||a.id canonical,coalesce(a.metadata->>'opening_request_id',a.id::text) reference,
   case when exists(select 1 from cash_movements m where m.account_id=a.id and m.amount is null) then 'CASH_BASE_AMOUNT_MISSING' end issue
  from public.liquidity_accounts a where a.organization_id=p_org and (a.active or a.current_balance_base<>0)
 ),
 asset_transactions as (
  select t.*,case
    when t.transaction_type::text in('OPENING_BALANCE','ADD','PURCHASE','TRANSFER_IN') then t.base_value
    when t.transaction_type::text in('SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT') then
      -coalesce((select sum(ta.value_base) from public.transaction_allocations ta where ta.transaction_id=t.id),nullif(t.metadata->>'cost_basis_base','')::numeric)
    when t.transaction_type::text='ADJUSTMENT' and t.metadata->>'reason'='DISPOSAL_ZERO_VALUE' then -coalesce(nullif(t.metadata->>'disposed_cost_base','')::numeric,t.base_value)
    when t.transaction_type::text='ADJUSTMENT' and t.metadata->>'adjustment_direction' in('IN','OUT') then t.base_value*case when t.metadata->>'adjustment_direction'='IN' then 1 else -1 end
    else null end cost
  from public.transactions t where t.organization_id=p_org and t.transaction_date<=p_cutoff
   and not coalesce((t.metadata->>'recognition_pending')::boolean,false)
   and (not (t.metadata ? 'financial_event_id') or exists(select 1 from active_events e where e.id::text=t.metadata->>'financial_event_id'))
 ),
 asset_rows as (
  select 'asset:'||a.id id,'assets' tab,'1500' code,a.name,
   (select sum(t.cost) from asset_transactions t where t.asset_account_id=a.id) amount,'DEBIT' normal,
   case when exists(select 1 from asset_transactions t where t.asset_account_id=a.id) then 'asset_accounts:'||a.id end canonical,
   a.id::text reference,
   case when exists(select 1 from asset_transactions t where t.asset_account_id=a.id and (t.cost is null or t.base_currency<>base)) then 'ASSET_COST_REVIEW_REQUIRED' end issue
  from public.asset_accounts a where a.organization_id=p_org and a.ownership_scope='ORGANIZATION'
   and a.asset_type::text not in('CASH','BANK','RECEIVABLE') and not coalesce((a.metadata->>'archived')::boolean,false)
 ),
 rows as (select * from debt_rows union all select * from missing_parties union all select * from cash_rows union all select * from asset_rows
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
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; w jsonb; base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'OPENING_ACCESS_DENIED';end if;
 if p_fiscal_start is null or p_fiscal_start>current_date+366 then raise exception 'OPENING_PERIOD_INVALID';end if;
 select base_currency into base from public.organizations where id=p_org;
 s:=private.financial_opening_sources(p_org,p_fiscal_start-1);
 select to_jsonb(t) into w from public.financial_opening_workspaces t where organization_id=p_org and fiscal_start=p_fiscal_start
  and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'cutoff',p_fiscal_start-1,'currency',base,
  'source',s,'workspace',w,'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_opening_workspace(uuid,date) from public,anon;
grant execute on function public.financial_opening_workspace(uuid,date) to authenticated;

create or replace function public.save_financial_opening(p_org uuid,p_fiscal_start date,p_expected_version integer,p_source_revision text,p_entries jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; w public.financial_opening_workspaces%rowtype; base text; k text; v jsonb; rows jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'OPENING_SAVE_DENIED';end if;
 if p_fiscal_start is null or p_fiscal_start>current_date+366 or p_expected_version is null or p_expected_version<0
  or jsonb_typeof(p_entries) is distinct from 'object' or octet_length(p_entries::text)>2000000 or length(coalesce(p_reason,''))>1000 then raise exception 'OPENING_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||p_org::text||p_fiscal_start::text,0));
 select * into w from public.financial_opening_workspaces where organization_id=p_org and fiscal_start=p_fiscal_start and status='DRAFT' for update;
 if coalesce(w.version,0)<>p_expected_version then raise exception 'OPENING_VERSION_CONFLICT';end if;
 s:=private.financial_opening_sources(p_org,p_fiscal_start-1);rows:=s->'rows';
 if s->>'revision' is distinct from p_source_revision then raise exception 'OPENING_SOURCE_CHANGED';end if;
 for k,v in select * from jsonb_each(p_entries) loop
  if not exists(select 1 from jsonb_array_elements(rows) r where r->>'id'=k)
   or jsonb_typeof(v) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(v) key where key not in('amount','side','reason'))
   or v->>'amount' is null or (v->>'amount'<>'' and v->>'amount' !~ '^\d{1,20}(\.\d{1,4})?$')
   or v->>'side' is null or v->>'side' not in('DEBIT','CREDIT') or length(coalesce(v->>'reason',''))>500
  then raise exception 'OPENING_ENTRY_INVALID';end if;
 end loop;
 select base_currency into base from public.organizations where id=p_org;
 if w.id is null then
  insert into public.financial_opening_workspaces(organization_id,fiscal_start,currency,source_revision,financial_revision,source_snapshot,entries,reason,created_by,updated_by)
   values(p_org,p_fiscal_start,base,s->>'revision',s->>'financialRevision',s,p_entries,coalesce(p_reason,''),auth.uid(),auth.uid()) returning * into w;
 else
  update public.financial_opening_workspaces set entries=p_entries,source_revision=s->>'revision',financial_revision=s->>'financialRevision',source_snapshot=s,
   reason=coalesce(p_reason,''),version=version+1,updated_by=auth.uid(),updated_at=now() where id=w.id returning * into w;
 end if;
 insert into public.financial_opening_audit(workspace_id,organization_id,actor_id,action,version,detail)
  values(w.id,p_org,auth.uid(),'SAVE',w.version,jsonb_build_object('entries',p_entries,'sourceRevision',w.source_revision,'reason',w.reason));
 return to_jsonb(w);
end $$;
revoke all on function public.save_financial_opening(uuid,date,integer,text,jsonb,text) from public,anon;
grant execute on function public.save_financial_opening(uuid,date,integer,text,jsonb,text) to authenticated;

create or replace function public.approve_financial_opening(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;s jsonb;r jsonb;v jsonb;amount numeric;total numeric:=0;opening jsonb:='[]';prior uuid;
begin
 select * into w from public.financial_opening_workspaces where id=p_id;
 if w.id is null or not private.financial_opening_can(w.organization_id,'financial_core.approve') or not private.financial_opening_can(w.organization_id,'financial_core.post') then raise exception 'OPENING_APPROVE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||w.organization_id::text||w.fiscal_start::text,0));
 select * into w from public.financial_opening_workspaces where id=p_id for update;
 -- Lock financial sources for this short approval transaction, closing the read/approve race.
 lock table public.financial_events,public.financial_event_lines,public.financial_event_links,public.financial_event_obligations,
  public.financial_event_obligation_allocations,public.liquidity_accounts,public.liquidity_counterparties,public.liquidity_flows,
  public.liquidity_settlements,public.asset_accounts,public.transactions,public.transaction_allocations,public.debt_contracts in share mode;
 perform 1 from public.organization_members where organization_id=w.organization_id and user_id=auth.uid() for share;
 if not private.financial_opening_can(w.organization_id,'financial_core.approve') or not private.financial_opening_can(w.organization_id,'financial_core.post') then raise exception 'OPENING_APPROVE_DENIED';end if;
 if w.status='APPROVED' and w.version=p_expected_version+1 then return to_jsonb(w);end if;
 if w.status<>'DRAFT' or w.version is distinct from p_expected_version then raise exception 'OPENING_VERSION_CONFLICT';end if;
 s:=private.financial_opening_sources(w.organization_id,w.fiscal_start-1);
 if s->>'revision' is distinct from w.source_revision then raise exception 'OPENING_SOURCE_CHANGED';end if;
 for r in select * from jsonb_array_elements(s->'rows') loop
  v:=w.entries->(r->>'id');
  if r->>'sourceIssue' is not null then raise exception 'OPENING_SOURCE_REVIEW_REQUIRED';end if;
  if jsonb_array_length(r->'vouchers')=0 and coalesce(v->>'amount','')='' then raise exception 'OPENING_INCOMPLETE';end if;
  amount:=coalesce((select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(r->'vouchers') a),0)
   +coalesce(nullif(v->>'amount','')::numeric,0)*case when v->>'side'='CREDIT' then -1 else 1 end;
  if (coalesce(nullif(v->>'amount','')::numeric,0)<>0 and jsonb_array_length(r->'vouchers')>0
    or amount<>0 and (amount>0)<>(r->>'normal'='DEBIT')) and length(trim(coalesce(v->>'reason','')))<3 then raise exception 'OPENING_CORRECTION_REASON_REQUIRED';end if;
  total:=total+amount;
  opening:=opening||jsonb_build_array(jsonb_build_object('itemId',r->>'id','accountCode',r->>'accountCode',
   'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text));
 end loop;
 if total<>0 then raise exception 'OPENING_UNBALANCED';end if;
 if exists(select 1 from public.financial_opening_workspaces where organization_id=w.organization_id and fiscal_start=w.fiscal_start and status='APPROVED') and length(trim(w.reason))<3 then raise exception 'OPENING_SUPERSESSION_REASON_REQUIRED';end if;
 for prior in update public.financial_opening_workspaces set status='SUPERSEDED',updated_at=now() where organization_id=w.organization_id and fiscal_start=w.fiscal_start and status='APPROVED' returning id loop
  insert into public.financial_opening_audit(workspace_id,organization_id,actor_id,action,version,detail) select prior,w.organization_id,auth.uid(),'SUPERSEDE',version,jsonb_build_object('replacement',w.id,'reason',w.reason) from public.financial_opening_workspaces where id=prior;
 end loop;
 update public.financial_opening_workspaces set status='APPROVED',approved_opening=opening,approved_by=auth.uid(),approved_at=now(),
  updated_by=auth.uid(),updated_at=now(),version=version+1 where id=w.id returning * into w;
 insert into public.financial_opening_audit(workspace_id,organization_id,actor_id,action,version,detail)
 values(w.id,w.organization_id,auth.uid(),'APPROVE',w.version,jsonb_build_object('opening',opening,'sourceRevision',w.source_revision,'reason',w.reason));
 return to_jsonb(w);
end $$;
revoke all on function public.approve_financial_opening(uuid,integer) from public,anon;
grant execute on function public.approve_financial_opening(uuid,integer) to authenticated;

