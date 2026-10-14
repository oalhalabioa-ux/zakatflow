-- Shared debt contracts: opening balances are noncash; new loans retain principal after funding.
create table public.debt_contracts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 request_id uuid not null,kind text not null check(kind in('OPENING','LOAN','EMPLOYEE_ADVANCE')),
 mode text not null check(mode in('OPENING','NEW')),side text not null check(side in('RECEIVABLE','PAYABLE')),
 counterparty_id uuid not null references public.liquidity_counterparties(id),entity_id uuid references public.organization_entities(id),account_id uuid references public.liquidity_accounts(id),
 category text not null,description text not null,reference text not null,event_date date not null,currency text not null,exchange_rate numeric not null check(exchange_rate>0),principal numeric(24,4) not null check(principal>0),
 schedule jsonb not null,financial_event_id uuid unique references public.financial_events(id),payload_fingerprint text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,request_id)
);
create index debt_contracts_org_created on public.debt_contracts(organization_id,created_at);
alter table public.debt_contracts enable row level security;
revoke all on public.debt_contracts from public,anon,authenticated;grant select on public.debt_contracts to authenticated;
create policy debt_contract_read on public.debt_contracts for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));

create or replace function private.create_debt_contract(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare uid uuid:=auth.uid();org uuid:=(p->>'organization_id')::uuid;request uuid:=(p->>'request_id')::uuid;cid uuid;eid uuid;oid uuid;fid uuid;cls uuid;base text;fx numeric:=(p->>'exchange_rate')::numeric;amt numeric:=(p->>'principal')::numeric;dt date:=(p->>'date')::date;side text:=p->>'side';mode text:=p->>'mode';kind text:=p->>'kind';cat text:=p->>'category';hash text;obs jsonb:='[]';item jsonb;i int:=0;total numeric:=0;total_base numeric:=0;due date;prior public.debt_contracts%rowtype;bank public.liquidity_accounts%rowtype;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view') or not public.financial_core_can(org,'financial_core.create') then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|DEBT_CONTRACT|'||request::text,0));
 hash:=encode(extensions.digest(p::text,'sha256'),'hex');select * into prior from public.debt_contracts where organization_id=org and request_id=request;
 if prior.id is not null then if prior.payload_fingerprint<>hash then raise exception 'DEBT_CONTRACT_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'eventId',prior.financial_event_id,'replay',true);end if;
 if side not in('RECEIVABLE','PAYABLE') or mode not in('OPENING','NEW') or kind not in('OPENING','LOAN','EMPLOYEE_ADVANCE') or(kind='OPENING' and mode<>'OPENING')or(kind='EMPLOYEE_ADVANCE' and side<>'RECEIVABLE') then raise exception 'DEBT_CONTRACT_INVALID';end if;
 if cat is null or cat not in('O_AR_CUSTOMER','O_AR_EMPLOYEE','O_AR_LOAN','O_AR_RELATED','O_AR_ACCRUED','O_AR_OTHER','O_AP_SUPPLIER','O_AP_ACCRUAL','O_AP_EMPLOYEE','O_AP_LOAN','O_AP_RELATED','O_AP_OTHER') or (side='RECEIVABLE' and cat not like 'O_AR_%')or(side='PAYABLE' and cat not like 'O_AP_%')or(kind='LOAN' and cat<>case when side='RECEIVABLE' then 'O_AR_LOAN' else 'O_AP_LOAN' end)or(kind='EMPLOYEE_ADVANCE' and cat<>'O_AR_EMPLOYEE') then raise exception 'DEBT_CATEGORY_SIDE_MISMATCH';end if;
 select base_currency into base from public.organizations where id=org;
 if amt is null or amt<=0 or amt::text in('NaN','Infinity','-Infinity')or amt<>round(amt,4) or fx is null or fx<=0 or fx::text in('NaN','Infinity','-Infinity') or(p->>'currency')!~'^[A-Z]{3}$'or(p->>'currency'=base and fx<>1) or dt is null or dt>(now() at time zone 'Asia/Riyadh')::date or length(trim(p->>'description')) not between 3 and 500 or length(trim(p->>'reference')) not between 1 and 120 then raise exception 'DEBT_CONTRACT_INVALID';end if;
 if not exists(select 1 from public.liquidity_counterparties where id=(p->>'counterparty_id')::uuid and organization_id=org and active)or(nullif(p->>'entity_id','')is not null and not exists(select 1 from public.organization_entities where id=(p->>'entity_id')::uuid and organization_id=org and active))then raise exception 'DEBT_CONTRACT_SCOPE_MISMATCH';end if;
 if mode='NEW' then
  if not public.effective_organization_permission(org,'liquidity.edit',null,null) then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
  select * into bank from public.liquidity_accounts where id=(p->>'account_id')::uuid and organization_id=org and active;
  if bank.id is null or bank.currency<>p->>'currency' or(bank.entity_id is not null and bank.entity_id is distinct from nullif(p->>'entity_id','')::uuid)then raise exception 'DEBT_CONTRACT_ACCOUNT_MISMATCH';end if;
 end if;
 if jsonb_typeof(p->'schedule')<>'array' or jsonb_array_length(p->'schedule')not between 1 and 48 then raise exception 'DEBT_SCHEDULE_INVALID';end if;
 for item in select value from jsonb_array_elements(p->'schedule') loop
  i:=i+1;due:=(item->>'due_date')::date;
  if(item->>'amount')::numeric is null or(item->>'amount')::numeric<=0 or(item->>'amount')::numeric::text in('NaN','Infinity','-Infinity')or(item->>'amount')::numeric<>round((item->>'amount')::numeric,4)or round((item->>'amount')::numeric*fx,4)<=0 or due is null or due<dt then raise exception 'DEBT_SCHEDULE_INVALID';end if;
  total:=total+(item->>'amount')::numeric;total_base:=total_base+round((item->>'amount')::numeric*fx,4);
  obs:=obs||jsonb_build_array(jsonb_build_object('obligation_key','installment:'||i,'obligation_type',side,'settleable_amount',(item->>'amount')::numeric,'currency',p->>'currency','exchange_rate',fx,'base_currency',base,'settleable_base_amount',round((item->>'amount')::numeric*fx,4)));
 end loop;
 if total<>amt or total_base<>round(amt*fx,4)then raise exception 'DEBT_SCHEDULE_TOTAL_MISMATCH';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)select org,v.code,v.name,v.kind,true,uid from(values('DEBT_PRINCIPAL_ASSET','أصول القروض والذمم','ASSET'),('DEBT_PRINCIPAL_LIABILITY','التزامات القروض والذمم','LIABILITY'),('DEBT_RECEIVABLE_CLEARING','تحصيل أصل الذمة','RECEIVABLE'),('DEBT_PAYABLE_CLEARING','سداد أصل الذمة','PAYABLE'))v(code,name,kind)on conflict(organization_id,code)do nothing;
 select id into cls from public.financial_classifications where organization_id=org and classification_type=(case when side='RECEIVABLE' then 'ASSET' else 'LIABILITY' end) and active order by id limit 1;
 if cls is null then raise exception 'DEBT_CLASSIFICATION_REQUIRED';end if;
 insert into public.debt_contracts(organization_id,request_id,kind,mode,side,counterparty_id,entity_id,account_id,category,description,reference,event_date,currency,exchange_rate,principal,schedule,payload_fingerprint,created_by)
 values(org,request,kind,mode,side,(p->>'counterparty_id')::uuid,nullif(p->>'entity_id','')::uuid,case when mode='NEW' then bank.id else null end,cat,trim(p->>'description'),trim(p->>'reference'),dt,p->>'currency',fx,amt,p->'schedule',hash,uid)returning id into cid;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',nullif(p->>'entity_id','')::uuid,'counterparty_id',(p->>'counterparty_id')::uuid,'event_type','ADJUSTMENT','source_module','DEBT_CONTRACTS','source_record_id',cid,'source_event_key','debt-contract:'||cid,'event_date',dt,'due_date',null,'base_currency',base,'description',trim(p->>'description'),'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description',trim(p->>'description'),'amount',amt,'currency',p->>'currency','exchange_rate',fx,'base_amount',round(amt*fx,4),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',obs,'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','debt_contracts','target_record_id',cid))));
 update public.debt_contracts set financial_event_id=eid where id=cid;
 perform public.transition_financial_event(eid,'PLANNED','Debt contract prepared');perform public.transition_financial_event(eid,'COMMITTED','Awaiting contract approval');
 return jsonb_build_object('id',cid,'eventId',eid,'status','COMMITTED');
