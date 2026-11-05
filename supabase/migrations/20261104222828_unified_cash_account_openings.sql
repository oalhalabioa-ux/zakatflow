-- Forward-only: no existing balances, approvals or postings are rewritten.
create table public.financial_cash_account_links(
 account_id uuid primary key references public.liquidity_accounts(id) on delete cascade,
 organization_id uuid not null references public.organizations(id),
 chart_account_id uuid not null references public.financial_chart_custom_accounts(id),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 entity_id uuid references public.organization_entities(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(chart_account_id)
);
create index financial_cash_links_org on public.financial_cash_account_links(organization_id);
alter table public.financial_cash_account_links enable row level security;
create policy cash_chart_links_read on public.financial_cash_account_links for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_cash_account_links from public,anon,authenticated;
grant select on public.financial_cash_account_links to authenticated;

-- The bank UUID is the permanent identity; names are never matching keys.
create function private.financial_cash_link_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;c public.financial_chart_custom_accounts%rowtype;
begin
 if tg_op='UPDATE' and (old.account_id,old.organization_id,old.chart_account_id,old.currency,old.entity_id) is distinct from (new.account_id,new.organization_id,new.chart_account_id,new.currency,new.entity_id) then raise exception 'FISCAL_CASH_LINK_IMMUTABLE';end if;
 select * into b from public.liquidity_accounts where id=new.account_id;
 select * into c from public.financial_chart_custom_accounts where id=new.chart_account_id;
 if b.id is null or c.id is null or b.organization_id is distinct from new.organization_id or c.organization_id is distinct from new.organization_id
 or b.currency is distinct from new.currency or b.entity_id is distinct from new.entity_id
 or (c.name_ar,c.name_en) is distinct from (case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end,case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end)
 or c.reporting_code<>'1000' or c.normal_side<>'DEBIT' or not c.is_postable or c.is_active is distinct from b.active
 or (b.entity_id is not null and not exists(select 1 from public.organization_entities e where e.id=b.entity_id and e.organization_id=b.organization_id))
 then raise exception 'FISCAL_CASH_LINK_SCOPE_INVALID';end if;
 return new;
end $$;
create trigger financial_cash_link_guard before insert or update on public.financial_cash_account_links for each row execute function private.financial_cash_link_guard();
revoke all on function private.financial_cash_link_guard() from public,anon,authenticated;

create function private.financial_sync_cash_account(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;c public.financial_chart_custom_accounts%rowtype;label text;
begin
 select * into b from public.liquidity_accounts where id=p_id;
 if b.id is null or auth.uid() is null or not private.financial_opening_can(b.organization_id,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||b.organization_id::text,0));
 select a.* into c from public.financial_chart_custom_accounts a join public.financial_cash_account_links l on l.chart_account_id=a.id where l.account_id=b.id and l.organization_id=b.organization_id;
 if c.id is null then return;end if;
 label:=case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end;
 if (c.name_ar,c.name_en,c.is_active) is distinct from (label,label,b.active) then
  perform public.save_financial_chart_account(b.organization_id,c.code,c.parent_code,label,label,'DEBIT',true,b.active,c.version,'Synchronize cash register '||b.id);
 end if;
end $$;
revoke all on function private.financial_sync_cash_account(uuid) from public,anon,authenticated;

create function private.financial_link_cash_account(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;code text;parent text;child jsonb;
begin
 select * into b from public.liquidity_accounts where id=p_id;
 if b.id is null or auth.uid() is null or not private.financial_opening_can(b.organization_id,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||b.organization_id::text,0));
 select c.code into code from public.financial_cash_account_links l join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where l.account_id=p_id and l.organization_id=b.organization_id;
 if code is not null then perform private.financial_sync_cash_account(p_id);return code;end if;
 -- Allocate leaves within dedicated groups, allowing multiple banks per currency.
 select c.parent_code into parent from public.financial_cash_account_links l
 join public.financial_chart_custom_accounts c on c.id=l.chart_account_id
 join public.financial_chart_custom_accounts g on g.organization_id=l.organization_id and g.code=c.parent_code
 where l.organization_id=b.organization_id and g.is_active and not g.is_postable
 and (select count(*) from public.financial_chart_custom_accounts x where x.organization_id=b.organization_id and x.parent_code=c.parent_code)<99
 order by c.parent_code limit 1;
 if parent is null then
  select '1000'||lpad(n::text,2,'0') into parent from generate_series(1,99) n where not exists(select 1 from public.financial_chart_custom_accounts c where c.organization_id=b.organization_id and c.code='1000'||lpad(n::text,2,'0')) order by n limit 1;
  if parent is null then raise exception 'CHART_CASH_CAPACITY_REVIEW_REQUIRED';end if;
  perform public.save_financial_chart_account(b.organization_id,parent,'1000','الحسابات النقدية التفصيلية','Cash register accounts','DEBIT',false,true,0,'Automatic cash register group');
 end if;
 select parent||lpad(n::text,2,'0') into code from generate_series(1,99) n where not exists(select 1 from public.financial_chart_custom_accounts c where c.organization_id=b.organization_id and c.code=parent||lpad(n::text,2,'0')) order by n limit 1;
 child:=public.save_financial_chart_account(b.organization_id,code,parent,case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end,case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end,'DEBIT',true,b.active,0,'Automatic link to cash register '||b.id);
 insert into public.financial_cash_account_links(account_id,organization_id,chart_account_id,currency,entity_id,created_by) values(b.id,b.organization_id,(child->>'id')::uuid,b.currency,b.entity_id,auth.uid());
 return code;
end $$;
revoke all on function private.financial_link_cash_account(uuid) from public,anon,authenticated;

create function public.link_financial_cash_accounts(p_org uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b record;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 for b in select id from public.liquidity_accounts where organization_id=p_org and (active or current_balance_base<>0) order by id loop perform private.financial_link_cash_account(b.id);end loop;
 return (select coalesce(jsonb_object_agg('cash:'||l.account_id,c.code),'{}') from public.financial_cash_account_links l join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where l.organization_id=p_org);
end $$;
revoke all on function public.link_financial_cash_accounts(uuid) from public,anon;
grant execute on function public.link_financial_cash_accounts(uuid) to authenticated;

-- A linked leaf follows the bank. Independent edits cannot split the two states.
create function private.financial_cash_chart_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;label text;
begin
 select a.* into b from public.liquidity_accounts a join public.financial_cash_account_links l on l.account_id=a.id where l.chart_account_id=old.id;
 if b.id is not null then
  label:=case when length(trim(b.name))<2 then trim(b.name)||' ·' else trim(b.name) end;
  if (new.id,new.organization_id,new.code,new.parent_code,new.reporting_code,new.normal_side,new.is_postable) is distinct from (old.id,old.organization_id,old.code,old.parent_code,'1000'::text,'DEBIT'::text,true)
   or (new.name_ar,new.name_en,new.is_active) is distinct from (label,label,b.active) then raise exception 'FISCAL_CASH_EDIT_FROM_REGISTER';end if;
 end if;
 return new;
end $$;
create trigger financial_cash_chart_guard before update on public.financial_chart_custom_accounts for each row execute function private.financial_cash_chart_guard();
revoke all on function private.financial_cash_chart_guard() from public,anon,authenticated;

create function private.financial_cash_identity_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.id,old.organization_id,old.currency,old.entity_id,old.account_type) is distinct from (new.id,new.organization_id,new.currency,new.entity_id,new.account_type) then raise exception 'FISCAL_CASH_IDENTITY_IMMUTABLE';end if;
 if new.entity_id is not null and not exists(select 1 from public.organization_entities e where e.id=new.entity_id and e.organization_id=new.organization_id) then raise exception 'FISCAL_CASH_LINK_SCOPE_INVALID';end if;
 if tg_op='UPDATE' and old.active and not new.active and (coalesce(new.current_balance,0)<>0 or coalesce(new.current_balance_base,0)<>0 or coalesce(new.restricted_balance,0)<>0 or coalesce(new.uncleared_balance,0)<>0) then raise exception 'FISCAL_CASH_NONZERO_BALANCE';end if;
 return new;
end $$;
create trigger financial_cash_identity_guard before insert or update on public.liquidity_accounts for each row execute function private.financial_cash_identity_guard();
revoke all on function private.financial_cash_identity_guard() from public,anon,authenticated;

create function private.financial_cash_metadata_sync()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.name,old.active) is distinct from (new.name,new.active) and exists(select 1 from public.financial_cash_account_links where account_id=new.id) then perform private.financial_sync_cash_account(new.id);end if;
 return new;
