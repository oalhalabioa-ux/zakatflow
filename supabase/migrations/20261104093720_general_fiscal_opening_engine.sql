-- General fiscal engine v1. Existing customer data and approvals are preserved.
create table public.financial_fiscal_calendars (
 organization_id uuid primary key references public.organizations(id),
 start_month smallint not null check(start_month between 1 and 12),
 start_day smallint not null check(start_day between 1 and 31),
 retained_earnings_account text not null,
 version integer not null default 1, rule_version text not null default 'FISCAL_V1' check(rule_version='FISCAL_V1'),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create table public.financial_opening_source_assignments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 source_table text not null check(source_table in('transactions','liquidity_accounts','financial_event_obligations')),
 source_id uuid not null, fiscal_start date not null, effective_date date not null,
 transaction_date date not null, recorded_at timestamptz not null default now(),
 declared_amount numeric(24,4), reason text not null check(length(trim(reason)) between 3 and 1000),
 created_by uuid not null references auth.users(id), rule_version text not null default 'FISCAL_V1',
 unique(organization_id,source_table,source_id),check(effective_date=fiscal_start),
 check(declared_amount is null or declared_amount>=0)
);
create table public.financial_year_closures (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 fiscal_start date not null,fiscal_end date not null,next_start date not null,
 currency text not null,version integer not null,rule_version text not null default 'FISCAL_V1',
 status text not null check(status in('CLOSED','SUPERSEDED')),request_id uuid not null,
 source_revision text not null,source_snapshot jsonb not null,trial_balance jsonb not null,next_opening jsonb not null,
 reason text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(organization_id,request_id),unique(organization_id,fiscal_start,version),check(next_start=fiscal_end+1)
);
create unique index financial_year_one_close on public.financial_year_closures(organization_id,fiscal_start) where status='CLOSED';
create table public.financial_fiscal_audit (
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),
 action text not null,actor_id uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
 detail jsonb not null,rule_version text not null default 'FISCAL_V1'
);
create index fiscal_assignment_source on public.financial_opening_source_assignments(organization_id,fiscal_start);
create index fiscal_close_next on public.financial_year_closures(organization_id,next_start) where status='CLOSED';
create index fiscal_audit_org on public.financial_fiscal_audit(organization_id,recorded_at);

alter table public.financial_fiscal_calendars enable row level security;
alter table public.financial_opening_source_assignments enable row level security;
alter table public.financial_year_closures enable row level security;
alter table public.financial_fiscal_audit enable row level security;
create policy fiscal_calendar_read on public.financial_fiscal_calendars for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
create policy fiscal_assignment_read on public.financial_opening_source_assignments for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
create policy fiscal_close_read on public.financial_year_closures for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
create policy fiscal_audit_read on public.financial_fiscal_audit for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_fiscal_calendars,public.financial_opening_source_assignments,public.financial_year_closures,public.financial_fiscal_audit from anon,authenticated;
grant select on public.financial_fiscal_calendars,public.financial_opening_source_assignments,public.financial_year_closures,public.financial_fiscal_audit to authenticated;

create function private.financial_fiscal_period(p_org uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare c public.financial_fiscal_calendars%rowtype;start date;nextdate date;
begin
 select * into c from public.financial_fiscal_calendars where organization_id=p_org;
 if c.organization_id is null then raise exception 'FISCAL_CALENDAR_REQUIRED';end if;
 if p_date is null then raise exception 'FISCAL_DATE_REQUIRED';end if;
 start:=(make_date(extract(year from p_date)::int,c.start_month,1)+least(c.start_day,extract(day from (make_date(extract(year from p_date)::int,c.start_month,1)+interval '1 month'-interval '1 day'))::int)-1);
 if start>p_date then start:=(make_date(extract(year from p_date)::int-1,c.start_month,1)+least(c.start_day,extract(day from (make_date(extract(year from p_date)::int-1,c.start_month,1)+interval '1 month'-interval '1 day'))::int)-1);end if;
 nextdate:=make_date(extract(year from start)::int+1,c.start_month,1)+least(c.start_day,extract(day from (make_date(extract(year from start)::int+1,c.start_month,1)+interval '1 month'-interval '1 day'))::int)-1;
 return jsonb_build_object('start',start,'end',nextdate-1,'nextStart',nextdate,'ruleVersion',c.rule_version,'calendarVersion',c.version);
end $$;
revoke all on function private.financial_fiscal_period(uuid,date) from public,anon,authenticated;

create function public.financial_fiscal_context(p_org uuid,p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare c jsonb;period jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'FISCAL_ACCESS_DENIED';end if;
 select to_jsonb(t) into c from public.financial_fiscal_calendars t where organization_id=p_org;
 if c is not null then period:=private.financial_fiscal_period(p_org,p_as_of);end if;
 return jsonb_build_object('organizationId',p_org,'calendar',c,'period',period,
 'closures',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'start',fiscal_start,'end',fiscal_end,'version',version,'status',status) order by fiscal_start desc,version desc),'[]') from public.financial_year_closures where organization_id=p_org),
 'canConfigure',private.financial_opening_can(p_org,'financial_core.create'));
end $$;
revoke all on function public.financial_fiscal_context(uuid,date) from public,anon;
grant execute on function public.financial_fiscal_context(uuid,date) to authenticated;