end $$;
revoke all on function private.create_debt_contract(jsonb)from public,anon;grant execute on function private.create_debt_contract(jsonb)to authenticated;
create or replace function public.create_debt_contract(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.create_debt_contract(p_payload);$$;
revoke all on function public.create_debt_contract(jsonb)from public,anon;grant execute on function public.create_debt_contract(jsonb)to authenticated;
create or replace function private.post_debt_contract(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare c public.debt_contracts%rowtype;e public.financial_events%rowtype;b public.liquidity_accounts%rowtype;o public.financial_event_obligations%rowtype;sid uuid;fid uuid;i int:=0;item jsonb;direction text;native numeric;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.debt_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.post')then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|PHASE2B_CASH_WRITE',0));
 select * into e from public.financial_events where id=c.financial_event_id for update;
 if e.status='ACTUAL' and exists(select 1 from public.financial_event_command_registry where financial_event_id=e.id and command_type='DEBT_CONTRACT_POST')then return jsonb_build_object('status','ACTUAL','replay',true);end if;
 if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if e.event_date>(now() at time zone 'Asia/Riyadh')::date or not exists(select 1 from public.liquidity_counterparties where id=c.counterparty_id and organization_id=c.organization_id and active)then raise exception 'DEBT_CONTRACT_SCOPE_MISMATCH';end if;
 if c.mode='NEW'then
  if not public.effective_organization_permission(c.organization_id,'liquidity.edit',null,null)or not public.effective_organization_permission(c.organization_id,'liquidity.settle',round(c.principal*c.exchange_rate,4),e.base_currency)then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
  select * into b from public.liquidity_accounts where id=c.account_id and organization_id=c.organization_id and active for update;
  if b.id is null or b.currency<>c.currency or(b.entity_id is not null and b.entity_id is distinct from c.entity_id)then raise exception 'DEBT_CONTRACT_ACCOUNT_MISMATCH';end if;
  direction:=case when c.side='RECEIVABLE'then 'OUTFLOW'else 'INFLOW'end;
  if direction='OUTFLOW'and b.current_balance-coalesce(b.restricted_balance,0)-coalesce(b.uncleared_balance,0)<c.principal then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
  insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,payload_fingerprint,created_by,posted_by)
  values(c.organization_id,c.entity_id,b.id,direction,c.event_date,c.principal,c.currency,c.exchange_rate,e.base_currency,round(c.principal*c.exchange_rate,4),'DEBT_FUNDING','debt-funding:'||c.id,e.id,c.payload_fingerprint,auth.uid(),auth.uid())returning id into sid;
  insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key,settled_amount,settlement_status)
  values(c.organization_id,c.entity_id,b.id,direction,'FINANCING',c.description,c.counterparty_id,c.event_date,c.principal,c.currency,round(c.principal*c.exchange_rate,4),'ACTUAL','MANUAL',c.reference,'DEBT_FUNDING',c.id,'debt-funding:'||c.id,c.principal,'SETTLED')returning id into fid;
  insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount)values(c.organization_id,sid,fid,e.id,'PAYMENT',c.principal,c.currency,c.exchange_rate,e.base_currency,round(c.principal*c.exchange_rate,4));
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata)values(c.organization_id,e.id,'CASH_FLOW','liquidity_flows',fid,'{"purpose":"DEBT_FUNDING"}'),(c.organization_id,e.id,'CASH_SETTLEMENT','liquidity_settlements',sid,'{}');
  update public.liquidity_accounts set current_balance=current_balance+case when direction='INFLOW'then c.principal else -c.principal end,current_balance_base=current_balance_base+case when direction='INFLOW'then round(c.principal*c.exchange_rate,4)else -round(c.principal*c.exchange_rate,4)end,updated_at=now()where id=b.id;
  insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason)values(c.organization_id,sid,null,'POSTED',auth.uid(),'Loan principal funding');
 end if;
 for item in select value from jsonb_array_elements(c.schedule)loop
  i:=i+1;select * into o from public.financial_event_obligations where event_id=e.id and obligation_key='installment:'||i;
  if o.id is null then raise exception 'DEBT_SCHEDULE_INVALID';end if;
  insert into public.liquidity_flows(organization_id,entity_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
  values(c.organization_id,c.entity_id,case when c.side='RECEIVABLE'then 'INFLOW'else 'OUTFLOW'end,'FINANCING',c.description||' / '||i,c.counterparty_id,(item->>'due_date')::date,o.settleable_amount,c.currency,o.settleable_base_amount,'EXPECTED','MANUAL',c.reference,'DEBT_CONTRACTS',o.id,'debt-installment:'||o.id)returning id into fid;
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata)values(c.organization_id,e.id,'CASH_FLOW','liquidity_flows',fid,jsonb_build_object('obligation_id',o.id,'due_date',item->>'due_date','purpose','DEBT_INSTALLMENT'));
 end loop;
 insert into public.financial_event_command_registry(organization_id,command_type,source_module,source_event_key,payload_fingerprint,financial_event_id,canonical_payload,created_by)values(c.organization_id,'DEBT_CONTRACT_POST','DEBT_CONTRACTS','debt-contract:'||c.id,c.payload_fingerprint,e.id,jsonb_build_object('contract_id',c.id),auth.uid());
 perform public.transition_financial_event(e.id,'ACTUAL','Approved debt contract posted');
 for o in select * from public.financial_event_obligations where event_id=e.id loop insert into public.financial_debt_categories(origin,record_id,organization_id,category,updated_by)values('CORE',o.id,c.organization_id,c.category,auth.uid());end loop;
 return jsonb_build_object('id',c.id,'eventId',e.id,'status','ACTUAL','cash_created',c.mode='NEW');