end $$;
create trigger financial_cash_metadata_sync after update of name,active on public.liquidity_accounts for each row execute function private.financial_cash_metadata_sync();
revoke all on function private.financial_cash_metadata_sync() from public,anon,authenticated;

create function public.update_financial_cash_account(p_org uuid,p_id uuid,p_name text,p_active boolean,p_expected_name text,p_expected_active boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;prior jsonb;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 120 or p_active is null or p_expected_name is null or p_expected_active is null or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FISCAL_CASH_INPUT_INVALID';end if;
 select * into b from public.liquidity_accounts where id=p_id and organization_id=p_org for update;
 if b.id is null then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 perform private.financial_link_cash_account(b.id);
 if (b.name,b.active) is not distinct from (trim(p_name),p_active) then return to_jsonb(b);end if;
 if (b.name,b.active) is distinct from (p_expected_name,p_expected_active) then raise exception 'FISCAL_CASH_VERSION_CONFLICT';end if;
 prior:=to_jsonb(b);
 update public.liquidity_accounts set name=trim(p_name),active=p_active,updated_at=now() where id=b.id returning * into b;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(auth.uid(),'financial_account',b.id,'UPDATE_FINANCIAL_CASH_ACCOUNT',prior,to_jsonb(b)||jsonb_build_object('reason',trim(p_reason)));
 return to_jsonb(b);
end $$;
revoke all on function public.update_financial_cash_account(uuid,uuid,text,boolean,text,boolean,text) from public,anon;
grant execute on function public.update_financial_cash_account(uuid,uuid,text,boolean,text,boolean,text) to authenticated;

-- Renaming is descriptive only. All financial-source changes and activation
-- changes retain the existing closed-year and approved-source guards.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('private.financial_closed_source_guard()'::regprocedure);
 needle:=' for payload in select v';
 if strpos(definition,needle)=0 then raise exception 'CASH_RENAME_GUARD_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$patch$
 if tg_op='UPDATE' and tg_table_name='liquidity_accounts'
 and (to_jsonb(old)-array['name','updated_at'])=(to_jsonb(new)-array['name','updated_at']) then return new;end if;
 for payload in select v$patch$);
 execute definition;