create function public.save_financial_fiscal_calendar(p_org uuid,p_month integer,p_day integer,p_retained text,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c public.financial_fiscal_calendars%rowtype;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 if p_month is null or p_month not between 1 and 12 or p_day is null or p_day not between 1 and 31 or length(trim(coalesce(p_reason,''))) not between 3 and 1000
 or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=p_retained and a->>'kind'='EQUITY') then raise exception 'FISCAL_CALENDAR_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal-calendar:'||p_org,0));
 select * into c from public.financial_fiscal_calendars where organization_id=p_org for update;
 if coalesce(c.version,0) is distinct from p_expected_version then raise exception 'FISCAL_VERSION_CONFLICT';end if;
 if c.organization_id is not null and (c.start_month<>p_month or c.start_day<>p_day or c.retained_earnings_account<>p_retained)
 and (exists(select 1 from public.financial_opening_workspaces where organization_id=p_org) or exists(select 1 from public.financial_reporting_policies where organization_id=p_org) or exists(select 1 from public.financial_opening_source_assignments where organization_id=p_org) or exists(select 1 from public.financial_year_closures where organization_id=p_org)) then raise exception 'FISCAL_CALENDAR_IN_USE';end if;
 if exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and (extract(month from fiscal_start)<>p_month or extract(day from fiscal_start)<>p_day))
 or exists(select 1 from public.financial_reporting_policies where organization_id=p_org and (extract(month from fiscal_start)<>p_month or extract(day from fiscal_start)<>p_day)) then raise exception 'FISCAL_LEGACY_PERIOD_REVIEW_REQUIRED';end if;
 insert into public.financial_fiscal_calendars(organization_id,start_month,start_day,retained_earnings_account,updated_by)
 values(p_org,p_month,p_day,p_retained,auth.uid()) on conflict(organization_id) do update set start_month=excluded.start_month,start_day=excluded.start_day,retained_earnings_account=excluded.retained_earnings_account,version=financial_fiscal_calendars.version+1,updated_by=auth.uid(),updated_at=now() returning * into c;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'CALENDAR_SAVE',auth.uid(),jsonb_build_object('calendar',to_jsonb(c),'reason',p_reason));
 return to_jsonb(c);
end $$;
revoke all on function public.save_financial_fiscal_calendar(uuid,integer,integer,text,integer,text) from public,anon;
grant execute on function public.save_financial_fiscal_calendar(uuid,integer,integer,text,integer,text) to authenticated;

alter table public.financial_opening_source_assignments add column account_code text not null;

-- Tab routing belongs to the shared approved reporting chart, never to an organization.
create function private.financial_opening_tab(p_account text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when a->>'kind'='EQUITY' then 'equity' when a->>'cash'='true' then 'cash'
  when p_account='1100' then 'customers' when p_account='2100' then 'suppliers'
  when p_account in('1200','2200') then 'loans' when p_account='1300' then 'advances'
  when p_account in('1500','1590') then 'assets' else 'other' end
 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=p_account
$$;
revoke all on function private.financial_opening_tab(text) from public,anon,authenticated;

create function private.financial_resolve_opening(p_org uuid,p_table text,p_id uuid,p_amount numeric,p_account text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare t public.transactions%rowtype;a public.asset_accounts%rowtype;b public.liquidity_accounts%rowtype;o public.financial_event_obligations%rowtype;amount numeric;side text:='DEBIT';dt date;tab text;item text;name text;ccy text;recorded timestamptz;
begin
 if p_table='transactions' then
  select * into t from public.transactions where organization_id=p_org and id=p_id and transaction_type='OPENING_BALANCE';
  select * into a from public.asset_accounts where organization_id=p_org and id=t.asset_account_id and ownership_scope='ORGANIZATION' and not coalesce((metadata->>'archived')::boolean,false);
  if t.id is null or a.id is null or coalesce((t.metadata->>'recognition_pending')::boolean,false) or exists(select 1 from public.transactions r where r.organization_id=p_org and r.reversal_of_transaction_id=t.id) then raise exception 'FISCAL_SOURCE_REVIEW_REQUIRED';end if;
  amount:=t.base_value;dt:=t.transaction_date;tab:=private.financial_opening_tab(p_account);item:=case when a.asset_type::text in('CASH','BANK') then 'legacy-account:' else 'asset:' end||a.id;name:=a.name;ccy:=t.base_currency;recorded:=t.created_at;
 elsif p_table='liquidity_accounts' then
  select * into b from public.liquidity_accounts where organization_id=p_org and id=p_id;
  if b.id is null or p_amount is null then raise exception 'FISCAL_DECLARED_OPENING_REQUIRED';end if;
  amount:=p_amount;dt:=coalesce(nullif(b.metadata->>'opening_date','')::date,b.created_at::date);tab:='cash';item:='cash:'||b.id;name:=b.name;ccy:=(select base_currency from public.organizations where id=p_org);recorded:=b.created_at;
 elsif p_table='financial_event_obligations' then
  select * into o from public.financial_event_obligations where organization_id=p_org and id=p_id and adjusts_obligation_id is null;
  if o.id is null or not exists(select 1 from public.debt_contracts d where d.organization_id=p_org and d.financial_event_id=o.event_id and d.mode='OPENING' and d.deleted_at is null) then raise exception 'FISCAL_OPENING_SOURCE_REQUIRED';end if;
  amount:=o.settleable_base_amount;side:=case when o.obligation_type in('PAYABLE','CUSTOMER_ADVANCE') then 'CREDIT' else 'DEBIT' end;
  select event_date,description,created_at into dt,name,recorded from public.financial_events where organization_id=p_org and id=o.event_id;
  ccy:=o.base_currency;tab:=private.financial_opening_tab(p_account);item:='debt:'||o.id;
 else raise exception 'FISCAL_SOURCE_TYPE_INVALID';end if;
 if ccy is distinct from (select base_currency from public.organizations where id=p_org) or amount is null or amount<0 or amount<>round(amount,4) then raise exception 'FISCAL_SOURCE_AMOUNT_INVALID';end if;
 if not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) c where c->>'code'=p_account and c->>'kind' in('ASSET','LIABILITY','EQUITY')) then raise exception 'FISCAL_ACCOUNT_INVALID';end if;
 return jsonb_build_object('itemId',item,'tab',tab,'name',name,'date',dt,'recordedAt',recorded,'amount',amount::numeric(24,4)::text,'side',side,'accountCode',p_account,'canonicalId',p_table||':'||p_id);
end $$;
revoke all on function private.financial_resolve_opening(uuid,text,uuid,numeric,text) from public,anon,authenticated;