end $$;
revoke all on function private.post_debt_contract(uuid)from public,anon;grant execute on function private.post_debt_contract(uuid)to authenticated;
create or replace function public.post_debt_contract(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_debt_contract(p_id);$$;
revoke all on function public.post_debt_contract(uuid)from public,anon;grant execute on function public.post_debt_contract(uuid)to authenticated;

create or replace function private.ensure_debt_flow(p_obligation_id uuid)returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.financial_event_obligations%rowtype;e public.financial_events%rowtype;fid uuid;left_base numeric;n int;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into o from public.financial_event_obligations where id=p_obligation_id;
 if o.id is null or not public.financial_core_can(o.organization_id,'financial_core.view')or not public.financial_core_can(o.organization_id,'financial_core.create')then raise exception 'DEBT_FLOW_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.organization_id::text||'|PHASE2B_CASH_WRITE',0));perform id from public.financial_event_obligations where id=o.id for update;
 select * into e from public.financial_events where id=o.event_id;
 if e.status<>'ACTUAL'or e.source_module in('INVESTMENTS','ADVANCE_WORKSPACE')or o.adjusts_obligation_id is not null or o.obligation_type not in('PAYABLE','RECEIVABLE')then raise exception 'DEBT_FLOW_SOURCE_REQUIRED';end if;
 select count(*)into n from public.financial_event_obligations where event_id=e.id and adjusts_obligation_id is null;
 select l.target_record_id into fid from public.financial_event_links l join public.liquidity_flows f on f.id=l.target_record_id and f.organization_id=o.organization_id where l.event_id=e.id and l.link_type='CASH_FLOW'and l.target_module='liquidity_flows'and f.direction=case when o.obligation_type='PAYABLE'then 'OUTFLOW'else 'INFLOW'end and((l.metadata->>'obligation_id')=o.id::text or(n=1 and l.metadata->>'obligation_id'is null))order by l.id limit 1;
 if fid is not null then return fid;end if;
 if n>1 and exists(select 1 from public.financial_event_links where event_id=e.id and link_type='CASH_FLOW'and metadata->>'obligation_id'is null)then raise exception 'MULTIPLE_OBLIGATIONS_REQUIRE_ALLOCATION';end if;
 select outstanding_base_amount into left_base from public.financial_event_obligation_balances where obligation_id=o.id;
 if coalesce(left_base,0)<=0 then raise exception 'NO_OUTSTANDING_OBLIGATION';end if;
 insert into public.liquidity_flows(organization_id,entity_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,source_module,source_record_id,source_event_key)
 values(o.organization_id,e.entity_id,case when o.obligation_type='PAYABLE'then 'OUTFLOW'else 'INFLOW'end,'OPERATING',e.description,e.counterparty_id,coalesce(e.due_date,e.event_date),round(left_base/o.exchange_rate,4),o.currency,left_base,'EXPECTED','MANUAL','DEBT_LINK',o.id,'debt-obligation:'||o.id)returning id into fid;
 insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata)values(o.organization_id,e.id,'CASH_FLOW','liquidity_flows',fid,jsonb_build_object('obligation_id',o.id,'purpose','LINK_EXISTING_DEBT'));
 return fid;
