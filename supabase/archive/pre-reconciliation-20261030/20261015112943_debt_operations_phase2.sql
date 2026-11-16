-- Source-managed requests reuse the existing approval and cash reversal engines.
create table public.debt_operation_requests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 request_id uuid not null, kind text not null check(kind in('RESCHEDULE','REFUND','REVERSE')),
 target_id uuid not null, payload jsonb not null, fingerprint text not null,
 financial_event_id uuid not null unique references public.financial_events(id),
 execution_state text not null default 'PENDING' check(execution_state in('PENDING','EXECUTING','EXECUTED')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),executed_at timestamptz,
 unique(organization_id,request_id)
);
alter table public.debt_operation_requests enable row level security;
revoke all on public.debt_operation_requests from public,anon,authenticated;
grant select on public.debt_operation_requests to authenticated;
create policy debt_operations_read on public.debt_operation_requests for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create index debt_operations_target on public.debt_operation_requests(organization_id,target_id,created_at);

create or replace function private.prepare_debt_operation(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();org uuid:=(p->>'organization_id')::uuid;req uuid:=(p->>'request_id')::uuid;kind text:=p->>'kind';target uuid:=(p->>'target_id')::uuid;
 r public.debt_operation_requests%rowtype;c public.debt_contracts%rowtype;e public.financial_events%rowtype;o public.financial_event_obligations%rowtype;s public.liquidity_settlements%rowtype;
 amount numeric;fx numeric;ccy text;base text;direction text;cls uuid;eid uuid;obs jsonb:='[]';links jsonb:='[]';body jsonb:=p;fingerprint text;dt date:=(p->>'date')::date;party uuid;entity uuid;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
 if req is null or target is null or kind is null or kind not in('RESCHEDULE','REFUND','REVERSE')or dt is null or dt>(now()at time zone 'Asia/Riyadh')::date or length(trim(coalesce(p->>'reason','')))not between 5 and 500 then raise exception 'DEBT_OPERATION_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|PHASE2B_CASH_WRITE',0));fingerprint:=md5(p::text);
 select * into r from public.debt_operation_requests where organization_id=org and request_id=req;
 if r.id is not null then if r.fingerprint<>fingerprint then raise exception 'DEBT_OPERATION_REQUEST_CONFLICT';end if;return jsonb_build_object('id',r.id,'eventId',r.financial_event_id,'replay',true);end if;
 if kind='RESCHEDULE'then
  select * into c from public.debt_contracts where id=target and organization_id=org;
  select * into e from public.financial_events where id=c.financial_event_id and status='ACTUAL';
  if e.id is null or c.kind not in('LOAN','EMPLOYEE_ADVANCE')then raise exception 'DEBT_OPERATION_SOURCE_INVALID';end if;
  if jsonb_typeof(p->'dates')is distinct from 'array'or jsonb_array_length(p->'dates')not between 1 and 48 then raise exception 'DEBT_SCHEDULE_INVALID';end if;
  body:=p||jsonb_build_object('schedule_before',c.schedule);amount:=c.principal;fx:=c.exchange_rate;ccy:=c.currency;base:=e.base_currency;direction:='NON_CASH';
 elsif kind='REFUND'then
  select * into o from public.financial_event_obligations where id=target and organization_id=org and adjusts_obligation_id is null and obligation_type in('SUPPLIER_ADVANCE','CUSTOMER_ADVANCE');
  select * into e from public.financial_events where id=o.event_id and status='ACTUAL';
  amount:=(p->>'amount')::numeric;fx:=o.exchange_rate;ccy:=o.currency;base:=o.base_currency;
  if e.id is null or e.source_module not in('ADVANCE_WORKSPACE','OPERATIONAL_CONSOLE')or amount is null or amount<=0 or amount>1e12 or amount::text in('NaN','Infinity','-Infinity')or amount<>round(amount,4)or round(amount*fx,4)<=0 or round(amount*fx,4)>(select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=o.id)then raise exception 'ADVANCE_EXCEEDS_BALANCE';end if;
  direction:=case when o.obligation_type='SUPPLIER_ADVANCE'then 'INFLOW'else 'OUTFLOW'end;
  obs:=jsonb_build_array(jsonb_build_object('obligation_key','refund','obligation_type',o.obligation_type,'adjusts_obligation_id',o.id,'adjustment_effect','DECREASE','settleable_amount',amount,'currency',ccy,'exchange_rate',fx,'base_currency',base,'settleable_base_amount',round(amount*fx,4)));
 else
  select * into e from public.financial_events where id=target and organization_id=org and status='ACTUAL';
  if e.id is null or e.source_module not in('ADVANCE_WORKSPACE','OPERATIONAL_CONSOLE','DEBT_OPERATIONS','DEBT_CONTRACTS')then raise exception 'DEBT_OPERATION_SOURCE_INVALID';end if;
  if not public.financial_core_can(org,'financial_core.reverse')then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
  select * into s from public.liquidity_settlements where financial_event_id=e.id and organization_id=org and status='POSTED';
  if s.id is not null then amount:=s.amount;fx:=s.exchange_rate;ccy:=s.currency;base:=s.base_currency;direction:=case when s.direction='INFLOW'then 'OUTFLOW'else 'INFLOW'end;body:=p||jsonb_build_object('settlement_id',s.id);
  elsif e.source_module='DEBT_CONTRACTS'then
   select * into c from public.debt_contracts where financial_event_id=e.id and organization_id=org;amount:=c.principal;fx:=c.exchange_rate;ccy:=c.currency;base:=e.base_currency;direction:='NON_CASH';
  elsif exists(select 1 from public.financial_event_command_registry where financial_event_id=e.id and command_type='ADVANCE_APPLICATION')then
   select sum(a.amount),max(a.exchange_rate),max(a.currency),max(a.base_currency)into amount,fx,ccy,base from public.financial_event_obligation_allocations a where application_event_id=e.id and allocation_type='ADVANCE_APPLICATION';direction:='NON_CASH';
  else raise exception 'DEBT_OPERATION_SOURCE_INVALID';end if;
  links:=jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',e.id));
 end if;
 if dt<e.event_date then raise exception 'DEBT_OPERATION_DATE_INVALID';end if;party:=e.counterparty_id;entity:=e.entity_id;
 -- A clearing classification cannot recognize income, expense, VAT or another principal.
 select id into cls from public.financial_classifications where organization_id=org and classification_type=case when direction='INFLOW'then 'RECEIVABLE'else 'PAYABLE'end and active order by id limit 1;
 if cls is null then raise exception 'SETTLEMENT_CLASSIFICATION_REQUIRED';end if;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',entity,'counterparty_id',party,'event_type',case when kind='REVERSE'then 'REVERSAL'when kind='REFUND'then 'SETTLEMENT'else 'ADJUSTMENT'end,'source_module','DEBT_OPERATIONS','source_event_key','debt-operation:'||req,'event_date',dt,'due_date',null,'base_currency',base,'description',p->>'reason','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description',p->>'reason','amount',amount,'currency',ccy,'exchange_rate',fx,'base_amount',round(amount*fx,4),'cash_direction',direction,'vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',obs,'links',links));
 insert into public.debt_operation_requests(organization_id,request_id,kind,target_id,payload,fingerprint,financial_event_id,created_by)values(org,req,kind,target,body,fingerprint,eid,uid)returning * into r;
 perform public.transition_financial_event(eid,'PLANNED','Source operation prepared');perform public.transition_financial_event(eid,'COMMITTED','Awaiting approval');
 return jsonb_build_object('id',r.id,'eventId',eid);