create function public.assign_financial_opening_source(p_org uuid,p_table text,p_id uuid,p_fiscal_start date,p_effective_date date,p_account text,p_declared_amount numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare resolved jsonb;period jsonb;assigned public.financial_opening_source_assignments%rowtype;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 period:=private.financial_fiscal_period(p_org,p_fiscal_start);
 if (period->>'start')::date is distinct from p_fiscal_start or p_effective_date is distinct from p_fiscal_start or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'FISCAL_EFFECTIVE_DATE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||p_org::text||p_fiscal_start::text,0));
 if exists(select 1 from public.financial_year_closures where organization_id=p_org and fiscal_start=p_fiscal_start and status='CLOSED')
 or exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and fiscal_start=p_fiscal_start and status='APPROVED') then raise exception 'FISCAL_APPROVED_SOURCE_CORRECTION_REQUIRED';end if;
 resolved:=private.financial_resolve_opening(p_org,p_table,p_id,p_declared_amount,p_account);
 select * into assigned from public.financial_opening_source_assignments where organization_id=p_org and source_table=p_table and source_id=p_id;
 if assigned.id is not null then
  if assigned.fiscal_start=p_fiscal_start and assigned.effective_date=p_effective_date and assigned.account_code=p_account and assigned.declared_amount is not distinct from p_declared_amount then return to_jsonb(assigned);end if;
  raise exception 'FISCAL_SOURCE_ALREADY_ASSIGNED';
 end if;
 insert into public.financial_opening_source_assignments(organization_id,source_table,source_id,fiscal_start,effective_date,transaction_date,declared_amount,account_code,reason,created_by)
 values(p_org,p_table,p_id,p_fiscal_start,p_effective_date,(resolved->>'date')::date,p_declared_amount,p_account,p_reason,auth.uid()) returning * into assigned;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'SOURCE_ASSIGN',auth.uid(),jsonb_build_object('assignment',to_jsonb(assigned),'resolved',resolved));
 return to_jsonb(assigned);
end $$;
revoke all on function public.assign_financial_opening_source(uuid,text,uuid,date,date,text,numeric,text) from public,anon;
grant execute on function public.assign_financial_opening_source(uuid,text,uuid,date,date,text,numeric,text) to authenticated;