end $$;
revoke all on function private.ensure_debt_flow(uuid)from public,anon;grant execute on function private.ensure_debt_flow(uuid)to authenticated;
create or replace function public.ensure_debt_flow(p_obligation_id uuid)returns uuid language sql security invoker set search_path=pg_catalog,public,private as $$select private.ensure_debt_flow(p_obligation_id);$$;
revoke all on function public.ensure_debt_flow(uuid)from public,anon;grant execute on function public.ensure_debt_flow(uuid)to authenticated;
create or replace function private.guard_debt_contract_event()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if old.source_module='DEBT_CONTRACTS'then
  if row(new.organization_id,new.source_module,new.source_record_id,new.source_event_key,new.counterparty_id,new.entity_id,new.event_date,new.base_currency,new.event_type,new.description)is distinct from row(old.organization_id,old.source_module,old.source_record_id,old.source_event_key,old.counterparty_id,old.entity_id,old.event_date,old.base_currency,old.event_type,old.description)then raise exception 'DEBT_CONTRACT_IMMUTABLE';end if;
  if new.status='ACTUAL'and old.status<>'ACTUAL'and not exists(select 1 from public.financial_event_command_registry where financial_event_id=new.id and command_type='DEBT_CONTRACT_POST')then raise exception 'DEBT_CONTRACT_USE_ATOMIC_POST';end if;
  if new.status='REVERSED'and old.status<>'REVERSED'then raise exception 'DEBT_CONTRACT_REVERSAL_REQUIRES_SOURCE';end if;
 end if;return new;end $$;