end $$;
revoke all on function private.prepare_debt_operation(jsonb)from public,anon;grant execute on function private.prepare_debt_operation(jsonb)to authenticated;
create function public.prepare_debt_operation(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.prepare_debt_operation(p_payload);$$;
revoke all on function public.prepare_debt_operation(jsonb)from public,anon;grant execute on function public.prepare_debt_operation(jsonb)to authenticated;

create or replace function private.post_debt_operation(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r public.debt_operation_requests%rowtype;e public.financial_events%rowtype;l public.financial_event_lines%rowtype;c public.debt_contracts%rowtype;
 o public.financial_event_obligations%rowtype;b public.liquidity_accounts%rowtype;s public.liquidity_settlements%rowtype;item jsonb;dates jsonb;due date;idx int;seen uuid[]:='{}';new_schedule jsonb;sid uuid;fid uuid;old public.financial_events%rowtype;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into r from public.debt_operation_requests where id=p_id;
 if r.id is null or not public.financial_core_can(r.organization_id,'financial_core.view')or not public.financial_core_can(r.organization_id,'financial_core.post')then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||'|PHASE2B_CASH_WRITE',0));select * into r from public.debt_operation_requests where id=p_id for update;
 if r.execution_state='EXECUTED'then return jsonb_build_object('id',r.id,'status','ACTUAL','replay',true);end if;
 select * into e from public.financial_events where id=r.financial_event_id for update;
 if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 select * into l from public.financial_event_lines where event_id=e.id;
 if not public.effective_organization_permission(r.organization_id,'financial_core.post',l.base_amount,e.base_currency)then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
 update public.debt_operation_requests set execution_state='EXECUTING'where id=r.id;
 if r.kind='RESCHEDULE'then
  select * into c from public.debt_contracts where id=r.target_id and organization_id=r.organization_id for update;
  if c.schedule is distinct from r.payload->'schedule_before'or not exists(select 1 from public.financial_events where id=c.financial_event_id and status='ACTUAL')then raise exception 'DEBT_SCHEDULE_CHANGED';end if;
  new_schedule:=c.schedule;
  for item in select value from jsonb_array_elements(r.payload->'dates')loop
   select * into o from public.financial_event_obligations where id=(item->>'obligation_id')::uuid and event_id=c.financial_event_id and organization_id=r.organization_id for update;due:=(item->>'due_date')::date;
   if o.id is null or o.id=any(seen)or due is null or due<greatest(c.event_date,e.event_date)or coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=o.id),0)<=0 then raise exception 'DEBT_SCHEDULE_INVALID';end if;
   seen:=array_append(seen,o.id);idx:=split_part(o.obligation_key,':',2)::int-1;
   new_schedule:=jsonb_set(new_schedule,array[idx::text,'due_date'],to_jsonb(due::text));
   update public.liquidity_flows set due_date=due,updated_at=now()where organization_id=r.organization_id and source_module='DEBT_CONTRACTS'and source_record_id=o.id;
   update public.financial_event_links set metadata=metadata||jsonb_build_object('due_date',due)where organization_id=r.organization_id and event_id=c.financial_event_id and metadata->>'obligation_id'=o.id::text and link_type='CASH_FLOW';
  end loop;
  update public.debt_contracts set schedule=new_schedule where id=c.id;
  perform public.transition_financial_event(e.id,'ACTUAL','Approved due-date rescheduling; no cash or principal change');
 elsif r.kind='REFUND'then
  select * into o from public.financial_event_obligations where id=r.target_id and organization_id=r.organization_id for update;
  select * into old from public.financial_events where id=o.event_id;
  if old.status<>'ACTUAL'or l.base_amount>(select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=o.id)then raise exception 'ADVANCE_EXCEEDS_BALANCE';end if;
  if not public.has_organization_permission(r.organization_id,'liquidity.edit')or not public.effective_organization_permission(r.organization_id,'liquidity.settle',l.base_amount,e.base_currency)then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
  select * into b from public.liquidity_accounts where id=(r.payload->>'account_id')::uuid and organization_id=r.organization_id and active for update;
  if b.id is null or b.currency<>l.currency or(b.entity_id is not null and b.entity_id is distinct from e.entity_id)then raise exception 'ADVANCE_ACCOUNT_MISMATCH';end if;
  if l.cash_direction='OUTFLOW'and b.current_balance-coalesce(b.restricted_balance,0)-coalesce(b.uncleared_balance,0)<l.amount then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
  insert into public.liquidity_settlements(organization_id,entity_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,payload_fingerprint,created_by,posted_by)
  values(r.organization_id,e.entity_id,b.id,l.cash_direction,e.event_date,l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount,'DEBT_OPERATIONS',e.source_event_key,e.id,r.fingerprint,auth.uid(),auth.uid())returning id into sid;
  insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,source_module,source_record_id,source_event_key,settled_amount,settlement_status)
  values(r.organization_id,e.entity_id,b.id,l.cash_direction,'OPERATING',e.description,e.counterparty_id,e.event_date,l.amount,l.currency,l.base_amount,'ACTUAL','MANUAL','DEBT_OPERATIONS',r.id,e.source_event_key,l.amount,'SETTLED')returning id into fid;
  insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount)values(r.organization_id,sid,fid,e.id,'PAYMENT',l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount);
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id)values(r.organization_id,e.id,'CASH_FLOW','liquidity_flows',fid),(r.organization_id,e.id,'CASH_SETTLEMENT','liquidity_settlements',sid);
  update public.liquidity_accounts set current_balance=current_balance+case when l.cash_direction='INFLOW'then l.amount else -l.amount end,current_balance_base=current_balance_base+case when l.cash_direction='INFLOW'then l.base_amount else -l.base_amount end,updated_at=now()where id=b.id;
  insert into public.liquidity_settlement_status_history(organization_id,settlement_id,from_status,to_status,actor_id,reason)values(r.organization_id,sid,null,'POSTED',auth.uid(),e.description);
  perform public.transition_financial_event(e.id,'ACTUAL','Approved advance refund');
 else
  if not public.financial_core_can(r.organization_id,'financial_core.reverse')then raise exception 'DEBT_OPERATION_ACCESS_DENIED';end if;
  select * into old from public.financial_events where id=r.target_id and organization_id=r.organization_id for update;
  if old.source_module='DEBT_CONTRACTS'and(exists(select 1 from public.financial_event_obligation_allocations where obligation_id in(select id from public.financial_event_obligations where event_id=old.id))or exists(select 1 from public.financial_event_links x join public.financial_events pe on pe.id=x.event_id and pe.status not in('CANCELLED','REVERSED')where x.metadata->>'recognition_event_id'=old.id::text))then raise exception 'DEBT_CONTRACT_HAS_SETTLEMENTS';end if;
  if r.payload->>'settlement_id'is not null then
   select * into s from public.liquidity_settlements where id=(r.payload->>'settlement_id')::uuid and financial_event_id=r.target_id and organization_id=r.organization_id;
   select * into b from public.liquidity_accounts where id=s.account_id for update;
   if s.direction='INFLOW'and b.current_balance-coalesce(b.restricted_balance,0)-coalesce(b.uncleared_balance,0)<s.amount then raise exception 'CASH_INSUFFICIENT_BALANCE';end if;
   if exists(select 1 from public.financial_event_obligations a join public.financial_events ae on ae.id=a.event_id where a.adjusts_obligation_id in(select id from public.financial_event_obligations where event_id=r.target_id)and ae.status='ACTUAL')then raise exception 'ADVANCE_HAS_ACTIVE_REFUNDS';end if;
   perform public.reverse_financial_settlement(s.id,e.id,e.description);
  elsif old.source_module='DEBT_CONTRACTS'then
   perform public.transition_financial_event(e.id,'ACTUAL','Approved noncash contract reversal');perform public.transition_financial_event(old.id,'REVERSED',e.description);
  else perform private.cash_reverse_advance_application_atomic(r.target_id,e.id,e.description);end if;
  if old.source_module='DEBT_CONTRACTS'then
   delete from public.liquidity_flows where organization_id=r.organization_id and source_module='DEBT_CONTRACTS'and source_record_id in(select id from public.financial_event_obligations where event_id=old.id);
  end if;
 end if;
 update public.debt_operation_requests set execution_state='EXECUTED',executed_at=now()where id=r.id;
 return jsonb_build_object('id',r.id,'status','ACTUAL','cash_created',r.kind='REFUND');