create function private.financial_period_opening_sources(p_org uuid,p_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare src jsonb;rows jsonb;r jsonb;v jsonb;x record;resolved jsonb;list jsonb;account jsonb;close public.financial_year_closures%rowtype;changed boolean:=false;
begin
 if exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) and (private.financial_fiscal_period(p_org,p_start)->>'start')::date<>p_start then raise exception 'FISCAL_START_MISMATCH';end if;
 src:=private.financial_opening_sources(p_org,p_start-1);rows:=src->'rows';
 select * into close from public.financial_year_closures where organization_id=p_org and next_start=p_start and status='CLOSED';
 if close.id is not null then
  rows:='[]'::jsonb;
  for r in select * from jsonb_array_elements(close.next_opening) loop
   select a into account from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=r->>'accountId';
   rows:=rows||jsonb_build_array(jsonb_build_object('id','rollover:'||(r->>'accountId'),'tab',private.financial_opening_tab(r->>'accountId'),
    'accountCode',r->>'accountId','ar',account->>'ar','en',account->>'en','accountAr',account->>'ar','accountEn',account->>'en','normal',case when account->>'kind' in('LIABILITY','EQUITY') then 'CREDIT' else 'DEBIT' end,'sourceIssue',null,
    'vouchers',jsonb_build_array(jsonb_build_object('canonicalId','close:'||close.id||':'||(r->>'accountId'),'number','close:'||close.id,'debit',r->>'debit','credit',r->>'credit'))));
  end loop;
  return jsonb_build_object('rows',rows,'revision',md5(rows::text),'financialRevision',md5(rows::text),'closeId',close.id,'ruleVersion','FISCAL_V1');
 end if;
 -- Explicit assignment wins. Unassigned first-day OPENING_BALANCE vouchers are
 -- opening sources by their type and fiscal effective date, never by company ID.
 for x in
  select a.source_table,a.source_id,a.account_code,a.declared_amount from public.financial_opening_source_assignments a where a.organization_id=p_org and a.fiscal_start=p_start
  union all
  select 'transactions',t.id,case when aa.asset_class_code='METALS' and aa.metadata->>'holding_purpose'='INVESTMENT' then '1600' else '1500' end,null::numeric
  from public.transactions t join public.asset_accounts aa on aa.id=t.asset_account_id and aa.organization_id=p_org
  where t.organization_id=p_org and t.transaction_type='OPENING_BALANCE' and t.transaction_date=p_start
   and aa.ownership_scope='ORGANIZATION' and aa.asset_type::text not in('CASH','BANK','RECEIVABLE') and not coalesce((aa.metadata->>'archived')::boolean,false)
   and not exists(select 1 from public.financial_opening_source_assignments a where a.organization_id=p_org and a.source_table='transactions' and a.source_id=t.id)
  union all
  select 'liquidity_accounts',b.id,'1000',round((b.metadata->>'opening_balance')::numeric*(b.metadata->>'opening_fx_rate')::numeric,4)
  from public.liquidity_accounts b where b.organization_id=p_org and nullif(b.metadata->>'opening_date','')::date=p_start
   and b.metadata->>'opening_balance' is not null and b.metadata->>'opening_fx_rate' is not null
   and not exists(select 1 from public.financial_opening_source_assignments a where a.organization_id=p_org and a.source_table='liquidity_accounts' and a.source_id=b.id)
  union all
  select 'financial_event_obligations',ob.id,case when ob.obligation_type='PAYABLE' then '2200' else '1200' end,null::numeric
  from public.financial_event_obligations ob join public.debt_contracts d on d.organization_id=p_org and d.financial_event_id=ob.event_id
  where ob.organization_id=p_org and ob.adjusts_obligation_id is null and d.mode='OPENING' and d.event_date=p_start and d.deleted_at is null
   and not exists(select 1 from public.financial_opening_source_assignments a where a.organization_id=p_org and a.source_table='financial_event_obligations' and a.source_id=ob.id)
 loop
  resolved:=private.financial_resolve_opening(p_org,x.source_table,x.source_id,x.declared_amount,x.account_code);
  if x.source_table<>'liquidity_accounts' and (resolved->>'date')::date<p_start then
   -- Already part of the historical source. Do not append it again.
   continue;
  end if;
  list:='[]'::jsonb;
  for r in select * from jsonb_array_elements(rows) loop
   if r->>'id'=resolved->>'itemId' then
    if x.source_table='liquidity_accounts' then r:=jsonb_set(r,'{vouchers}','[]');end if;
    v:=jsonb_build_object('canonicalId',resolved->>'canonicalId','number',resolved->>'canonicalId','debit',case when resolved->>'side'='DEBIT' then resolved->>'amount' else '0.0000' end,'credit',case when resolved->>'side'='CREDIT' then resolved->>'amount' else '0.0000' end,'effectiveDate',p_start,'transactionDate',resolved->>'date','recordedAt',resolved->>'recordedAt');
    r:=jsonb_set(jsonb_set(r,'{vouchers}',r->'vouchers'||jsonb_build_array(v)),'{accountCode}',to_jsonb(x.account_code));
    changed:=true;
   end if;
   list:=list||jsonb_build_array(r);
  end loop;
  -- Unposted opening debt obligations are absent from the ordinary ledger source.
  if not exists(select 1 from jsonb_array_elements(list) r where r->>'id'=resolved->>'itemId') then
   select a into account from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=x.account_code;
   list:=list||jsonb_build_array(jsonb_build_object('id',resolved->>'itemId','tab',resolved->>'tab','accountCode',x.account_code,'ar',resolved->>'name','en',resolved->>'name','accountAr',account->>'ar','accountEn',account->>'en','normal',resolved->>'side','sourceIssue',null,'vouchers',jsonb_build_array(jsonb_build_object('canonicalId',resolved->>'canonicalId','number',resolved->>'canonicalId','debit',case when resolved->>'side'='DEBIT' then resolved->>'amount' else '0.0000' end,'credit',case when resolved->>'side'='CREDIT' then resolved->>'amount' else '0.0000' end))));changed:=true;
  end if;
  rows:=list;
 end loop;
 -- Keep genuine historical sources. Add missing chart accounts for manual completion.
 if exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) then
  for account in select * from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'kind' in('ASSET','LIABILITY','EQUITY') loop
   if not exists(select 1 from jsonb_array_elements(rows) r where r->>'accountCode'=account->>'code') then
    rows:=rows||jsonb_build_array(jsonb_build_object('id','manual:'||(account->>'code'),'tab',private.financial_opening_tab(account->>'code'),'accountCode',account->>'code','ar',account->>'ar','en',account->>'en','accountAr',account->>'ar','accountEn',account->>'en','normal',case when account->>'kind' in('LIABILITY','EQUITY') then 'CREDIT' else 'DEBIT' end,'sourceIssue',null,'vouchers','[]'::jsonb));changed:=true;
   end if;
  end loop;
 end if;
 select jsonb_agg(jsonb_set(r,'{tab}',to_jsonb(private.financial_opening_tab(r->>'accountCode'))) order by r->>'id') into list from jsonb_array_elements(rows) r;
 changed:=changed or list is distinct from src->'rows';rows:=list;
 if not changed then return src;end if;
 select jsonb_agg(r order by r->>'id') into rows from jsonb_array_elements(rows) r;
 return jsonb_build_object('rows',rows,'revision',md5(rows::text),'financialRevision',md5((select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','vouchers',r->'vouchers','issue',r->'sourceIssue') order by r->>'id'),'[]') from jsonb_array_elements(rows) r where jsonb_array_length(r->'vouchers')>0 or r->>'sourceIssue' is not null)::text),'ruleVersion','FISCAL_V1');
end $$;
revoke all on function private.financial_period_opening_sources(uuid,date) from public,anon,authenticated;

-- Replace only calls that build an opening snapshot. Current-register reads retain
-- their own date cutoff. Existing write permissions, audit and validation remain.
do $$
declare n text;definition text;
begin
 foreach n in array array['public.financial_opening_workspace(uuid,date)','public.save_financial_opening(uuid,date,integer,text,jsonb,text)','public.approve_financial_opening(uuid,integer)','public.financial_statement_live_snapshot(uuid,date,date)'] loop
  definition:=pg_get_functiondef(n::regprocedure);
  definition:=replace(definition,'private.financial_opening_sources(p_org,p_fiscal_start-1)','private.financial_period_opening_sources(p_org,p_fiscal_start)');
  definition:=replace(definition,'private.financial_opening_sources(w.organization_id,w.fiscal_start-1)','private.financial_period_opening_sources(w.organization_id,w.fiscal_start)');
  definition:=replace(definition,'private.financial_opening_sources(p_org,w.fiscal_start-1)','private.financial_period_opening_sources(p_org,w.fiscal_start)');
  if n='public.financial_opening_workspace(uuid,date)' then
   definition:=replace(definition,'and t.transaction_date>=p_fiscal_start',$exclude$and t.transaction_date>p_fiscal_start and not exists(select 1 from public.financial_opening_source_assignments a where a.organization_id=p_org and a.source_table='transactions' and a.source_id=t.id)$exclude$);
  end if;
  if n='public.approve_financial_opening(uuid,integer)' then
   definition:=replace(definition,$old$for r in select * from jsonb_array_elements(s->'rows') loop$old$,$new$
    if s->>'closeId' is not null and exists(select 1 from jsonb_each(w.entries) x where coalesce(nullif(x.value->>'amount','')::numeric,0)<>0 or x.value->>'accountCode' is not null) then raise exception 'FISCAL_ROLLOVER_CORRECTION_REQUIRED';end if;
    for r in select * from jsonb_array_elements(s->'rows') loop
   $new$);
  end if;
  if n='public.financial_statement_live_snapshot(uuid,date,date)' then
   definition:=replace(definition,'events:=private.financial_reporting_events(p_org,w.fiscal_start,pol.fiscal_end);',$filter$
    events:=private.financial_reporting_events(p_org,w.fiscal_start,pol.fiscal_end);
    -- A source represented in the approved opening is consumed once. Other
    -- purchases and operational events keep their normal posting rules.
    if w.id is not null then
     select coalesce(jsonb_agg(ev),'[]'::jsonb) into events from jsonb_array_elements(events) ev where not exists(
      select 1 from jsonb_array_elements(w.source_snapshot->'rows') rr cross join lateral jsonb_array_elements(rr->'vouchers') vv
      where vv->>'canonicalId'='transactions:'||replace(ev->>'id','transaction:','')
       or exists(select 1 from public.transactions t where t.organization_id=p_org and vv->>'canonicalId'='transactions:'||t.id and (
        t.metadata->>'financial_event_id'=ev->>'id'
        or exists(select 1 from public.financial_events integrated where integrated.organization_id=p_org and integrated.id::text=ev->>'id' and integrated.source_record_id=t.id)
        or exists(select 1 from public.financial_event_links integrated where integrated.organization_id=p_org and integrated.event_id::text=ev->>'id' and integrated.target_module='transactions' and integrated.target_record_id=t.id)
       ))
       or vv->>'canonicalId' in(select 'financial_event_obligations:'||ob.id from public.financial_event_obligations ob where ob.organization_id=p_org and ob.event_id::text=ev->>'id')
     );
    end if;
   $filter$);
  end if;
  execute definition;
 end loop;
end $$;

-- Configuration is optional for existing explicitly selected legacy dates.
-- New client entry points obtain their period from financial_fiscal_context.
-- Existing approved periods remain immutable until an explicit correction.
create function private.financial_assert_open_period(p_org uuid,p_start date)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) and (private.financial_fiscal_period(p_org,p_start)->>'start')::date<>p_start then raise exception 'FISCAL_START_MISMATCH';end if;
 if exists(select 1 from public.financial_year_closures where organization_id=p_org and fiscal_start=p_start and status='CLOSED') then raise exception 'FISCAL_PERIOD_CLOSED';end if;
end $$;
revoke all on function private.financial_assert_open_period(uuid,date) from public,anon,authenticated;
do $$
declare sig text;definition text;
begin
 foreach sig in array array['public.save_financial_opening(uuid,date,integer,text,jsonb,text)','public.save_financial_reporting_policy(uuid,date,integer,jsonb,text)'] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  definition:=replace(definition,'begin',E'begin\n perform private.financial_assert_open_period(p_org,p_fiscal_start);');
  execute definition;
 end loop;
end $$;

-- Compute the annual trial balance from authoritative signed source lines and
-- exactly one approved rule per line. Values supplied by the API are not trusted.
create function private.financial_fiscal_trial(p_snapshot jsonb,p_retained text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
#variable_conflict use_column
declare ev jsonb;l jsonb;rule jsonb;row jsonb;acct jsonb;balances jsonb:='{}';initial jsonb:='{}';movement jsonb:='{}';value numeric;amount numeric;d text;c text;n integer;profit numeric:=0;trial jsonb:='[]';next_rows jsonb:='[]';kind text;total numeric:=0;cash numeric:=0;activity text;cash_d boolean;cash_c boolean;journal jsonb;event_balances jsonb:='{}';original jsonb;reversal_count integer;
begin
 if (select count(*) from jsonb_array_elements(p_snapshot->'events'))<>(select count(distinct e->>'id') from jsonb_array_elements(p_snapshot->'events') e)
 or (select count(*) from jsonb_array_elements(p_snapshot->'events') e cross join lateral jsonb_array_elements(e->'lines') l)<>(select count(distinct l->>'id') from jsonb_array_elements(p_snapshot->'events') e cross join lateral jsonb_array_elements(e->'lines') l) then raise exception 'FISCAL_DUPLICATE_SOURCE';end if;
 if p_snapshot->'policy'->>'approvedBy' is null or p_snapshot->'policy'->>'approvedBy'='' then raise exception 'FISCAL_POLICY_REQUIRED';end if;
 for row in select * from jsonb_array_elements(p_snapshot->'opening') loop
  d:=row->>'accountId';value:=(row->>'debit')::numeric-(row->>'credit')::numeric;
  if balances ? d then raise exception 'FISCAL_DUPLICATE_OPENING';end if;
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=d and a->>'kind' in('ASSET','LIABILITY','EQUITY')) then raise exception 'FISCAL_OPENING_ACCOUNT_INVALID';end if;
  balances:=jsonb_set(balances,array[d],to_jsonb(value));initial:=jsonb_set(initial,array[d],to_jsonb(value));total:=total+value;
 end loop;
 if total<>0 then raise exception 'OPENING_UNBALANCED';end if;
 for ev in select * from jsonb_array_elements(p_snapshot->'events') elements(item) where (item->>'date')::date between (p_snapshot->>'fiscalStart')::date and (p_snapshot->>'to')::date loop
  if ev->>'organizationId' is distinct from p_snapshot->>'organizationId' or ev->>'currency' is distinct from p_snapshot->>'currency' then raise exception 'FISCAL_SOURCE_SCOPE_INVALID';end if;
  if ev->>'status' not in('ACTUAL','REVERSED') then continue;end if;
  journal:='{}';
  for l in select * from jsonb_array_elements(ev->'lines') loop
   select count(*),(jsonb_agg(r))->0 into n,rule from jsonb_array_elements(p_snapshot->'policy'->'rules') r where r->>'eventType'=ev->>'eventType' and r->>'sourceModule'=ev->>'sourceModule' and r->>'classificationId'=l->>'classificationId' and r->>'cashDirection'=l->>'cashDirection' and (ev->>'date')::date between (r->>'from')::date and (r->>'to')::date;
   if n<>1 then raise exception 'FISCAL_POSTING_RULE_REQUIRED';end if;
   if l->>'recognitionSign' not in('1','-1') or l->>'baseAmount' !~ '^\d{1,20}(\.\d{1,4})?$' then raise exception 'FISCAL_SOURCE_AMOUNT_INVALID';end if;
   amount:=(l->>'baseAmount')::numeric;
   if amount<=0 then raise exception 'FISCAL_SOURCE_AMOUNT_INVALID';end if;
   d:=case when l->>'recognitionSign'='1' then rule->>'debitAccountId' else rule->>'creditAccountId' end;
   c:=case when l->>'recognitionSign'='1' then rule->>'creditAccountId' else rule->>'debitAccountId' end;
   if not exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=d) or not exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=c) then raise exception 'FISCAL_ACCOUNT_INVALID';end if;
   select coalesce((a->>'cash')::boolean,false) into cash_d from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=d;
   select coalesce((a->>'cash')::boolean,false) into cash_c from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=c;
   if (l->>'cashDirection'='NON_CASH' and (cash_d or cash_c)) or (l->>'cashDirection'<>'NON_CASH' and not(cash_d or cash_c)) or (cash_d<>cash_c and coalesce(rule->>'cashActivity','') not in('OPERATING','INVESTING','FINANCING')) then raise exception 'FISCAL_CASH_MAPPING_INVALID';end if;
   if cash_d<>cash_c and ((l->>'cashDirection'='INFLOW')<>(case when l->>'recognitionSign'='1' then cash_d else cash_c end)) then raise exception 'FISCAL_CASH_DIRECTION_INVALID';end if;
   balances:=jsonb_set(balances,array[d],to_jsonb(coalesce((balances->>d)::numeric,0)+amount));balances:=jsonb_set(balances,array[c],to_jsonb(coalesce((balances->>c)::numeric,0)-amount));
   journal:=jsonb_set(journal,array[d],to_jsonb(coalesce((journal->>d)::numeric,0)+amount));journal:=jsonb_set(journal,array[c],to_jsonb(coalesce((journal->>c)::numeric,0)-amount));
   movement:=jsonb_set(movement,array[d],to_jsonb(coalesce((movement->>d)::numeric,0)+amount));movement:=jsonb_set(movement,array[c],to_jsonb(coalesce((movement->>c)::numeric,0)-amount));
  end loop;
  event_balances:=jsonb_set(event_balances,array[ev->>'id'],journal);
 end loop;
 for ev in select * from jsonb_array_elements(p_snapshot->'events') e where e->>'reversesEventId' is not null loop
  select e into original from jsonb_array_elements(p_snapshot->'events') e where e->>'id'=ev->>'reversesEventId';
  select count(*) into reversal_count from jsonb_array_elements(p_snapshot->'events') e where e->>'reversesEventId'=ev->>'reversesEventId';
  if original is null or original->>'status'<>'REVERSED' or (original->>'date')::date>(ev->>'date')::date or reversal_count<>1 then raise exception 'FISCAL_REVERSAL_SOURCE_INVALID';end if;
  if exists(select 1 from (select key,sum(value::numeric) amount from (select * from jsonb_each_text(event_balances->(ev->>'id')) union all select * from jsonb_each_text(event_balances->(original->>'id'))) values_by_account group by key) totals where totals.amount<>0) then raise exception 'FISCAL_REVERSAL_AMOUNT_INVALID';end if;
 end loop;
 total:=0;
 for acct in select * from jsonb_array_elements(p_snapshot->'accounts') loop
  d:=acct->>'id';kind:=acct->>'kind';value:=coalesce((balances->>d)::numeric,0);total:=total+value;
  trial:=trial||jsonb_build_array(jsonb_build_object('accountId',d,'opening',coalesce((initial->>d)::numeric,0)::numeric(24,4)::text,'movement',coalesce((movement->>d)::numeric,0)::numeric(24,4)::text,'closing',value::numeric(24,4)::text));
  if coalesce((acct->>'cash')::boolean,false) then cash:=cash+value;end if;
  if kind in('REVENUE','COGS','OPEX','FINANCE','TAX') then profit:=profit-value;end if;
 end loop;
 if total<>0 then raise exception 'FISCAL_TRIAL_UNBALANCED';end if;
 if p_snapshot->'controls'->>'cashClosing' is not null and cash<>(p_snapshot->'controls'->>'cashClosing')::numeric then raise exception 'FISCAL_CASH_UNRECONCILED';end if;
 if not exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') a where a->>'id'=p_retained and a->>'kind'='EQUITY') then raise exception 'FISCAL_RETAINED_ACCOUNT_REQUIRED';end if;
 for acct in select * from jsonb_array_elements(p_snapshot->'accounts') elements(item) where item->>'kind' in('ASSET','LIABILITY','EQUITY') loop
  d:=acct->>'id';value:=coalesce((balances->>d)::numeric,0)-case when d=p_retained then profit else 0 end;
  next_rows:=next_rows||jsonb_build_array(jsonb_build_object('accountId',d,'debit',greatest(value,0)::numeric(24,4)::text,'credit',greatest(-value,0)::numeric(24,4)::text));
 end loop;
 if (select sum((r->>'debit')::numeric-(r->>'credit')::numeric) from jsonb_array_elements(next_rows) r)<>0 then raise exception 'FISCAL_ROLLOVER_UNBALANCED';end if;
 return jsonb_build_object('trialBalance',trial,'nextOpening',next_rows,'profit',profit::numeric(24,4)::text,'ruleVersion','FISCAL_V1');