end $$;

-- One typed command for asset cash entry, the register, and liquidity. Existing
-- callers remain compatible. Explicit NEW never creates a nonzero opening.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.open_financial_account(jsonb)'::regprocedure);
 needle:='''due_date'',''notes''';
 if strpos(definition,needle)=0 then raise exception 'CASH_OPENING_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'''due_date'',''notes'',''balance_mode'',''restricted_balance'',''uncleared_balance''');
 definition:=replace(definition,'kind not in(''CASH'',''BANK'',''RECEIVABLE'')','kind not in(''CASH'',''BANK'',''RECEIVABLE'',''WALLET'',''INVESTMENT'',''OTHER'')');
 needle:='if scope=''PERSONAL'' then';
 definition:=replace(definition,needle,$patch$
 if coalesce(p_payload->>'balance_mode',case when amt=0 then 'NEW' else 'OPENING' end) not in('NEW','OPENING')
 or (p_payload->>'balance_mode'='NEW' and (amt<>0 or coalesce((p_payload->>'restricted_balance')::numeric,0)<>0 or coalesce((p_payload->>'uncleared_balance')::numeric,0)<>0))
 or coalesce((p_payload->>'restricted_balance')::numeric,0)<0
 or coalesce((p_payload->>'uncleared_balance')::numeric,0)<0
 or (scope='PERSONAL' and kind not in('CASH','BANK','RECEIVABLE')) then raise exception 'FINANCIAL_ACCOUNT_INVALID';end if;
 if scope='PERSONAL' then$patch$);
 needle:='''entry_source'',''FINANCIAL_REGISTER''';
 definition:=replace(definition,needle,$patch$'entry_source','FINANCIAL_REGISTER','balance_mode',coalesce(p_payload->>'balance_mode',case when amt=0 then 'NEW' else 'OPENING' end)$patch$);
 definition:=replace(definition,'amt,amt*fx,0,0,0,0,',$patch$amt,amt*fx,coalesce((p_payload->>'restricted_balance')::numeric,0),coalesce((p_payload->>'restricted_balance')::numeric,0)*fx,coalesce((p_payload->>'uncleared_balance')::numeric,0),coalesce((p_payload->>'uncleared_balance')::numeric,0)*fx,$patch$);
 definition:=replace(definition,'result:=to_jsonb(b);','result:=to_jsonb(b); perform public.link_financial_cash_accounts(org);');
 execute definition;
end $$;

-- Read-only reconstruction uses the same actual settlements/flows and base
-- currency deduplication as the opening/reporting adapter. Forecasts are excluded.
create function private.financial_cash_opening_suggestions(p_org uuid,p_start date)
returns jsonb language sql stable security invoker set search_path='' as $$
 with cash_movements as (
  select s.account_id,s.settlement_date date,s.base_amount*case when s.direction='INFLOW' then 1 else -1 end amount
  from public.liquidity_settlements s where s.organization_id=p_org and s.status in('POSTED','REVERSED')
  union all
  select f.account_id,f.due_date,f.base_amount*case when f.direction='INFLOW' then 1 else -1 end
  from public.liquidity_flows f where f.organization_id=p_org and f.status='ACTUAL'
   and not exists(select 1 from public.financial_core_cash_event_flow_links l join public.liquidity_settlements s on s.financial_event_id=l.financial_event_id and s.organization_id=p_org where l.organization_id=p_org and l.liquidity_flow_id=f.id)
   and not exists(select 1 from public.liquidity_flow_settlement_allocations a join public.liquidity_settlements s on s.id=a.settlement_id and s.organization_id=p_org where a.organization_id=p_org and a.flow_id=f.id and s.status in('POSTED','REVERSED'))
 )
 select coalesce(jsonb_object_agg(a.id,jsonb_build_object('amount',(a.current_balance_base-coalesce((select sum(m.amount) from cash_movements m where m.account_id=a.id and m.date>=p_start),0))::numeric(24,4)::text,
 'issue',case when exists(select 1 from cash_movements m where m.account_id=a.id and m.amount is null) then 'CASH_BASE_AMOUNT_MISSING' end)),'{}')
 from public.liquidity_accounts a where a.organization_id=p_org and a.metadata->>'opening_date' is null and a.metadata->>'balance_mode' is null and (a.active or a.current_balance_base<>0)
$$;
revoke all on function private.financial_cash_opening_suggestions(uuid,date) from public,anon,authenticated;

do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.financial_opening_candidates(uuid,date)'::regprocedure);
 needle:='return result;';
 if strpos(definition,needle)=0 then raise exception 'CASH_CANDIDATES_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$patch$
 select coalesce(jsonb_agg(c||case when c->>'kind'='BANK' then jsonb_build_object(
 'suggestedAmount',suggestion->'amount','suggestionIssue',suggestion->'issue','suggestionBasis','RECONSTRUCTED_ACTUAL_MOVEMENTS') else '{}'::jsonb end),'[]') into result
 from jsonb_array_elements(result) c left join lateral(select private.financial_cash_opening_suggestions(p_org,p_start)->(c->>'sourceId') suggestion) s on true;
 return result;$patch$);
 execute definition;
 definition:=pg_get_functiondef('public.financial_opening_workspace(uuid,date)'::regprocedure);
 needle:='''bankRegister'',';
 if strpos(definition,needle)=0 then raise exception 'CASH_WORKSPACE_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$patch$'cashAccountCodes',(select coalesce(jsonb_object_agg('cash:'||l.account_id,c.code),'{}') from public.financial_cash_account_links l join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where l.organization_id=p_org), 'bankRegister',$patch$);
 execute definition;
