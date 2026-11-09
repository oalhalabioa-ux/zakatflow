-- Explicitly approved detailed policies apply to subsequent postings.
-- Capture the account resolution once so newer policies cannot recast history.
create table private.financial_event_posting_resolutions (
 organization_id uuid not null references public.organizations(id),
 event_id text not null,
 policy_id uuid not null references public.financial_reporting_policies(id),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 primary key(organization_id,event_id)
);
alter table private.financial_event_posting_resolutions enable row level security;
revoke all on private.financial_event_posting_resolutions from public,anon,authenticated;

create function private.financial_detailed_policy(p_rules jsonb)
returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(p_rules) r where r->'detailed'='true'::jsonb)
$$;

-- A control code may only serve as the bank-from-voucher selector on the
-- appropriate cash leg. Every fixed leg must be an active, postable leaf.
create function private.financial_assert_detailed_rules(p_org uuid,p_rules jsonb)
returns void language plpgsql stable set search_path='' as $$
declare r jsonb;leg text;target_code text;cash_side text;is_cash boolean;
begin
 if jsonb_array_length(p_rules)=0 then raise exception 'REPORTING_POLICY_ACCOUNT_REQUIRED';end if;
 for r in select * from jsonb_array_elements(p_rules) loop
  if r->'detailed' is distinct from 'true'::jsonb then raise exception 'REPORTING_DETAILED_POLICY_REQUIRED';end if;
  if r->>'cashDirection' not in('NON_CASH','INFLOW','OUTFLOW') then raise exception 'REPORTING_POLICY_CASH_DIRECTION_INVALID';end if;
  cash_side:=case r->>'cashDirection' when 'INFLOW' then 'debitAccountId' when 'OUTFLOW' then 'creditAccountId' end;
  foreach leg in array array['debitAccountId','creditAccountId'] loop
   target_code:=r->>leg;
   if leg=cash_side then
    if target_code is distinct from '1000' then raise exception 'REPORTING_VOUCHER_CASH_SELECTOR_REQUIRED';end if;
   else
    select c.reporting_code='1000' into is_cash from public.financial_chart_custom_accounts c
    where c.organization_id=p_org and c.code=target_code and c.is_active and c.is_postable
     and not exists(select 1 from public.financial_chart_custom_accounts child
      where child.organization_id=p_org and child.parent_code=c.code);
    if not found or is_cash then raise exception 'REPORTING_DETAIL_ACCOUNT_REQUIRED';end if;
   end if;
  end loop;
  if r->>'debitAccountId'=r->>'creditAccountId' then raise exception 'REPORTING_POLICY_ACCOUNT_INVALID';end if;
 end loop;
end $$;

-- Identity is the actual settlement's account UUID (or the normalized legacy
-- cash flow's UUID). Neither account names nor a first available bank are used.
create function private.financial_voucher_cash_leaf(p_org uuid,p_event text,p_direction text)
returns text language plpgsql stable set search_path='' as $$
declare account_uuid uuid;account_code text;
begin
 if p_event like 'flow:%' then
  select f.account_id into account_uuid from public.liquidity_flows f
   where f.organization_id=p_org and f.id::text=substring(p_event from 6)
    and f.status='ACTUAL' and f.direction=p_direction;
 elsif p_event ~ '^[0-9a-f-]{36}$' then
  select s.account_id into account_uuid from public.liquidity_settlements s
   where s.organization_id=p_org and s.financial_event_id=p_event::uuid
    and s.status in('POSTED','REVERSED') and s.direction=p_direction;
 end if;
 select c.code into account_code
 from public.financial_cash_account_links l
 join public.liquidity_accounts a on a.id=l.account_id and a.organization_id=l.organization_id
 join public.financial_chart_custom_accounts c on c.id=l.chart_account_id and c.organization_id=l.organization_id
 where l.organization_id=p_org and l.account_id=account_uuid
   and a.active and a.currency=l.currency and a.entity_id is not distinct from l.entity_id
   and c.is_active and c.is_postable and c.reporting_code='1000'
   and not exists(select 1 from public.financial_chart_custom_accounts child
    where child.organization_id=p_org and child.parent_code=c.code);
 return account_code;
end $$;