end $$;
revoke all on function private.financial_fiscal_trial(jsonb,text) from public,anon,authenticated;

alter function public.financial_statement_live_snapshot(uuid,date,date) rename to financial_statement_live_snapshot_v1;
alter function public.financial_statement_live_snapshot_v1(uuid,date,date) set schema private;
revoke all on function private.financial_statement_live_snapshot_v1(uuid,date,date) from public,anon,authenticated;

create function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare c public.financial_year_closures%rowtype;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into c from public.financial_year_closures where organization_id=p_org and status='CLOSED' and fiscal_start<=p_from and fiscal_end>=p_to;
 if c.id is not null then return (case when p_to=c.fiscal_end then c.source_snapshot else c.source_snapshot-'controls' end)||jsonb_build_object('from',p_from,'to',p_to,'readAt',statement_timestamp(),'closureId',c.id);end if;
 return private.financial_statement_live_snapshot_v1(p_org,p_from,p_to);
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;

create function public.close_financial_year(p_org uuid,p_start date,p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare period jsonb;source jsonb;computed jsonb;c public.financial_year_closures%rowtype;retained text;vol numeric;rev integer;
begin
 if not private.financial_opening_can(p_org,'financial_core.approve') or not private.financial_opening_can(p_org,'financial_core.post') then raise exception 'FISCAL_CLOSE_DENIED';end if;
 period:=private.financial_fiscal_period(p_org,p_start);
 if p_start is distinct from (period->>'start')::date or p_request is null or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'FISCAL_CLOSE_INVALID';end if;
 if (period->>'end')::date>=current_date then raise exception 'FISCAL_YEAR_NOT_FINISHED';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||p_org::text||p_start::text,0));
 select * into c from public.financial_year_closures where organization_id=p_org and request_id=p_request;
 if c.id is not null then
  if c.fiscal_start<>p_start then raise exception 'FISCAL_REQUEST_CONFLICT';end if;
  if c.status<>'CLOSED' then raise exception 'FISCAL_REQUEST_SUPERSEDED';end if;
  return to_jsonb(c)-'source_snapshot';
 end if;
 if exists(select 1 from public.financial_year_closures where organization_id=p_org and fiscal_start=p_start and status='CLOSED') then raise exception 'FISCAL_ALREADY_CLOSED';end if;
 lock table public.financial_events,public.financial_event_lines,public.financial_event_links,public.financial_event_obligations,public.financial_event_obligation_allocations,public.liquidity_accounts,public.liquidity_counterparties,public.liquidity_flows,public.liquidity_settlements,public.asset_accounts,public.transactions,public.transaction_allocations,public.debt_contracts in share mode;
 perform pg_advisory_xact_lock(hashtextextended('fiscal-year:'||p_org::text||p_start::text,0));
 perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
 if not private.financial_opening_can(p_org,'financial_core.approve') or not private.financial_opening_can(p_org,'financial_core.post') then raise exception 'FISCAL_CLOSE_DENIED';end if;
 if exists(select 1 from public.financial_events where organization_id=p_org and event_date between p_start and (period->>'end')::date and status not in('ACTUAL','REVERSED','CANCELLED')) then raise exception 'FISCAL_PENDING_OPERATIONS';end if;
 source:=private.financial_statement_live_snapshot_v1(p_org,p_start,(period->>'end')::date);
 select retained_earnings_account into retained from public.financial_fiscal_calendars where organization_id=p_org;
 computed:=private.financial_fiscal_trial(source,retained);
 select coalesce(sum(greatest((r->>'closing')::numeric,0)),0) into vol from jsonb_array_elements(computed->'trialBalance') r;
 if not public.effective_organization_permission(p_org,'financial_core.approve',vol,source->>'currency') or not public.effective_organization_permission(p_org,'financial_core.post',vol,source->>'currency') then raise exception 'FISCAL_CLOSE_DENIED';end if;
 select coalesce(max(version),0)+1 into rev from public.financial_year_closures where organization_id=p_org and fiscal_start=p_start;
 insert into public.financial_year_closures(organization_id,fiscal_start,fiscal_end,next_start,currency,version,status,request_id,source_revision,source_snapshot,trial_balance,next_opening,reason,created_by)
 values(p_org,p_start,(period->>'end')::date,(period->>'nextStart')::date,source->>'currency',rev,'CLOSED',p_request,md5((source-'coverage')::text),source,computed->'trialBalance',computed->'nextOpening',p_reason,auth.uid()) returning * into c;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'YEAR_CLOSE',auth.uid(),jsonb_build_object('closeId',c.id,'version',c.version,'sourceRevision',c.source_revision,'profit',computed->>'profit','retainedAccount',retained,'reason',p_reason));
 return to_jsonb(c)-'source_snapshot';