end $$;
notify pgrst,'reload schema';

-- Bank statement opening corrections share actual movement deduplication with
-- the reporting reader. They never create receipts, flows or journal events.
create function private.financial_cash_actual_movements(p_org uuid,p_id uuid)
returns table(id text,dt date,native numeric,base numeric,currency text) language sql stable security definer set search_path='' as $$
 select 'settlement:'||s.id,s.settlement_date,s.amount*case when s.direction='INFLOW' then 1 else -1 end,s.base_amount*case when s.direction='INFLOW' then 1 else -1 end,s.currency
 from public.liquidity_settlements s where s.organization_id=p_org and s.account_id=p_id and s.status in('POSTED','REVERSED')
 union all
 select 'flow:'||f.id,f.due_date,f.amount*case when f.direction='INFLOW' then 1 else -1 end,f.base_amount*case when f.direction='INFLOW' then 1 else -1 end,f.currency
 from public.liquidity_flows f where f.organization_id=p_org and f.account_id=p_id and f.status='ACTUAL'
 and not exists(select 1 from public.financial_core_cash_event_flow_links l join public.liquidity_settlements s on s.financial_event_id=l.financial_event_id and s.organization_id=p_org where l.organization_id=p_org and l.liquidity_flow_id=f.id)
 and not exists(select 1 from public.liquidity_flow_settlement_allocations a join public.liquidity_settlements s on s.id=a.settlement_id and s.organization_id=p_org where a.organization_id=p_org and a.flow_id=f.id and s.status in('POSTED','REVERSED'))