create function private.financial_resolve_event_posting(p_org uuid,p_event jsonb,p_policy uuid,p_rules jsonb,p_strict boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare l jsonb;r jsonb;previous jsonb;result jsonb:='[]';original text;
 debit text;credit text;signature jsonb;matched integer;ordinal bigint;effective_rule_id text;settled numeric;recognized numeric;
begin
 if p_event->>'organizationId' is distinct from p_org::text then raise exception 'REPORTING_SCOPE_INVALID';end if;
 if jsonb_array_length(p_event->'lines')=0 then raise exception 'REPORTING_POLICY_SOURCE_EMPTY';end if;
 if p_strict then
  if p_event->>'id' ~ '^[0-9a-f-]{36}$' then
   select s.base_amount*case s.direction when 'INFLOW' then 1 else -1 end into settled
   from public.liquidity_settlements s where s.organization_id=p_org
    and s.financial_event_id=(p_event->>'id')::uuid and s.status in('POSTED','REVERSED');
   if found then
    select coalesce(sum((x->>'baseAmount')::numeric*(x->>'recognitionSign')::integer*
     case x->>'cashDirection' when 'INFLOW' then 1 when 'OUTFLOW' then -1 else 0 end),0)
    into recognized from jsonb_array_elements(p_event->'lines') x;
    if recognized is distinct from settled then raise exception 'REPORTING_VOUCHER_CASH_AMOUNT_INVALID';end if;
   end if;
  end if;
  original:=p_event->>'reversesEventId';
  if original is null and p_event->>'id' ~ '^[0-9a-f-]{36}$' then
   select related_event_id::text into original from public.financial_event_links
   where organization_id=p_org and event_id=(p_event->>'id')::uuid and link_type='REVERSAL_OF';
  end if;
  if original is not null then
   select lines into previous from private.financial_event_posting_resolutions
    where organization_id=p_org and event_id=original;
   if previous is null then raise exception 'REPORTING_REVERSAL_POSTING_REQUIRED';end if;
  end if;
 end if;
 for l in select * from jsonb_array_elements(p_event->'lines') loop
  signature:=jsonb_build_object('classificationId',l->>'classificationId','cashDirection',l->>'cashDirection');
  if previous is not null then
   select x into r from jsonb_array_elements(previous) x where x @> signature limit 1;
   if r is null then raise exception 'REPORTING_REVERSAL_POSTING_REQUIRED';end if;
   effective_rule_id:=r->>'ruleId';
  else
   select count(*),jsonb_agg(x)->0,min(i) into matched,r,ordinal
   from jsonb_array_elements(p_rules) with ordinality as rules(x,i)
   where x @> signature and x->>'eventType'=p_event->>'eventType' and x->>'sourceModule'=p_event->>'sourceModule';
   if matched<>1 then raise exception 'REPORTING_POLICY_SOURCE_UNMAPPED';end if;
   effective_rule_id:=p_policy::text||':'||ordinal;
  end if;
  debit:=r->>'debitAccountId';credit:=r->>'creditAccountId';
  if debit is null or credit is null then raise exception 'REPORTING_POLICY_ACCOUNT_REQUIRED';end if;
  if p_strict and previous is null then
   if l->>'cashDirection'='INFLOW' then debit:=private.financial_voucher_cash_leaf(p_org,p_event->>'id','INFLOW');end if;
   if l->>'cashDirection'='OUTFLOW' then credit:=private.financial_voucher_cash_leaf(p_org,p_event->>'id','OUTFLOW');end if;
   if debit is null or credit is null then raise exception 'REPORTING_VOUCHER_CASH_LINK_REQUIRED';end if;
  end if;
  result:=result||jsonb_build_array(signature||jsonb_strip_nulls(jsonb_build_object(
   'lineId',l->>'id','ruleId',effective_rule_id,'debitAccountId',debit,'creditAccountId',credit,'cashActivity',r->'cashActivity')));
 end loop;
 return result;
end $$;

create function private.financial_capture_policy_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.financial_reporting_policies%rowtype;ev jsonb;selected_rules jsonb;selected_policy uuid;
begin
 if new.status<>'APPROVED' or old.status='APPROVED' then return new;end if;
 select * into prior from public.financial_reporting_policies
  where organization_id=new.organization_id and fiscal_start=new.fiscal_start
   and id<>new.id and approved_at is not null
  order by approved_at desc,id desc limit 1;
 if not private.financial_detailed_policy(new.rules) then
  if prior.id is not null and private.financial_detailed_policy(prior.rules)
   then raise exception 'REPORTING_DETAILED_POLICY_REQUIRED';end if;
  return new;
 end if;
 perform private.financial_assert_detailed_rules(new.organization_id,new.rules);
 selected_policy:=coalesce(prior.id,new.id);
 selected_rules:=coalesce(prior.rules,new.rules);
 if selected_rules='[]'::jsonb then selected_policy:=new.id;selected_rules:=new.rules;end if;
 for ev in select value from jsonb_array_elements(private.financial_policy_postable_events(new.organization_id,new.fiscal_start,new.fiscal_end))
  order by value->>'date',case when value ? 'reversesEventId' then 1 else 0 end
 loop
  if not exists(select 1 from private.financial_event_posting_resolutions
   where organization_id=new.organization_id and event_id=ev->>'id') then
   insert into private.financial_event_posting_resolutions values(new.organization_id,ev->>'id',selected_policy,
    private.financial_resolve_event_posting(new.organization_id,ev,selected_policy,selected_rules,private.financial_detailed_policy(selected_rules)));
  end if;
 end loop;
 return new;
end $$;
create trigger financial_detailed_policy_history before update of status on public.financial_reporting_policies
 for each row execute function private.financial_capture_policy_history();

-- The deferred trigger observes the settled voucher and its lines together.
-- A missing mapping rolls back the whole native posting transaction.
create function private.financial_capture_actual_posting()
returns trigger language plpgsql security definer set search_path='' as $$
declare period_start date;pol public.financial_reporting_policies%rowtype;ev jsonb;
begin
 if new.status<>'ACTUAL' then return null;end if;
 if tg_op='UPDATE' and old.status='ACTUAL' then return null;end if;
 select fiscal_start into period_start from public.financial_reporting_policies
  where organization_id=new.organization_id and status in('APPROVED','DRAFT') and new.event_date between fiscal_start and fiscal_end
  order by (status='APPROVED') desc,fiscal_start desc limit 1;
 if period_start is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||new.organization_id::text||period_start::text,0));
 select * into pol from public.financial_reporting_policies
  where organization_id=new.organization_id and fiscal_start=period_start and status='APPROVED';
 if pol.id is null or not private.financial_detailed_policy(pol.rules) then return null;end if;
 if exists(select 1 from private.financial_event_posting_resolutions
  where organization_id=new.organization_id and event_id=new.id::text) then return null;end if;
 select value into ev from jsonb_array_elements(private.financial_reporting_events(new.organization_id,new.event_date,new.event_date))
  where value->>'id'=new.id::text;
 if ev is null then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 insert into private.financial_event_posting_resolutions values(new.organization_id,new.id::text,pol.id,
  private.financial_resolve_event_posting(new.organization_id,ev,pol.id,pol.rules,true));
 return null;