end $$;
revoke all on function public.close_financial_year(uuid,date,uuid,text) from public,anon;
grant execute on function public.close_financial_year(uuid,date,uuid,text) to authenticated;

create function public.reopen_financial_year(p_org uuid,p_close uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c public.financial_year_closures%rowtype;
begin
 if not private.financial_opening_can(p_org,'financial_core.approve') or not private.financial_opening_can(p_org,'financial_core.post') then raise exception 'FISCAL_CLOSE_DENIED';end if;
 select * into c from public.financial_year_closures where organization_id=p_org and id=p_close;
 if c.id is null then raise exception 'FISCAL_CLOSE_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||p_org::text||c.next_start::text,0));
 perform pg_advisory_xact_lock(hashtextextended('fiscal-year:'||p_org::text||c.fiscal_start::text,0));
 select * into c from public.financial_year_closures where id=p_close and organization_id=p_org for update;
 if c.version is distinct from p_expected_version or c.status<>'CLOSED' then raise exception 'FISCAL_VERSION_CONFLICT';end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'FISCAL_CORRECTION_REASON_REQUIRED';end if;
 if exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and fiscal_start>=c.next_start and status='APPROVED')
 or exists(select 1 from public.financial_year_closures where organization_id=p_org and fiscal_start>=c.next_start and status='CLOSED') then raise exception 'FISCAL_SUCCESSOR_REQUIRES_CORRECTION';end if;
 update public.financial_year_closures set status='SUPERSEDED' where id=c.id;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'YEAR_REOPEN',auth.uid(),jsonb_build_object('closeId',c.id,'version',c.version,'reason',p_reason));
 return jsonb_build_object('id',c.id,'status','SUPERSEDED','nextDraftRequiresRefresh',true);