$$;
revoke all on function private.financial_cash_actual_movements(uuid,uuid) from public,anon,authenticated;

create function public.financial_cash_opening_detail(p_org uuid,p_id uuid,p_date date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;v_date date;m jsonb;amt numeric;bas numeric;issue text;first_date date;ccy text;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 select * into b from public.liquidity_accounts where id=p_id and organization_id=p_org;
 if b.id is null then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 v_date:=coalesce(p_date,nullif(b.metadata->>'opening_date','')::date,case when exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) then (private.financial_fiscal_period(p_org,current_date)->>'start')::date else b.created_at::date end);
 if v_date is null or v_date>current_date then raise exception 'FISCAL_CASH_DATE_INVALID';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'),min(x.dt) into m,first_date from private.financial_cash_actual_movements(p_org,p_id) x;
 select b.current_balance-coalesce(sum(x.native) filter(where x.dt>=v_date),0),b.current_balance_base-coalesce(sum(x.base) filter(where x.dt>=v_date),0) into amt,bas from private.financial_cash_actual_movements(p_org,p_id) x;
 select base_currency into ccy from public.organizations where id=p_org;
 issue:=case when not exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) then 'FISCAL_CALENDAR_REQUIRED' when not private.financial_opening_can(p_org,'financial_core.create') then 'FISCAL_WRITE_DENIED'
 when not b.active then 'FISCAL_CASH_INACTIVE'
 when exists(select 1 from public.financial_year_closures where organization_id=p_org and status='CLOSED') then 'FISCAL_CLOSED_SOURCE_CORRECTION_REQUIRED'
 when exists(select 1 from public.financial_opening_workspaces where organization_id=p_org and status='APPROVED') then 'FISCAL_APPROVED_SOURCE_CORRECTION_REQUIRED'
 when exists(select 1 from public.financial_opening_source_assignments where organization_id=p_org and source_table='liquidity_accounts' and source_id=p_id) then 'FISCAL_ASSIGNED_SOURCE_CORRECTION_REQUIRED'
 when exists(select 1 from public.financial_opening_workspaces w cross join lateral jsonb_each(w.entries) e where w.organization_id=p_org and w.status='DRAFT' and e.key='cash:'||p_id and coalesce(nullif(e.value->>'amount','')::numeric,0)<>0) then 'FISCAL_DRAFT_OPENING_REVIEW_REQUIRED'
 when first_date<v_date then 'FISCAL_CASH_DATE_AFTER_MOVEMENT'
 when exists(select 1 from private.financial_cash_actual_movements(p_org,p_id) x where x.native is null or x.base is null or x.currency is distinct from b.currency) then 'FISCAL_CASH_CURRENCY_REVIEW_REQUIRED' end;
 return jsonb_build_object('id',b.id,'name',b.name,'currency',b.currency,'baseCurrency',ccy,'date',v_date,'amount',amt::text,'baseAmount',bas::text,
 'fx',case when b.currency=ccy then '1' when amt<>0 and bas/amt>0 then (bas/amt)::text else coalesce(b.metadata->>'opening_fx_rate','1') end,
 'balance',b.current_balance::text,'baseBalance',b.current_balance_base::text,'accountType',b.account_type,'restricted',b.restricted_balance,'uncleared',b.uncleared_balance,'entityId',b.entity_id,'firstMovement',first_date,'issue',issue,'canEdit',issue is null,
 'token',md5(to_jsonb(b)::text||m::text||v_date::text),'recorded',b.metadata->>'opening_date' is not null);