end $$;
create constraint trigger financial_detailed_actual_posting after insert or update of status on public.financial_events
 deferrable initially deferred for each row execute function private.financial_capture_actual_posting();

-- Reuse the same resolved legs for live statements and the SQL closing trial.
create function private.financial_apply_resolved_postings(p_org uuid,p_snapshot jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare ev jsonb;l jsonb;resolved jsonb;item jsonb;event_lines jsonb;events jsonb:='[]';accounts jsonb;used_codes text[]:='{}';
 policy_id uuid;policy_rules jsonb;
begin
 policy_id:=(p_snapshot->'policy'->>'id')::uuid;
 select rules into policy_rules from public.financial_reporting_policies where id=policy_id and organization_id=p_org;
 if not coalesce(private.financial_detailed_policy(policy_rules),false) then return p_snapshot;end if;
 for item in select * from jsonb_array_elements(policy_rules) loop
  used_codes:=array_append(array_append(used_codes,item->>'debitAccountId'),item->>'creditAccountId');
 end loop;
 for ev in select * from jsonb_array_elements(p_snapshot->'events') loop
  if (ev->>'date')::date>(p_snapshot->>'to')::date then events:=events||jsonb_build_array(ev);continue;end if;
  select lines into resolved from private.financial_event_posting_resolutions where organization_id=p_org and event_id=ev->>'id';
  if resolved is null then
   if ev->>'id' ~ '^[0-9a-f-]{36}$' then raise exception 'REPORTING_EVENT_POSTING_REQUIRED';end if;
   resolved:=private.financial_resolve_event_posting(p_org,ev,policy_id,policy_rules,true);
  end if;
  event_lines:='[]';
  for l in select * from jsonb_array_elements(ev->'lines') loop
   select x into item from jsonb_array_elements(resolved) x where x->>'lineId'=l->>'id';
   if item is null then raise exception 'REPORTING_EVENT_POSTING_REQUIRED';end if;
   used_codes:=array_append(array_append(used_codes,item->>'debitAccountId'),item->>'creditAccountId');
   event_lines:=event_lines||jsonb_build_array(l||jsonb_build_object('resolvedPosting',item));
  end loop;
  events:=events||jsonb_build_array(jsonb_set(ev,'{lines}',event_lines));
 end loop;
 select p_snapshot->'accounts'||coalesce(jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',p_snapshot->>'currency')),'[]')
  into accounts from (
   select root a from jsonb_array_elements(public.financial_reporting_chart()) root
   union all
   select root||jsonb_build_object('id',c.code,'code',c.code,'ar',c.name_ar,'en',c.name_en,
    'reportingCode',c.reporting_code,'parentCode',c.parent_code)
   from public.financial_chart_custom_accounts c
   join lateral (select root from jsonb_array_elements(public.financial_reporting_chart()) root
    where root->>'id'=c.reporting_code) category on true
   where c.organization_id=p_org and c.code=any(used_codes)
  ) available
  where a->>'id'=any(used_codes) and not exists(select 1 from jsonb_array_elements(p_snapshot->'accounts') existing where existing->>'id'=a->>'id');
 return p_snapshot||jsonb_build_object('events',events,'accounts',accounts,
  'coverage',(p_snapshot->'coverage')||jsonb_build_object('eventCount',jsonb_array_length(events),
   'lineCount',(select coalesce(sum(jsonb_array_length(x->'lines')),0) from jsonb_array_elements(events) x)));
end $$;

do $$
declare signature text;definition text;needle text;
begin
 definition:=pg_get_functiondef('public.save_financial_reporting_policy(uuid,date,integer,jsonb,text)'::regprocedure);
 needle:=$old$'creditAccountId','cashActivity'))$old$;
 if strpos(definition,needle)=0 then raise exception 'REPORTING_POLICY_SAVE_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,$new$'creditAccountId','cashActivity','detailed'))
   or (rule ? 'detailed' and rule->'detailed' is distinct from 'true'::jsonb)$new$);
 foreach signature in array array['private.financial_statement_live_snapshot_v1(uuid,date,date)','public.financial_statement_first_activity_snapshot(uuid,date,date)'] loop
  if to_regprocedure(signature) is null and signature like 'public.%' then continue;end if;
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='return jsonb_build_object(''origin'',''LIVE_CANONICAL_EVENTS''';
  if strpos(definition,needle)=0 then
   definition:=regexp_replace(definition,'return jsonb_build_object[(][[:space:]]+''origin'',''LIVE_CANONICAL_EVENTS''',needle);
  end if;
  if strpos(definition,needle)=0 or strpos(definition,'''readAt'',statement_timestamp()));')=0
   then raise exception 'REPORTING_SNAPSHOT_SIGNATURE_CHANGED: %',signature;end if;
  definition:=replace(definition,needle,'return private.financial_apply_resolved_postings(p_org,jsonb_build_object(''origin'',''LIVE_CANONICAL_EVENTS''');
  execute replace(definition,'''readAt'',statement_timestamp()));','''readAt'',statement_timestamp())));');
 end loop;
 definition:=pg_get_functiondef('public.financial_reporting_policy_workspace(uuid,date)'::regprocedure);
 needle:='''events'',result,';
 if strpos(definition,needle)=0 then raise exception 'REPORTING_POLICY_WORKSPACE_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,$workspace$'events',(
  select coalesce(jsonb_agg(ev||jsonb_build_object('voucherCashAccount',
    private.financial_voucher_cash_leaf(p_org,coalesce(ev->>'reversesEventId',ev->>'id'),direction))), '[]'::jsonb)
  from jsonb_array_elements(result) ev
  left join lateral (select l->>'cashDirection' direction from jsonb_array_elements(ev->'lines') l
   where l->>'cashDirection' in('INFLOW','OUTFLOW') limit 1) cash on true
 ),$workspace$);
 definition:=pg_get_functiondef('private.financial_fiscal_trial_detail_v1(jsonb,text)'::regprocedure);
 needle:='if n<>1 then raise exception ''FISCAL_POSTING_RULE_REQUIRED'';end if;';
 if strpos(definition,needle)=0 then raise exception 'REPORTING_FISCAL_TRIAL_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,'if l ? ''resolvedPosting'' then rule:=l->''resolvedPosting'';n:=1; elsif rule->''detailed''=''true''::jsonb then raise exception ''FISCAL_EVENT_POSTING_REQUIRED'';end if; '||needle);
end $$;

revoke all on function private.financial_detailed_policy(jsonb),
 private.financial_assert_detailed_rules(uuid,jsonb),private.financial_voucher_cash_leaf(uuid,text,text),
 private.financial_resolve_event_posting(uuid,jsonb,uuid,jsonb,boolean),private.financial_capture_policy_history(),
 private.financial_capture_actual_posting(),private.financial_apply_resolved_postings(uuid,jsonb)
 from public,anon,authenticated;
notify pgrst,'reload schema';