end $$;
revoke all on function public.reopen_financial_year(uuid,uuid,integer,text) from public,anon;
grant execute on function public.reopen_financial_year(uuid,uuid,integer,text) to authenticated;

create function private.financial_closed_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare payload jsonb;org uuid;dt date;start date;parent uuid;
begin
 for payload in select v from (values(case when tg_op<>'INSERT' then to_jsonb(old) end),(case when tg_op<>'DELETE' then to_jsonb(new) end)) x(v) where v is not null loop
  org:=nullif(payload->>'organization_id','')::uuid;
  if org is null and payload->>'transaction_id' is not null then
   select organization_id,transaction_date into org,dt from public.transactions where id=(payload->>'transaction_id')::uuid;
  end if;
  if org is null then continue;end if;
  dt:=coalesce(nullif(payload->>'event_date','')::date,nullif(payload->>'transaction_date','')::date,nullif(payload->>'settlement_date','')::date,nullif(payload->>'due_date','')::date);
  if dt is null and payload->>'event_id' is not null then select event_date into dt from public.financial_events where organization_id=org and id=(payload->>'event_id')::uuid;end if;
  if dt is null and payload->>'application_event_id' is not null then select event_date into dt from public.financial_events where organization_id=org and id=(payload->>'application_event_id')::uuid;end if;
  if dt is null and payload->>'transaction_id' is not null then select transaction_date into dt from public.transactions where organization_id=org and id=(payload->>'transaction_id')::uuid;end if;
  if dt is null and tg_op='INSERT' then dt:=coalesce(nullif(payload->>'created_at','')::timestamptz::date,current_date);end if;
  if dt is null and tg_table_name='liquidity_accounts' and tg_op='UPDATE'
   and (to_jsonb(old)-array['current_balance','current_balance_base','updated_at'])=(to_jsonb(new)-array['current_balance','current_balance_base','updated_at']) then continue;end if;
  if exists(select 1 from public.financial_opening_source_assignments assignment
    join public.financial_opening_workspaces w on w.organization_id=assignment.organization_id and w.fiscal_start=assignment.fiscal_start and w.status='APPROVED'
    where assignment.organization_id=org and assignment.source_table=tg_table_name and assignment.source_id::text=payload->>'id') then raise exception 'FISCAL_APPROVED_SOURCE_CORRECTION_REQUIRED';end if;
  if dt is null then
   -- Account/master changes can alter historical source reconstruction.
   if exists(select 1 from public.financial_year_closures where organization_id=org and status='CLOSED') then raise exception 'FISCAL_CLOSED_SOURCE_CORRECTION_REQUIRED';end if;
  elsif exists(select 1 from public.financial_fiscal_calendars where organization_id=org) then
   start:=(private.financial_fiscal_period(org,dt)->>'start')::date;
   perform pg_advisory_xact_lock(hashtextextended('fiscal-year:'||org::text||start::text,0));
   if exists(select 1 from public.financial_year_closures where organization_id=org and status='CLOSED' and fiscal_start<=dt and fiscal_end>=dt) then raise exception 'FISCAL_PERIOD_CLOSED';end if;
  end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.financial_closed_source_guard() from public,anon,authenticated;