end $$;
revoke all on function public.financial_cash_opening_detail(uuid,uuid,date) from public,anon;
grant execute on function public.financial_cash_opening_detail(uuid,uuid,date) to authenticated;

create function public.correct_financial_cash_opening(p_org uuid,p_id uuid,p_date date,p_amount numeric,p_fx numeric,p_token text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;s jsonb;after_row public.liquidity_accounts%rowtype;delta numeric;delta_base numeric;start date;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or abs(p_amount)>1e12 or p_fx is null or p_fx::text in('NaN','Infinity','-Infinity') or p_fx<=0 or p_fx>1e6 or p_date is null or p_date>current_date or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FISCAL_CASH_INPUT_INVALID';end if;
 -- Serialize with opening approval and fiscal close before taking the bank lock.
 perform pg_advisory_xact_lock(hashtextextended('fiscal-calendar:'||p_org::text,0));
 for start in select fiscal_start from public.financial_opening_workspaces where organization_id=p_org union select (private.financial_fiscal_period(p_org,p_date)->>'start')::date loop
 perform pg_advisory_xact_lock(hashtextextended('reporting-opening:'||p_org::text||start::text,0));
 perform pg_advisory_xact_lock(hashtextextended('fiscal-year:'||p_org::text||start::text,0));end loop;
 select * into b from public.liquidity_accounts where id=p_id and organization_id=p_org for update;
 if b.id is null then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 s:=public.financial_cash_opening_detail(p_org,p_id,p_date);
 if s->>'issue' is not null then raise exception '%',s->>'issue';end if;
 if p_token is distinct from s->>'token' then raise exception 'FISCAL_CASH_VERSION_CONFLICT';end if;
 if b.currency=s->>'baseCurrency' and p_fx<>1 then raise exception 'FISCAL_CASH_FX_INVALID';end if;
 delta:=round(p_amount,4)-(s->>'amount')::numeric;delta_base:=round(p_amount*p_fx,4)-(s->>'baseAmount')::numeric;
 update public.liquidity_accounts set current_balance=current_balance+delta,current_balance_base=current_balance_base+delta_base,
 metadata=coalesce(metadata,'{}')||jsonb_build_object('opening_date',p_date,'opening_balance',round(p_amount,4),'opening_fx_rate',p_fx,'opening_currency',b.currency,'balance_mode','OPENING'),updated_at=now()
 where id=p_id and organization_id=p_org returning * into after_row;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'CASH_OPENING_CORRECT',auth.uid(),jsonb_build_object('bankId',p_id,'before',s,'after',to_jsonb(after_row),'delta',delta,'deltaBase',delta_base,'reason',trim(p_reason)));
 return public.financial_cash_opening_detail(p_org,p_id,p_date);
