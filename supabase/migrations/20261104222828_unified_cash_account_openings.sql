-- Forward-only: no existing balances, approvals or postings are rewritten.
create table public.financial_cash_account_links(
 account_id uuid primary key references public.liquidity_accounts(id) on delete cascade,
 organization_id uuid not null references public.organizations(id),
 chart_account_id uuid not null references public.financial_chart_custom_accounts(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(organization_id,chart_account_id)
);
alter table public.financial_cash_account_links enable row level security;
create policy cash_chart_links_read on public.financial_cash_account_links for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_cash_account_links from public,anon,authenticated;
grant select on public.financial_cash_account_links to authenticated;

create function private.financial_link_cash_account(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare b public.liquidity_accounts%rowtype;code text;parent text;child jsonb;
begin
 select * into b from public.liquidity_accounts where id=p_id;
 if b.id is null or auth.uid() is null or not private.financial_opening_can(b.organization_id,'financial_core.create') then raise exception 'FISCAL_WRITE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||b.organization_id::text,0));
 select c.code into code from public.financial_cash_account_links l join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where l.account_id=p_id and l.organization_id=b.organization_id;
 if code is not null then return code;end if;
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
 child:=public.save_financial_chart_account(b.organization_id,code,parent,case when length(trim(b.name))<2 then b.name||' ·' else b.name end,case when length(trim(b.name))<2 then b.name||' ·' else b.name end,'DEBIT',true,true,0,'Automatic link to cash register '||b.id);
 insert into public.financial_cash_account_links(account_id,organization_id,chart_account_id,created_by) values(b.id,b.organization_id,(child->>'id')::uuid,auth.uid());
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

create function private.financial_cash_chart_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.financial_cash_account_links where chart_account_id=old.id)
 and (not new.is_active or not new.is_postable or new.reporting_code<>'1000' or new.normal_side<>'DEBIT') then raise exception 'CHART_CASH_ACCOUNT_IN_USE';end if;
 return new;
end $$;
create trigger financial_cash_chart_guard before update on public.financial_chart_custom_accounts for each row execute function private.financial_cash_chart_guard();
revoke all on function private.financial_cash_chart_guard() from public,anon,authenticated;

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
 or (p_payload->>'balance_mode'='NEW' and amt<>0)
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
