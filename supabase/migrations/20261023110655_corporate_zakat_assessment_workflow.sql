-- Immutable source evidence and a single financial obligation per reviewed period.
create table public.corporate_zakat_sources (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 model text not null check(model in('SIMPLE','SAUDI')), assessment_date date not null, period_start date,
 currency text not null, entries jsonb not null, warnings jsonb not null default '[]', created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.corporate_zakat_sources enable row level security;
revoke all on public.corporate_zakat_sources from public,anon,authenticated;
grant select on public.corporate_zakat_sources to authenticated;
create policy corporate_zakat_sources_read on public.corporate_zakat_sources for select to authenticated using(public.has_organization_permission(organization_id,'zakat.view'));
create index corporate_zakat_sources_org on public.corporate_zakat_sources(organization_id,created_at desc);

create table public.corporate_zakat_finalizations (
 assessment_id uuid primary key references public.manual_zakat_assessments(id), organization_id uuid not null references public.organizations(id),
 period_start date not null, period_end date not null check(period_end>=period_start),
 final_base numeric not null check(final_base>=0), final_rate numeric not null check(final_rate>=0 and final_rate<=1), amount numeric not null check(amount>=0),
 review_reference text not null, financial_event_id uuid unique references public.financial_events(id), obligation_id uuid unique references public.financial_event_obligations(id), flow_id uuid unique references public.liquidity_flows(id) on delete set null,
 prepared_by uuid not null references auth.users(id), created_at timestamptz not null default now(), approved_by uuid references auth.users(id), approved_at timestamptz, cancelled_at timestamptz,
 check((amount=0 and financial_event_id is null and obligation_id is null and flow_id is null) or (amount>0 and financial_event_id is not null and obligation_id is not null))
);
alter table public.corporate_zakat_finalizations enable row level security;
revoke all on public.corporate_zakat_finalizations from public,anon,authenticated;
grant select on public.corporate_zakat_finalizations to authenticated;
create policy corporate_zakat_finalizations_read on public.corporate_zakat_finalizations for select to authenticated using(public.has_organization_permission(organization_id,'zakat.view'));
create index corporate_zakat_finalizations_org on public.corporate_zakat_finalizations(organization_id,period_start,period_end);

create or replace function private.capture_corporate_zakat_sources(p_org uuid,p_model text,p_date date,p_start date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cur text; items jsonb:='[]';warnings jsonb:='[]'; rec record; field text;val numeric;qty numeric;cost numeric;mid uuid;future boolean;rowdata public.corporate_zakat_sources%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 if not public.has_organization_permission(p_org,'zakat.view') or not public.has_organization_permission(p_org,'assets.view') or not public.financial_core_can(p_org,'financial_core.view') or not public.has_organization_permission(p_org,'liquidity.view') then raise exception 'CORPORATE_ZAKAT_ACCESS_DENIED';end if;
 if p_model not in('SIMPLE','SAUDI') or p_date is null or p_date>(now() at time zone 'Asia/Riyadh')::date or p_start>p_date then raise exception 'CORPORATE_ZAKAT_DATE_INVALID';end if;
 select base_currency into cur from public.organizations where id=p_org;
 -- Current account book balance, rolled back by actual dated movements only.
 if p_model='SIMPLE' then
 for rec in select * from public.liquidity_accounts where organization_id=p_org and account_type in('CASH','BANK','WALLET') loop
  if rec.metadata->>'opening_date'>p_date::text then continue;end if;
  if rec.currency<>cur then
   warnings:=warnings||jsonb_build_array('FOREIGN_CASH_REQUIRES_VALUATION');continue;
  end if;
  val:=rec.current_balance_base;
  select val-coalesce(sum(case when s.direction='INFLOW' then s.base_amount else -s.base_amount end),0) into val from public.liquidity_settlements s where s.account_id=rec.id and s.organization_id=p_org and s.status in('POSTED','REVERSED') and s.settlement_date>p_date;
  select val-coalesce(sum(case when f.direction='INFLOW' then f.base_amount else -f.base_amount end),0) into val from public.liquidity_flows f where f.account_id=rec.id and f.organization_id=p_org and f.status='ACTUAL' and f.due_date>p_date and not exists(select 1 from public.financial_event_links l where l.target_record_id=f.id and l.target_module='liquidity_flows');
  if val<0 then warnings:=warnings||jsonb_build_array('NEGATIVE_CASH_REQUIRES_REVIEW');continue;end if;
  items:=items||jsonb_build_array(jsonb_build_object('field','cash','id',rec.id,'name',rec.name,'value',val,'source','LIQUIDITY','date',p_date));
 end loop;
 end if;
 -- Explicit obligations, never event-line sums for receivables or liabilities.
 for rec in select o.*,e.event_date,e.description,e.source_module from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id where o.organization_id=p_org and o.adjusts_obligation_id is null and o.obligation_type in('RECEIVABLE','PAYABLE') and e.status='ACTUAL' and e.event_date<=p_date and e.source_module<>'ZAKAT_ASSESSMENT' loop
  val:=rec.settleable_base_amount;
  select val+coalesce(sum(case when a.adjustment_effect='INCREASE' then a.settleable_base_amount else -a.settleable_base_amount end),0) into val from public.financial_event_obligations a join public.financial_events e on e.id=a.event_id where a.adjusts_obligation_id=rec.id and e.status='ACTUAL' and e.event_date<=p_date;
  select val-coalesce(sum(a.base_amount),0) into val from public.financial_event_obligation_allocations a join public.financial_events e on e.id=a.application_event_id where a.obligation_id=rec.id and e.status='ACTUAL' and e.event_date<=p_date;
  if val<=0 then continue;end if;
  field:=case when rec.obligation_type='RECEIVABLE' then 'debtors' when p_model='SIMPLE' then 'due_debts' else 'liabilities' end;
  if p_model='SAUDI' and field='debtors' then continue;end if;
  items:=items||jsonb_build_array(jsonb_build_object('field',field,'id',rec.id,'name',rec.description,'value',val,'source','OBLIGATIONS','date',p_date));
 end loop;
 if p_date<(now() at time zone 'Asia/Riyadh')::date and exists(select 1 from public.financial_events e where e.organization_id=p_org and e.status='REVERSED') then warnings:=warnings||jsonb_build_array('HISTORICAL_REVERSALS_REQUIRE_REVIEW');end if;
 -- Original lot values less allocations provide book values; never use a future quote.
 for rec in select * from public.asset_accounts where organization_id=p_org and ownership_scope='ORGANIZATION' and asset_type not in('CASH','BANK','RECEIVABLE') and coalesce(metadata->>'archived','false')<>'true' loop
  select coalesce(sum(l.remaining_quantity),0),coalesce(sum(l.remaining_value_base),0) into qty,cost from public.lots l where l.asset_account_id=rec.id and l.acquisition_date<=p_date and coalesce(l.metadata->>'recognition_pending','false')<>'true';
  if qty<=0 then continue;end if;
  select exists(select 1 from public.transactions t where t.asset_account_id=rec.id and t.transaction_date>p_date) into future;
  if future then warnings:=warnings||jsonb_build_array('ASSET_HISTORY_REQUIRES_REVIEW');continue;end if;
  field:=null;
  if p_model='SAUDI' then
   if rec.asset_class_code in('PPE','INTANGIBLE') or rec.asset_type='REAL_ESTATE' and coalesce(rec.metadata->>'holding_purpose','')<>'TRADE' then field:='fixed_assets';
   elsif rec.asset_class_code='INVESTMENT' or rec.asset_type='STOCK' or rec.metadata ? 'investment_id' then field:='deductible_investments';end if;
   val:=cost;
  else
   field:=case when rec.asset_class_code='INVENTORY' or rec.asset_type='INVENTORY' or rec.asset_type='REAL_ESTATE' and rec.metadata->>'holding_purpose'='TRADE' then 'inventory' when rec.asset_class_code='INVESTMENT' or rec.asset_type='STOCK' or rec.metadata ? 'investment_id' then 'investments' when rec.is_zakatable then 'other' else null end;
   val:=cost;
   if coalesce(rec.metadata->>'market_valuation_date','9999-12-31')<=p_date::text and coalesce(rec.metadata->>'market_price_currency',rec.currency)=cur and coalesce((rec.metadata->>'market_price_per_unit')::numeric,(rec.metadata->>'market_price')::numeric,0)>0 then val:=qty*coalesce((rec.metadata->>'market_price_per_unit')::numeric,(rec.metadata->>'market_price')::numeric);end if;
  end if;
  if field is not null then items:=items||jsonb_build_array(jsonb_build_object('field',field,'id',rec.id,'name',rec.name,'value',val,'source','ASSET_BOOK_OR_SAVED_VALUE','date',p_date));end if;
 end loop;
 -- Investment balances are sourced once from the dedicated investment ledger.
 for rec in select i.*,sum(case when m.kind='CAPITAL_RECEIPT' then m.amount when m.kind in('CAPITAL_RETURN','LOSS') then -m.amount else 0 end) carrying from public.participation_contracts i join public.participation_movements m on m.contract_id=i.id and m.organization_id=i.organization_id where i.organization_id=p_org and i.direction='OUTGOING' and i.deleted_at is null and m.execution_state='POSTED' and m.event_date<=p_date group by i.id loop
  if rec.currency<>cur then warnings:=warnings||jsonb_build_array('FOREIGN_INVESTMENT_REQUIRES_VALUATION');continue;end if;
  if rec.carrying>0 then items:=items||jsonb_build_array(jsonb_build_object('field',case when p_model='SIMPLE' then 'investments' else 'deductible_investments' end,'id',rec.id,'name',rec.project,'value',rec.carrying,'source','INVESTMENT_LEDGER','date',p_date));end if;
 end loop;
 if p_model='SAUDI' then
  for rec in select l.id,e.event_date,e.description,l.base_amount,c.classification_type from public.financial_event_lines l join public.financial_events e on e.id=l.event_id and e.organization_id=l.organization_id join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.organization_id=p_org and e.status='ACTUAL' and e.event_date<=p_date and (c.classification_type='EQUITY' or p_start is not null and e.event_date>=p_start and c.classification_type in('REVENUE','OPEX','ZAKAT')) loop
   field:=case when rec.classification_type='EQUITY' then 'equity' else 'book_profit' end;val:=case when rec.classification_type in('OPEX','ZAKAT') then -rec.base_amount else rec.base_amount end;
   items:=items||jsonb_build_array(jsonb_build_object('field',field,'id',rec.id,'name',rec.description,'value',val,'source','FINANCIAL_LEDGER','date',rec.event_date));
  end loop;
 end if;
 insert into public.corporate_zakat_sources(organization_id,model,assessment_date,period_start,currency,entries,warnings,created_by) values(p_org,p_model,p_date,p_start,cur,items,warnings,auth.uid()) returning * into rowdata;
 return to_jsonb(rowdata);
end $$;
revoke all on function private.capture_corporate_zakat_sources(uuid,text,date,date) from public,anon;
grant execute on function private.capture_corporate_zakat_sources(uuid,text,date,date) to authenticated;
create function public.capture_corporate_zakat_sources(p_org uuid,p_model text,p_date date,p_start date default null) returns jsonb language sql security invoker set search_path='' as $$select private.capture_corporate_zakat_sources($1,$2,$3,$4);$$;
revoke all on function public.capture_corporate_zakat_sources(uuid,text,date,date) from public,anon;
grant execute on function public.capture_corporate_zakat_sources(uuid,text,date,date) to authenticated;

create or replace function private.corporate_zakat_command(p_action text,p_id uuid,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.manual_zakat_assessments%rowtype;f public.corporate_zakat_finalizations%rowtype;e public.financial_events%rowtype;cur text;eid uuid;oid uuid;fid uuid;cid uuid;cat uuid;v numeric;ded numeric;base numeric;rate numeric;due numeric;startd date;reference text;fp jsonb;fields text[];item text;sn public.corporate_zakat_sources%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 select * into a from public.manual_zakat_assessments where id=p_id;
 if a.id is null or a.organization_id is null or a.model not in('SIMPLE','SAUDI') then raise exception 'CORPORATE_ZAKAT_ASSESSMENT_REQUIRED';end if;
 if not public.has_organization_permission(a.organization_id,'zakat.edit') or not public.financial_core_can(a.organization_id,'financial_core.view') then raise exception 'CORPORATE_ZAKAT_ACCESS_DENIED';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('corporate-zakat:'||a.organization_id::text,0));
 select * into f from public.corporate_zakat_finalizations where assessment_id=a.id for update;
 if p_action='PREPARE' then
  if f.assessment_id is not null then raise exception 'CORPORATE_ZAKAT_ALREADY_PREPARED';end if;
  if not public.financial_core_can(a.organization_id,'financial_core.create') then raise exception 'CORPORATE_ZAKAT_CREATE_DENIED';end if;
  if a.input->>'organization_id' is distinct from a.organization_id::text or a.input->>'assessment_date' is distinct from a.assessment_date::text or a.input->>'independent_source_confirmed' is distinct from 'true' then raise exception 'CORPORATE_ZAKAT_VALUES_INVALID';end if;
  if p_payload->>'review_confirmed' is distinct from 'true' then raise exception 'CORPORATE_ZAKAT_REVIEW_REQUIRED';end if;
  startd:=(p_payload->>'period_start')::date;reference:=btrim(p_payload->>'review_reference');
  if startd is null or startd>a.assessment_date or a.assessment_date>(now() at time zone 'Asia/Riyadh')::date or length(coalesce(reference,'')) not between 10 and 1000 then raise exception 'CORPORATE_ZAKAT_REVIEW_REQUIRED';end if;
  select base_currency into cur from public.organizations where id=a.organization_id;
  if cur<>a.currency then raise exception 'CORPORATE_ZAKAT_BASE_CURRENCY_REQUIRED';end if;
  if exists(select 1 from public.corporate_zakat_finalizations x left join public.financial_events ev on ev.id=x.financial_event_id where x.organization_id=a.organization_id and x.period_start<=a.assessment_date and x.period_end>=startd and x.cancelled_at is null and (x.financial_event_id is null or ev.status not in('CANCELLED','REVERSED'))) then raise exception 'CORPORATE_ZAKAT_PERIOD_ALREADY_EXISTS';end if;
  if nullif(a.input->>'source_snapshot_id','') is not null then
   select * into sn from public.corporate_zakat_sources where id=(a.input->>'source_snapshot_id')::uuid and organization_id=a.organization_id and model=a.model and assessment_date=a.assessment_date and currency=a.currency;
   if sn.id is null then raise exception 'CORPORATE_ZAKAT_SOURCE_MISMATCH';end if;
   if sn.period_start is distinct from nullif(a.input->>'period_start','')::date then raise exception 'CORPORATE_ZAKAT_SOURCE_MISMATCH';end if;
  end if;
  if a.model='SIMPLE' then
   fields:=array['cash','debtors','inventory','investments','other','due_debts'];base:=0;ded:=0;
   foreach item in array fields loop
    if a.input->'values'->>item is null then raise exception 'CORPORATE_ZAKAT_FIELDS_INCOMPLETE';end if;
    v:=(a.input->'values'->>item)::numeric;if v<0 or v>1000000000000 or v::text in('NaN','Infinity','-Infinity') then raise exception 'CORPORATE_ZAKAT_VALUES_INVALID';end if;
    if item='due_debts' then ded:=v;else base:=base+v;end if;
   end loop;
   if a.input->>'debt_policy'='DUE' then base:=base-ded;end if;base:=greatest(base,0);rate:=0.025;
   if a.input->>'hawl_completed' is distinct from 'true' or coalesce((a.input->>'nisab_value')::numeric,0)<=0 or coalesce(a.input->>'nisab_reference','')='' then raise exception 'CORPORATE_ZAKAT_CONDITIONS_REQUIRED';end if;
   if base<(a.input->>'nisab_value')::numeric then base:=0;end if;
   if a.input->>'period_basis'='FINANCIAL' then
    if nullif(a.input->>'period_start','')::date is distinct from startd or nullif(a.input->>'period_end','')::date is distinct from a.assessment_date or (a.input->>'hijri_days')::int not in(354,355) then raise exception 'CORPORATE_ZAKAT_DATE_INVALID';end if;
    rate:=rate*(a.assessment_date-startd+1)/(a.input->>'hijri_days')::numeric;
   end if;
  else
   fields:=array['equity','liabilities','book_profit','adjusted_profit','fixed_assets','deductible_investments','other_deductions'];
   foreach item in array fields loop
    if a.input->'values'->>item is null then raise exception 'CORPORATE_ZAKAT_FIELDS_INCOMPLETE';end if;
    v:=(a.input->'values'->>item)::numeric;if abs(v)>1000000000000 or v::text in('NaN','Infinity','-Infinity') or v<0 and item not in('book_profit','adjusted_profit') then raise exception 'CORPORATE_ZAKAT_VALUES_INVALID';end if;
   end loop;
   base:=(p_payload->>'final_base')::numeric;rate:=(p_payload->>'final_rate')::numeric;
   if base is null or base<0 or base>1000000000000 or rate is null or rate<=0 or rate>0.1 or base::text in('NaN','Infinity','-Infinity') or rate::text in('NaN','Infinity','-Infinity') or p_payload->>'regulatory_confirmed' is distinct from 'true' then raise exception 'CORPORATE_ZAKAT_REGULATORY_REVIEW_REQUIRED';end if;
  end if;
  due:=round(base*rate,2);
  if due>0 then
   insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by) values(a.organization_id,'CORPORATE_ZAKAT_ACCRUAL','استحقاق الزكاة المؤسسية','ZAKAT',true,auth.uid()) on conflict(organization_id,code) do nothing;
   select id into cid from public.financial_classifications where organization_id=a.organization_id and code='CORPORATE_ZAKAT_ACCRUAL' and classification_type='ZAKAT' and active;
   if cid is null then raise exception 'CORPORATE_ZAKAT_CLASSIFICATION_REQUIRED';end if;
   perform pg_catalog.set_config('app.corporate_zakat',a.id::text,true);
   eid:=public.create_financial_event_command(jsonb_build_object('organization_id',a.organization_id,'event_type','EXPENSE','source_module','ZAKAT_ASSESSMENT','source_record_id',a.id,'source_event_key','corporate-zakat:'||a.id,'description','زكاة / '||a.title,'event_date',a.assessment_date,'due_date',a.assessment_date,'base_currency',cur,
    'lines',jsonb_build_array(jsonb_build_object('line_number',1,'description',a.title,'classification_id',cid,'amount',due,'currency',cur,'exchange_rate',1,'base_amount',due,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),
    'obligations',jsonb_build_array(jsonb_build_object('obligation_key','corporate-zakat','obligation_type','PAYABLE','settleable_amount',due,'currency',cur,'exchange_rate',1,'base_currency',cur,'settleable_base_amount',due))));
   perform pg_catalog.set_config('app.corporate_zakat','',true);
   select id into oid from public.financial_event_obligations where event_id=eid and obligation_key='corporate-zakat';
   insert into public.liquidity_flow_categories(organization_id,code,name_ar,name_en,flow_group,allowed_direction,accounting_group,treatment_code,is_system) values(a.organization_id,'CORPORATE_ZAKAT_ACCRUAL','استحقاق الزكاة','Zakat liability','TAX','OUTFLOW','ZAKAT','ZAKAT_ACCRUAL',true) on conflict(organization_id,code) do nothing;
   select id into cat from public.liquidity_flow_categories where organization_id=a.organization_id and code='CORPORATE_ZAKAT_ACCRUAL' and accounting_group='ZAKAT' and active;
   if cat is null then raise exception 'CORPORATE_ZAKAT_CLASSIFICATION_REQUIRED';end if;
   insert into public.liquidity_flows(category_id,organization_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,source_module,source_record_id,source_event_key,created_by)
    values(cat,a.organization_id,'OUTFLOW','TAX','زكاة / '||a.title,a.assessment_date,due,cur,due,'EXPECTED','ACCOUNTING','ZAKAT_ASSESSMENT',a.id,'corporate-zakat:'||a.id,auth.uid()) returning id into fid;
   insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata,created_by) values(eid,a.organization_id,'CASH_FLOW','liquidity_flows',fid,jsonb_build_object('obligation_id',oid,'manual_assessment_id',a.id,'due_date',a.assessment_date),auth.uid());
   perform public.transition_financial_event(eid,'PLANNED','Corporate zakat review');perform public.transition_financial_event(eid,'COMMITTED','Corporate zakat submitted');
  end if;
  insert into public.corporate_zakat_finalizations(assessment_id,organization_id,period_start,period_end,final_base,final_rate,amount,review_reference,financial_event_id,obligation_id,flow_id,prepared_by) values(a.id,a.organization_id,startd,a.assessment_date,base,rate,due,reference,eid,oid,fid,auth.uid()) returning * into f;
 elsif p_action in('APPROVE','POST','CANCEL') then
  if f.assessment_id is null then raise exception 'CORPORATE_ZAKAT_NOT_PREPARED';end if;
  if f.cancelled_at is not null then raise exception 'CORPORATE_ZAKAT_CANCELLED';end if;
  if f.financial_event_id is not null then
   select * into e from public.financial_events where id=f.financial_event_id for update;
   if p_action='APPROVE' and e.status='ACTUAL' then return to_jsonb(f);end if;
   if p_action='APPROVE' then if not public.financial_event_has_valid_approval(e.id) then perform public.approve_financial_event(e.id,'Corporate zakat reviewed: '||f.review_reference);end if;
   elsif p_action='POST' then if e.status<>'ACTUAL' then perform public.transition_financial_event(e.id,'ACTUAL','Corporate zakat liability recognized');end if;
   elsif p_action='CANCEL' then
    if e.status not in('DRAFT','PLANNED','COMMITTED') then raise exception 'CORPORATE_ZAKAT_POSTED_CORRECTION_REQUIRED';end if;
    perform public.transition_financial_event(e.id,'CANCELLED',coalesce(p_payload->>'reason','Corporate zakat review cancelled'));
    delete from public.financial_event_links where event_id=e.id and target_record_id=f.flow_id;
    delete from public.liquidity_flows where id=f.flow_id; -- historical finalization link retained by nullable FK below
   end if;
  else
   if p_action='CANCEL' and f.approved_at is null and public.financial_core_can(a.organization_id,'financial_core.create') then
    update public.corporate_zakat_finalizations set cancelled_at=now() where assessment_id=a.id returning * into f;return to_jsonb(f);
   end if;
   if p_action='APPROVE' and f.approved_at is not null then return to_jsonb(f);end if;
   if p_action<>'APPROVE' or not public.financial_core_can(a.organization_id,'financial_core.approve') or f.prepared_by=auth.uid() and not public.can_self_approve_financial_event(a.organization_id) then raise exception 'CORPORATE_ZAKAT_APPROVE_DENIED';end if;
   update public.corporate_zakat_finalizations set approved_by=auth.uid(),approved_at=now() where assessment_id=a.id and approved_at is null returning * into f;
  end if;
 else raise exception 'CORPORATE_ZAKAT_ACTION_INVALID';end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(auth.uid(),'manual_zakat_assessment',a.id,'CORPORATE_ZAKAT_'||p_action,to_jsonb(f));
 return to_jsonb(f);
end $$;
revoke all on function private.corporate_zakat_command(text,uuid,jsonb) from public,anon;
grant execute on function private.corporate_zakat_command(text,uuid,jsonb) to authenticated;
create function public.corporate_zakat_command(p_action text,p_id uuid,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.corporate_zakat_command($1,$2,$3);$$;
revoke all on function public.corporate_zakat_command(text,uuid,jsonb) from public,anon;
grant execute on function public.corporate_zakat_command(text,uuid,jsonb) to authenticated;

create or replace view public.corporate_zakat_workflow with (security_invoker=true) as
select f.*,case when f.cancelled_at is not null then 'CANCELLED' when f.financial_event_id is null then case when f.approved_at is null then 'COMMITTED' else 'ACTUAL' end else coalesce(e.status,'UNAVAILABLE') end event_status,
case when f.financial_event_id is null then f.approved_at is not null else public.financial_event_has_valid_approval(f.financial_event_id) end approved,
case when e.status='ACTUAL' then coalesce(b.applied_base_amount,0) else 0 end paid,
case when f.cancelled_at is not null or e.status in('CANCELLED','REVERSED') then 0 when e.status='ACTUAL' then coalesce(b.outstanding_base_amount,f.amount) else f.amount end remaining
from public.corporate_zakat_finalizations f left join public.financial_events e on e.id=f.financial_event_id and e.organization_id=f.organization_id
left join public.financial_event_obligation_balances b on b.obligation_id=f.obligation_id and b.organization_id=f.organization_id;
revoke all on public.corporate_zakat_workflow from public,anon;grant select on public.corporate_zakat_workflow to authenticated;
-- Source namespace is reserved for the bounded assessment command.
do $guard$
declare definition text;
begin
 select pg_get_functiondef('public.create_financial_event_command(jsonb)'::regprocedure) into definition;
 if position('CORPORATE_ZAKAT_SOURCE_NAMESPACE_RESERVED' in definition)=0 then
  if position('return private.phase2c_create_financial_event_internal(p_payload)' in definition)=0 then raise exception 'CORPORATE_ZAKAT_CORE_WRAPPER_CHANGED';end if;
  definition:=replace(definition,'return private.phase2c_create_financial_event_internal(p_payload)',
   'if trim(p_payload->>''source_module'')=''ZAKAT_ASSESSMENT'' and coalesce(current_setting(''app.corporate_zakat'',true),) is distinct from nullif(p_payload->>source_record_id,) then raise exception ''CORPORATE_ZAKAT_SOURCE_NAMESPACE_RESERVED'';end if;return private.phase2c_create_financial_event_internal(p_payload)');
  execute definition;
 end if;
end $guard$;