end $$;
revoke all on function public.correct_financial_cash_opening(uuid,uuid,date,numeric,numeric,text,text) from public,anon;
grant execute on function public.correct_financial_cash_opening(uuid,uuid,date,numeric,numeric,text,text) to authenticated;

-- Legacy actual rows have no posted voucher to reopen. Descriptive corrections
-- are audited separately; this path never changes amounts, dates or cash status.
create function public.financial_cash_flow_source(p_org uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f public.liquidity_flows%rowtype;issue text;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 select * into f from public.liquidity_flows where id=p_id and organization_id=p_org;
 if f.id is null then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 issue:=case when not private.financial_opening_can(p_org,'financial_core.create') then 'FISCAL_WRITE_DENIED'
 when f.status<>'ACTUAL' or f.transfer_id is not null or f.intercompany_transfer_id is not null or coalesce(f.source_module,'MANUAL')<>'MANUAL' then 'FISCAL_CASH_EDIT_FROM_SOURCE'
 when exists(select 1 from public.financial_year_closures where organization_id=p_org and status='CLOSED' and fiscal_start<=f.due_date and fiscal_end>=f.due_date) then 'FISCAL_PERIOD_CLOSED' end;
 return jsonb_build_object('id',f.id,'title',f.title,'reference',f.reference,'notes',f.notes,'date',f.due_date,'amount',f.amount,'currency',f.currency,'direction',f.direction,'issue',issue,'canEdit',issue is null,'token',md5(to_jsonb(f)::text));
end $$;
revoke all on function public.financial_cash_flow_source(uuid,uuid) from public,anon;
grant execute on function public.financial_cash_flow_source(uuid,uuid) to authenticated;
create function public.describe_financial_cash_flow(p_org uuid,p_id uuid,p_title text,p_reference text,p_notes text,p_token text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.liquidity_flows%rowtype;s jsonb;start date;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 160 or length(coalesce(p_reference,''))>120 or length(coalesce(p_notes,''))>500 or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FISCAL_CASH_INPUT_INVALID';end if;
 select * into f from public.liquidity_flows where id=p_id and organization_id=p_org;
 if f.id is null then raise exception 'FISCAL_CASH_ACCESS_DENIED';end if;
 if exists(select 1 from public.financial_fiscal_calendars where organization_id=p_org) then
 start:=(private.financial_fiscal_period(p_org,f.due_date)->>'start')::date;
 perform pg_advisory_xact_lock(hashtextextended('fiscal-year:'||p_org::text||start::text,0));end if;
 select * into f from public.liquidity_flows where id=p_id and organization_id=p_org for update;
 s:=public.financial_cash_flow_source(p_org,p_id);
 if s->>'issue' is not null then raise exception '%',s->>'issue';end if;
 if p_token is distinct from s->>'token' then raise exception 'FISCAL_CASH_VERSION_CONFLICT';end if;
 update public.liquidity_flows set title=trim(p_title),reference=coalesce(p_reference,''),notes=coalesce(p_notes,''),updated_at=now() where id=p_id and organization_id=p_org;
 insert into public.financial_fiscal_audit(organization_id,action,actor_id,detail) values(p_org,'CASH_FLOW_DESCRIBE',auth.uid(),jsonb_build_object('sourceId',p_id,'before',s,'title',trim(p_title),'reference',p_reference,'notes',p_notes,'reason',trim(p_reason)));
 return public.financial_cash_flow_source(p_org,p_id);
end $$;
revoke all on function public.describe_financial_cash_flow(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.describe_financial_cash_flow(uuid,uuid,text,text,text,text,text) to authenticated;