end $$;
revoke all on function private.post_debt_operation(uuid)from public,anon;grant execute on function private.post_debt_operation(uuid)to authenticated;
create function public.post_debt_operation(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_debt_operation(p_id);$$;
revoke all on function public.post_debt_operation(uuid)from public,anon;grant execute on function public.post_debt_operation(uuid)to authenticated;

-- Only the private approved source command can move an installment date.
create or replace function private.guard_debt_source_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if old.source_module in('DEBT_CONTRACTS','DEBT_FUNDING','DEBT_LINK','DEBT_OPERATIONS')then
  if tg_op='DELETE'then
   if current_user='postgres'and old.source_module='DEBT_CONTRACTS'and not exists(select 1 from public.liquidity_flow_settlement_allocations where flow_id=old.id)and exists(select 1 from public.debt_operation_requests r join public.financial_event_obligations ob on ob.event_id=r.target_id where r.organization_id=old.organization_id and r.kind='REVERSE'and r.execution_state='EXECUTING'and ob.id=old.source_record_id)then return old;end if;
   raise exception 'DEBT_FLOW_MANAGE_FROM_SOURCE';
  end if;
  if current_user='postgres'and old.source_module='DEBT_CONTRACTS'and(to_jsonb(new)-array['due_date','updated_at'])=(to_jsonb(old)-array['due_date','updated_at'])and exists(select 1 from public.debt_operation_requests r join public.debt_contracts c on c.id=r.target_id where r.organization_id=old.organization_id and r.kind='RESCHEDULE'and r.execution_state='EXECUTING'and c.financial_event_id in(select event_id from public.financial_event_obligations where id=old.source_record_id)and exists(select 1 from jsonb_array_elements(r.payload->'dates')d where d->>'obligation_id'=old.source_record_id::text and(d->>'due_date')::date=new.due_date))then return new;end if;
  if row(new.organization_id,new.entity_id,new.direction,new.amount,new.currency,new.base_amount,new.due_date,new.counterparty_id,new.source_module,new.source_record_id,new.source_event_key)is distinct from row(old.organization_id,old.entity_id,old.direction,old.amount,old.currency,old.base_amount,old.due_date,old.counterparty_id,old.source_module,old.source_record_id,old.source_event_key)then raise exception 'DEBT_FLOW_MANAGE_FROM_SOURCE';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;end $$;

create or replace function private.guard_advance_workflow()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if old.source_module='ADVANCE_WORKSPACE' and old.status='COMMITTED' and (to_jsonb(new)-array['status','updated_at','posted_by','posted_at','settlement_date']) is distinct from (to_jsonb(old)-array['status','updated_at','posted_by','posted_at','settlement_date']) then raise exception 'ADVANCE_COMMITTED_REQUEST_IMMUTABLE';end if;
 if old.source_module='ADVANCE_WORKSPACE' and old.status in('ACTUAL','REVERSED') and new is distinct from old and not(current_user='postgres'and new.status='REVERSED'and old.status='ACTUAL'and(to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at'])and exists(select 1 from public.debt_operation_requests r where r.target_id=old.id and r.kind='REVERSE'and r.execution_state='EXECUTING'and r.organization_id=old.organization_id))then raise exception 'ADVANCE_POSTED_EVENT_IMMUTABLE';end if;
 if new.source_module='ADVANCE_WORKSPACE' and new.status='ACTUAL' and old.status<>'ACTUAL' and not exists(select 1 from public.financial_event_command_registry where financial_event_id=new.id and command_type in('ADVANCE_CASH','ADVANCE_APPLICATION')) then raise exception 'ADVANCE_USE_ATOMIC_POST';end if;
 -- Prevent erasing an invoice/advance while an active allocation depends on it.
 if old.status='ACTUAL' and new.status='REVERSED' and exists(select 1 from public.financial_event_obligations o join public.financial_event_obligation_allocations a on a.obligation_id=o.id or a.source_advance_obligation_id=o.id join public.financial_events app on app.id=a.application_event_id and app.status='ACTUAL' where o.event_id=old.id and a.allocation_type='ADVANCE_APPLICATION') then raise exception 'ADVANCE_HAS_ACTIVE_APPLICATIONS';end if;
 return new;
end $$;

CREATE OR REPLACE FUNCTION private.cash_reverse_advance_application_atomic(p_application_event_id uuid, p_reversal_event_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare app public.financial_events%rowtype; rev public.financial_events%rowtype; a record; norm jsonb; fingerprint text; prior public.financial_event_command_registry%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into app from public.financial_events where id=p_application_event_id;
 if app.id is null then raise exception 'ADVANCE_APPLICATION_NOT_FOUND'; end if;
 if not public.financial_core_can(app.organization_id,'financial_core.reverse') or not public.has_organization_permission(app.organization_id,'liquidity.edit') then raise exception 'ADVANCE_REVERSAL_DENIED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(app.organization_id::text||'|PHASE2B_CASH_WRITE',0));
 perform e.id from public.financial_events e where e.id in (p_application_event_id,p_reversal_event_id) order by e.id for update;
 select * into app from public.financial_events where id=p_application_event_id;
 select * into rev from public.financial_events where id=p_reversal_event_id and organization_id=app.organization_id;
 if rev.id is null or rev.event_type<>'REVERSAL' or length(trim(coalesce(p_reason,'')))<5 then raise exception 'ADVANCE_REVERSAL_EVENT_OR_REASON_INVALID'; end if;
 norm:=private.canonical_financial_json(jsonb_build_object('application_event_id',app.id,'reversal_event_id',rev.id,'reason',trim(p_reason)));
 fingerprint:=encode(extensions.digest(convert_to(norm::text,'UTF8'),'sha256'),'hex');
 select * into prior from public.financial_event_command_registry where organization_id=app.organization_id and command_type='ADVANCE_REVERSAL' and source_module=rev.source_module and source_event_key=rev.source_event_key;
 if found then
  if prior.payload_fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT: advance reversal payload changed'; end if;
  return jsonb_build_object('financial_event_id',rev.id,'cash_movement_created',false,'idempotent_replay',true);
 end if;
 if app.status<>'ACTUAL' or app.event_type<>'ADJUSTMENT' or not exists(select 1 from public.financial_event_command_registry where financial_event_id=app.id and organization_id=app.organization_id and command_type='ADVANCE_APPLICATION') then raise exception 'POSTED_ADVANCE_APPLICATION_REQUIRED'; end if;
 if rev.status<>'COMMITTED' or not public.financial_event_has_valid_approval(rev.id) then raise exception 'INDEPENDENT_APPROVED_COMMITTED_REVERSAL_REQUIRED'; end if;
 if not exists(select 1 from public.financial_event_links where event_id=rev.id and organization_id=rev.organization_id and link_type='REVERSAL_OF' and related_event_id=app.id) then raise exception 'REVERSAL_EVENT_MUST_LINK_ORIGINAL_EVENT'; end if;
 if exists(select 1 from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id and c.organization_id=l.organization_id where l.event_id=rev.id and (l.cash_direction<>'NON_CASH' or c.classification_type not in ('RECEIVABLE','PAYABLE') or l.vat_amount<>0 or l.vat_rate<>0)) then raise exception 'ADVANCE_REVERSAL_MUST_BE_NONCASH_CLEARING'; end if;
 if (select sum(base_amount) from public.financial_event_lines where event_id=rev.id)<>(select sum(base_amount) from public.financial_event_obligation_allocations where application_event_id=app.id and allocation_type='ADVANCE_APPLICATION') then raise exception 'ADVANCE_REVERSAL_AMOUNT_MISMATCH'; end if;
 for a in select x.* from public.liquidity_flow_settlement_allocations x where x.financial_event_id=app.id and x.organization_id=app.organization_id and x.allocation_type='ADVANCE_APPLICATION' order by x.flow_id loop
  perform 1 from public.liquidity_flows where id=a.flow_id for update;
  insert into public.liquidity_flow_settlement_allocations(organization_id,settlement_id,flow_id,financial_event_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount,reversal_of_allocation_id,created_by)
   values(a.organization_id,a.settlement_id,a.flow_id,rev.id,'REVERSAL',a.amount,a.currency,a.exchange_rate,a.base_currency,a.base_amount,a.id,auth.uid());
  update public.liquidity_flows set settled_amount=settled_amount-a.amount,settlement_status=case when settled_amount-a.amount=0 then 'UNSETTLED' when settled_amount-a.amount<amount then 'PARTIAL' else 'SETTLED' end,updated_at=now() where id=a.flow_id and organization_id=a.organization_id;
  insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id) values(rev.id,rev.organization_id,'CASH_FLOW','liquidity_flows',a.flow_id);
 end loop;
 insert into public.financial_event_command_registry(organization_id,command_type,source_module,source_event_key,payload_fingerprint,financial_event_id,canonical_payload,created_by)
  values(rev.organization_id,'ADVANCE_REVERSAL',rev.source_module,rev.source_event_key,fingerprint,rev.id,norm,auth.uid());
 perform public.transition_financial_event(rev.id,'ACTUAL','Noncash advance reversal');
 perform public.transition_financial_event(app.id,'REVERSED',trim(p_reason));
 return jsonb_build_object('financial_event_id',rev.id,'cash_movement_created',false,'idempotent_replay',false);
end $function$;


create function private.guard_debt_operation_event()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if old.source_module='DEBT_OPERATIONS'then
  if new.status='ACTUAL'and old.status<>'ACTUAL'and not(current_user='postgres'and exists(select 1 from public.debt_operation_requests where financial_event_id=old.id and execution_state='EXECUTING'))then raise exception 'DEBT_OPERATION_USE_SOURCE';end if;
  if old.status in('ACTUAL','REVERSED')and new is distinct from old and not(current_user='postgres'and old.status='ACTUAL'and new.status='REVERSED'and exists(select 1 from public.debt_operation_requests where target_id=old.id and kind='REVERSE'and execution_state='EXECUTING'))then raise exception 'DEBT_OPERATION_USE_SOURCE';end if;
  if(to_jsonb(new)-array['status','updated_at','posted_by','posted_at','settlement_date'])is distinct from(to_jsonb(old)-array['status','updated_at','posted_by','posted_at','settlement_date'])then raise exception 'DEBT_OPERATION_IMMUTABLE';end if;
 end if;return new;end $$;
revoke all on function private.guard_debt_operation_event()from public,anon,authenticated;
create trigger debt_operation_event_guard before update on public.financial_events for each row execute function private.guard_debt_operation_event();
create function private.guard_debt_operation_inputs()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare eid uuid;begin
 eid:=case when tg_op='DELETE'then old.event_id else new.event_id end;
 if exists(select 1 from public.financial_events where id=eid and source_module='DEBT_OPERATIONS'and status not in('DRAFT','PLANNED'))or(tg_op='UPDATE'and exists(select 1 from public.financial_events where id=old.event_id and source_module='DEBT_OPERATIONS'and status not in('DRAFT','PLANNED')))then
  if tg_table_name='financial_event_links'and tg_op='INSERT'and current_user='postgres'and new.link_type in('CASH_FLOW','CASH_SETTLEMENT')then return new;end if;
  raise exception 'DEBT_OPERATION_IMMUTABLE';
 end if;if tg_op='DELETE'then return old;end if;return new;end $$;
revoke all on function private.guard_debt_operation_inputs()from public,anon,authenticated;
create trigger debt_operation_lines_guard before insert or update or delete on public.financial_event_lines for each row execute function private.guard_debt_operation_inputs();
create trigger debt_operation_obligations_guard before insert or update or delete on public.financial_event_obligations for each row execute function private.guard_debt_operation_inputs();
create trigger debt_operation_links_guard before insert or update or delete on public.financial_event_links for each row execute function private.guard_debt_operation_inputs();

create or replace function private.guard_debt_contract_event()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if old.source_module='DEBT_CONTRACTS'then
  if row(new.organization_id,new.source_module,new.source_record_id,new.source_event_key,new.counterparty_id,new.entity_id,new.event_date,new.base_currency,new.event_type,new.description)is distinct from row(old.organization_id,old.source_module,old.source_record_id,old.source_event_key,old.counterparty_id,old.entity_id,old.event_date,old.base_currency,old.event_type,old.description)then raise exception 'DEBT_CONTRACT_IMMUTABLE';end if;
  if new.status='ACTUAL'and old.status<>'ACTUAL'and not exists(select 1 from public.financial_event_command_registry where financial_event_id=new.id and command_type='DEBT_CONTRACT_POST')then raise exception 'DEBT_CONTRACT_USE_ATOMIC_POST';end if;
  if new.status='REVERSED'and old.status<>'REVERSED'and not(current_user='postgres'and exists(select 1 from public.debt_operation_requests r where r.target_id=old.id and r.kind='REVERSE'and r.execution_state='EXECUTING'and r.organization_id=old.organization_id))then raise exception 'DEBT_CONTRACT_REVERSAL_REQUIRES_SOURCE';end if;
 end if;return new;end $$;