do $$
declare tbl text;
begin
 foreach tbl in array array['financial_events','financial_event_lines','financial_event_links','financial_event_obligations','financial_event_obligation_allocations','liquidity_accounts','liquidity_flows','liquidity_settlements','asset_accounts','transactions','transaction_allocations','debt_contracts'] loop
  execute format('create trigger financial_closed_source_guard before insert or update or delete on public.%I for each row execute function private.financial_closed_source_guard()',tbl);
 end loop;
end $$;

create function private.financial_period_end(p_org uuid,p_start date)
returns date language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) then
  if (private.financial_fiscal_period(p_org,p_start)->>'start')::date<>p_start then raise exception 'FISCAL_START_MISMATCH';end if;
  return (private.financial_fiscal_period(p_org,p_start)->>'end')::date;
 end if;
 return (p_start+interval '1 year'-interval '1 day')::date;
end $$;
revoke all on function private.financial_period_end(uuid,date) from public,anon,authenticated;
do $$
declare signature text;definition text;
begin
 foreach signature in array array['public.save_financial_reporting_policy(uuid,date,integer,jsonb,text)','public.financial_reporting_policy_workspace(uuid,date)','public.financial_opening_workspace(uuid,date)','public.financial_statement_live_context()','private.financial_statement_live_snapshot_v1(uuid,date,date)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,$literal$(p_fiscal_start+interval '1 year'-interval '1 day')::date$literal$,'private.financial_period_end(p_org,p_fiscal_start)');
  definition:=replace(definition,$literal$(w.fiscal_start+interval '1 year'-interval '1 day')::date$literal$,'private.financial_period_end(o.id,w.fiscal_start)');
  definition:=replace(definition,$literal$p_to<(fiscal_start+interval '1 year')$literal$,'p_to<=private.financial_period_end(p_org,fiscal_start)');
  definition:=replace(definition,$literal$t.transaction_date<p_fiscal_start+interval '1 year'$literal$,'t.transaction_date<=private.financial_period_end(p_org,p_fiscal_start)');
  execute definition;
 end loop;
end $$;
create index fiscal_calendar_actor_fk on public.financial_fiscal_calendars(updated_by);
create index fiscal_assignment_actor_fk on public.financial_opening_source_assignments(created_by);
create index fiscal_closure_actor_fk on public.financial_year_closures(created_by);
create index fiscal_audit_actor_fk on public.financial_fiscal_audit(actor_id);