create trigger debt_contract_event_guard before update on public.financial_events for each row execute function private.guard_debt_contract_event();
create or replace function private.guard_debt_contract_inputs()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare eid uuid;begin
 if tg_op='INSERT'then eid:=new.event_id;else eid:=old.event_id;end if;
 if exists(select 1 from public.financial_events where id=eid and source_module='DEBT_CONTRACTS'and status<>'DRAFT')then raise exception 'DEBT_CONTRACT_IMMUTABLE';end if;
 if tg_op='UPDATE'and new.event_id is distinct from old.event_id and exists(select 1 from public.financial_events where id=new.event_id and source_module='DEBT_CONTRACTS'and status<>'DRAFT')then raise exception 'DEBT_CONTRACT_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;else return new;end if;end $$;
create trigger debt_contract_lines_guard before insert or update or delete on public.financial_event_lines for each row execute function private.guard_debt_contract_inputs();
create trigger debt_contract_obligations_guard before insert or update or delete on public.financial_event_obligations for each row execute function private.guard_debt_contract_inputs();
-- A contract may have several installments: a flow must clear its exact obligation.
create or replace function private.guard_debt_installment_allocation()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare ob uuid;begin
 if new.allocation_type not in('PAYMENT','ADVANCE_APPLICATION')then return new;end if;
 select (metadata->>'obligation_id')::uuid into ob from public.financial_event_links where link_type='CASH_FLOW'and target_module='liquidity_flows'and target_record_id=new.flow_id and organization_id=new.organization_id and metadata->>'obligation_id'is not null order by id limit 1;
 if ob is not null and not exists(select 1 from public.financial_event_obligation_allocations where application_event_id=new.financial_event_id and obligation_id=ob and organization_id=new.organization_id)then raise exception 'DEBT_INSTALLMENT_FLOW_MISMATCH';end if;return new;end $$;
create trigger debt_installment_allocation_guard before insert on public.liquidity_flow_settlement_allocations for each row execute function private.guard_debt_installment_allocation();
create or replace function private.guard_debt_source_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if old.source_module in('DEBT_CONTRACTS','DEBT_FUNDING','DEBT_LINK')then
  if tg_op='DELETE'then raise exception 'DEBT_FLOW_MANAGE_FROM_SOURCE';end if;
  if row(new.organization_id,new.entity_id,new.direction,new.amount,new.currency,new.base_amount,new.due_date,new.counterparty_id,new.source_module,new.source_record_id,new.source_event_key)is distinct from row(old.organization_id,old.entity_id,old.direction,old.amount,old.currency,old.base_amount,old.due_date,old.counterparty_id,old.source_module,old.source_record_id,old.source_event_key)then raise exception 'DEBT_FLOW_MANAGE_FROM_SOURCE';end if;
 end if;return new;end $$;
create trigger debt_source_flow_guard before update or delete on public.liquidity_flows for each row execute function private.guard_debt_source_flow();
-- The shared subledger uses actual recognition and each contract installment date.
create or replace view public.financial_counterparty_open_items with(security_invoker=true)as
select e.organization_id,e.counterparty_id,cp.name as counterparty_name,cp.party_type,b.obligation_id,b.event_id,b.obligation_key,b.obligation_type,e.source_module,e.source_record_id,e.source_event_key,e.description,e.event_date,
 case when c.id is not null then(c.schedule->(split_part(b.obligation_key,':',2)::int-1)->>'due_date')::date else e.due_date end as due_date,
 b.currency,b.base_currency,b.settleable_amount,b.adjusted_settleable_base_amount as due_base_amount,b.applied_base_amount,b.consumed_advance_base_amount,b.outstanding_base_amount,greatest(0::numeric,b.adjusted_settleable_base_amount-b.outstanding_base_amount)as settled_base_amount,
 (coalesce(case when c.id is not null then(c.schedule->(split_part(b.obligation_key,':',2)::int-1)->>'due_date')::date else e.due_date end<(now()at time zone 'Asia/Riyadh')::date,false)and b.outstanding_base_amount>0)as is_overdue
from public.financial_event_obligation_balances b join public.financial_events e on e.id=b.event_id and e.organization_id=b.organization_id left join public.liquidity_counterparties cp on cp.id=e.counterparty_id and cp.organization_id=e.organization_id left join public.debt_contracts c on c.financial_event_id=e.id and c.organization_id=e.organization_id
where b.obligation_type in('RECEIVABLE','PAYABLE')and e.status='ACTUAL';
revoke all on function private.guard_debt_contract_event()from public,anon,authenticated;
revoke all on function private.guard_debt_contract_inputs()from public,anon,authenticated;
revoke all on function private.guard_debt_installment_allocation()from public,anon,authenticated;
revoke all on function private.guard_debt_source_flow()from public,anon,authenticated;
