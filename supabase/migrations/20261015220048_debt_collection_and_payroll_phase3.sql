-- Append-only collection notes; no change to debt balances or due dates.
create table if not exists public.debt_collection_followups(
 id uuid primary key default gen_random_uuid(),request_id uuid not null,user_id uuid not null references auth.users(id),organization_id uuid references public.organizations(id),
 debt_id uuid not null,target_type text not null check(target_type in('CORE','PERSONAL_RECEIVABLE','PERSONAL_PAYABLE')),
 status text not null check(status in('OPEN','PROMISED','DISPUTED','CLOSED')),action_date date not null,next_date date,promise_date date,
 promise_amount numeric(24,4)not null default 0 check(promise_amount>=0 and promise_amount<=1e12),currency text not null references public.currencies(code),
 assignee_id uuid references auth.users(id),note text not null check(length(trim(note))between 3 and 1000),fingerprint text not null,created_at timestamptz not null default now(),
 unique(user_id,request_id),check((target_type='CORE')=(organization_id is not null)),check(next_date is null or next_date>=action_date),check(promise_date is null or promise_date>=action_date),check(status<>'PROMISED'or(promise_date is not null and promise_amount>0))
);
alter table public.debt_collection_followups enable row level security;
revoke all on public.debt_collection_followups from public,anon,authenticated;grant select on public.debt_collection_followups to authenticated;
do $policy$begin if not exists(select 1 from pg_policy where polrelid='public.debt_collection_followups'::regclass and polname='debt_followup_read')then create policy debt_followup_read on public.debt_collection_followups for select to authenticated using((organization_id is null and user_id=(select auth.uid()))or(organization_id is not null and public.financial_core_can(organization_id,'financial_core.view')));end if;end $policy$;
create index if not exists debt_followup_org_target on public.debt_collection_followups(organization_id,debt_id,created_at desc);
create index if not exists debt_followup_user on public.debt_collection_followups(user_id,created_at desc)where organization_id is null;
create or replace function private.record_debt_followup(p jsonb)returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();org uuid:=nullif(p->>'organization_id','')::uuid;target uuid:=(p->>'debt_id')::uuid;req uuid:=(p->>'request_id')::uuid;r public.debt_collection_followups%rowtype;kind text:=p->>'target_type';assignee uuid:=nullif(p->>'assignee_id','')::uuid;ccy text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if req is null or target is null or(p->>'action_date')::date>(now()at time zone 'Asia/Riyadh')::date then raise exception 'FOLLOWUP_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||req::text,0));select * into r from public.debt_collection_followups where user_id=uid and request_id=req;
 if r.id is not null then if r.fingerprint<>md5(p::text)then raise exception 'FOLLOWUP_REQUEST_CONFLICT';end if;return r.id;end if;
 if kind='CORE'and org is not null then
  if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'FOLLOWUP_ACCESS_DENIED';end if;
  select o.base_currency into ccy from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id and e.status='ACTUAL' where o.id=target and o.organization_id=org and o.obligation_type in('PAYABLE','RECEIVABLE')and o.adjusts_obligation_id is null;
  if assignee is not null and not exists(select 1 from public.organization_members where organization_id=org and user_id=assignee and status='ACTIVE')then raise exception 'FOLLOWUP_ASSIGNEE_INVALID';end if;
 elsif kind='PERSONAL_RECEIVABLE'and org is null then
  select base_currency into ccy from public.profiles where id=uid;
  if not exists(select 1 from public.asset_accounts where id=target and user_id=uid and organization_id is null and asset_type='RECEIVABLE')then ccy:=null;end if;
 elsif kind='PERSONAL_PAYABLE'and org is null then select currency into ccy from public.personal_payables where id=target and user_id=uid and cancelled_at is null;
 else raise exception 'FOLLOWUP_INVALID';end if;
 if org is null and assignee is not null and assignee<>uid then raise exception 'FOLLOWUP_ASSIGNEE_INVALID';end if;
 if ccy is null then raise exception 'FOLLOWUP_TARGET_INVALID';end if;
 if kind='CORE'and coalesce((p->>'promise_amount')::numeric,0)>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=target and organization_id=org),0)then raise exception 'PROMISE_EXCEEDS_BALANCE';end if;
 insert into public.debt_collection_followups(request_id,user_id,organization_id,debt_id,target_type,status,action_date,next_date,promise_date,promise_amount,currency,assignee_id,note,fingerprint)
 values(req,uid,org,target,kind,p->>'status',(p->>'action_date')::date,nullif(p->>'next_date','')::date,nullif(p->>'promise_date','')::date,(p->>'promise_amount')::numeric,ccy,assignee,trim(p->>'note'),md5(p::text))returning id into target;return target;
end $$;
revoke all on function private.record_debt_followup(jsonb)from public,anon,authenticated;grant execute on function private.record_debt_followup(jsonb)to authenticated;
create or replace function public.record_debt_followup(p_payload jsonb)returns uuid language sql security invoker set search_path=pg_catalog,public,private as $$select private.record_debt_followup(p_payload)$$;
revoke all on function public.record_debt_followup(jsonb)from public,anon;grant execute on function public.record_debt_followup(jsonb)to authenticated;

-- Payroll deductions offset an existing employee receivable and employee payable.
-- No salary expense, revenue, cash settlement or duplicate forecast is created.
create table if not exists public.debt_payroll_requests(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),request_id uuid not null,
 kind text not null check(kind in('DEDUCT','REVERSE')),installment_id uuid references public.financial_event_obligations(id),salary_obligation_id uuid references public.financial_event_obligations(id),
 target_id uuid references public.debt_payroll_requests(id),payroll_reference text,payload jsonb not null,fingerprint text not null,financial_event_id uuid not null unique references public.financial_events(id),
 execution_state text not null default 'PENDING'check(execution_state in('PENDING','EXECUTING','EXECUTED','REVERSED')),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),executed_at timestamptz,
 unique(organization_id,request_id)
);
alter table public.debt_payroll_requests enable row level security;revoke all on public.debt_payroll_requests from public,anon,authenticated;grant select on public.debt_payroll_requests to authenticated;
do $policy$begin if not exists(select 1 from pg_policy where polrelid='public.debt_payroll_requests'::regclass and polname='debt_payroll_read')then create policy debt_payroll_read on public.debt_payroll_requests for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));end if;end $policy$;
create unique index if not exists debt_payroll_period_once on public.debt_payroll_requests(organization_id,installment_id,payroll_reference)where kind='DEDUCT'and execution_state<>'REVERSED';
create index if not exists debt_payroll_org on public.debt_payroll_requests(organization_id,created_at desc);
create or replace function private.prepare_debt_payroll(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare org uuid:=(p->>'organization_id')::uuid;req uuid:=(p->>'request_id')::uuid;uid uuid:=auth.uid();dt date:=(p->>'date')::date;v_kind text:=p->>'kind';r public.debt_payroll_requests%rowtype;old public.debt_payroll_requests%rowtype;a public.financial_event_obligations%rowtype;b public.financial_event_obligations%rowtype;ae public.financial_events%rowtype;be public.financial_events%rowtype;amt numeric:=(p->>'amount')::numeric;cls uuid;eid uuid;target uuid;ref text;links jsonb:='[]';
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'PAYROLL_ACCESS_DENIED';end if;
 if req is null or v_kind not in('DEDUCT','REVERSE')or dt is null or dt>(now()at time zone 'Asia/Riyadh')::date or length(trim(coalesce(p->>'reason','')))not between 5 and 500 then raise exception 'PAYROLL_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|PHASE2B_CASH_WRITE',0));select * into r from public.debt_payroll_requests where organization_id=org and request_id=req;
 if r.id is not null then if r.fingerprint<>md5(p::text)then raise exception 'PAYROLL_REQUEST_CONFLICT';end if;return jsonb_build_object('id',r.id,'eventId',r.financial_event_id);end if;
 if v_kind='REVERSE'then
  target:=(p->>'target_id')::uuid;select * into old from public.debt_payroll_requests where id=target and organization_id=org and kind='DEDUCT'and execution_state='EXECUTED';
  if old.id is null then raise exception 'PAYROLL_SOURCE_INVALID';end if;
  amt:=(old.payload->>'amount')::numeric;dt:=greatest(dt,(old.payload->>'date')::date);
  if exists(select 1 from public.debt_payroll_requests x join public.financial_events xe on xe.id=x.financial_event_id and xe.status not in('CANCELLED','REVERSED')where x.target_id=target)then raise exception 'PAYROLL_REVERSAL_PENDING';end if;
  p:=p||jsonb_build_object('amount',amt,'installment_id',old.installment_id,'salary_obligation_id',old.salary_obligation_id);
  links:=jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',old.financial_event_id));
 end if;
 select * into a from public.financial_event_obligations where id=(p->>'installment_id')::uuid and organization_id=org and obligation_type='RECEIVABLE'and adjusts_obligation_id is null;
 select * into b from public.financial_event_obligations where id=(p->>'salary_obligation_id')::uuid and organization_id=org and obligation_type='PAYABLE'and adjusts_obligation_id is null;
 select * into ae from public.financial_events where id=a.event_id;select * into be from public.financial_events where id=b.event_id;
 if a.id is null or b.id is null or ae.status<>'ACTUAL'or be.status<>'ACTUAL'or ae.counterparty_id is null or ae.counterparty_id is distinct from be.counterparty_id or ae.entity_id is distinct from be.entity_id or dt<greatest(ae.event_date,be.event_date)or not exists(select 1 from public.debt_contracts where financial_event_id=a.event_id and organization_id=org and kind='EMPLOYEE_ADVANCE')or not exists(select 1 from public.financial_debt_categories where organization_id=org and origin='CORE'and record_id=b.id and category='O_AP_EMPLOYEE')then raise exception 'PAYROLL_SOURCE_INVALID';end if;
 if a.currency<>b.currency or a.base_currency<>b.base_currency or a.exchange_rate<>b.exchange_rate then raise exception 'PAYROLL_CURRENCY_MISMATCH';end if;
 if amt is null or amt<=0 or amt>1e12 or round(amt,4)<>amt or round(amt*a.exchange_rate,4)<=0 then raise exception 'PAYROLL_AMOUNT_INVALID';end if;
 if v_kind='DEDUCT'and (round(amt*a.exchange_rate,4)>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=a.id),0)or round(amt*a.exchange_rate,4)>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=b.id),0))then raise exception 'PAYROLL_EXCEEDS_BALANCE';end if;
 ref:=trim(p->>'payroll_reference');if v_kind='DEDUCT'and coalesce(length(ref),0)not between 1 and 120 then raise exception 'PAYROLL_REFERENCE_REQUIRED';end if;
 if v_kind='DEDUCT'and exists(select 1 from public.debt_payroll_requests x where x.organization_id=org and x.installment_id=a.id and x.payroll_reference=ref and x.kind='DEDUCT'and x.execution_state<>'REVERSED')then raise exception 'PAYROLL_PERIOD_ALREADY_RECORDED';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(org,'EMPLOYEE_PAYROLL_OFFSET','استقطاع سلفة من مستحق موظف','TRANSFER',true,uid)on conflict(organization_id,code)do nothing;
 select id into cls from public.financial_classifications where organization_id=org and code='EMPLOYEE_PAYROLL_OFFSET'and active;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',ae.entity_id,'counterparty_id',ae.counterparty_id,'event_type',case when v_kind='REVERSE'then 'REVERSAL'else 'ADJUSTMENT'end,'source_module','DEBT_PAYROLL','source_event_key','debt-payroll:'||req,'event_date',dt,'due_date',null,'base_currency',a.base_currency,'description',p->>'reason','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'cost_center_id',null,'description',p->>'reason','amount',amt,'currency',a.currency,'exchange_rate',a.exchange_rate,'base_amount',round(amt*a.exchange_rate,4),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',links));
 perform public.transition_financial_event(eid,'PLANNED','Payroll offset request');perform public.transition_financial_event(eid,'COMMITTED','Payroll offset for approval');
 insert into public.debt_payroll_requests(organization_id,request_id,kind,installment_id,salary_obligation_id,target_id,payroll_reference,payload,fingerprint,financial_event_id,created_by)values(org,req,v_kind,a.id,b.id,target,ref,p,md5((p-array['amount','installment_id','salary_obligation_id'])::text),eid,uid)returning id into target;
 -- Fingerprint always compares the original request, including amount for deductions.
 update public.debt_payroll_requests set fingerprint=case when v_kind='DEDUCT'then md5(p::text)else md5((p-array['amount','installment_id','salary_obligation_id'])::text)end where id=target;
 return jsonb_build_object('id',target,'eventId',eid);
end $$;
revoke all on function private.prepare_debt_payroll(jsonb)from public,anon,authenticated;grant execute on function private.prepare_debt_payroll(jsonb)to authenticated;
create or replace function public.prepare_debt_payroll(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.prepare_debt_payroll(p_payload)$$;
revoke all on function public.prepare_debt_payroll(jsonb)from public,anon;grant execute on function public.prepare_debt_payroll(jsonb)to authenticated;
create or replace function private.post_debt_payroll(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r public.debt_payroll_requests%rowtype;original public.debt_payroll_requests%rowtype;e public.financial_events%rowtype;l public.financial_event_lines%rowtype;a public.financial_event_obligations%rowtype;b public.financial_event_obligations%rowtype;o public.financial_event_obligations%rowtype;f public.liquidity_flows%rowtype;flow_ids uuid[];fid uuid;adjustments jsonb:='[]';item jsonb;amt numeric;left_base numeric;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into r from public.debt_payroll_requests where id=p_id;
 if r.id is null or not public.financial_core_can(r.organization_id,'financial_core.view')or not public.financial_core_can(r.organization_id,'financial_core.post')then raise exception 'PAYROLL_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||'|PHASE2B_CASH_WRITE',0));select * into r from public.debt_payroll_requests where id=p_id for update;
 select * into e from public.financial_events where id=r.financial_event_id for update;
 if r.execution_state='EXECUTED'and e.status='ACTUAL'then return jsonb_build_object('id',r.id,'status','ACTUAL','replay',true);end if;
 if r.execution_state<>'PENDING'or e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 select * into l from public.financial_event_lines where event_id=e.id;
 if not public.effective_organization_permission(r.organization_id,'financial_core.post',l.base_amount,e.base_currency)or not public.effective_organization_permission(r.organization_id,'liquidity.settle',l.base_amount,e.base_currency)then raise exception 'PAYROLL_ACCESS_DENIED';end if;
 perform id from public.financial_event_obligations where id in(r.installment_id,r.salary_obligation_id)order by id for update;
 select * into a from public.financial_event_obligations where id=r.installment_id and organization_id=r.organization_id;
 select * into b from public.financial_event_obligations where id=r.salary_obligation_id and organization_id=r.organization_id;
 if a.id is null or b.id is null or a.currency<>l.currency or b.currency<>l.currency or a.exchange_rate<>l.exchange_rate or b.exchange_rate<>l.exchange_rate or a.base_currency<>e.base_currency or b.base_currency<>e.base_currency or not exists(select 1 from public.financial_events where id=a.event_id and status='ACTUAL'and counterparty_id=e.counterparty_id and entity_id is not distinct from e.entity_id)or not exists(select 1 from public.financial_events where id=b.event_id and status='ACTUAL'and counterparty_id=e.counterparty_id and entity_id is not distinct from e.entity_id)then raise exception 'PAYROLL_SOURCE_INVALID';end if;
 update public.debt_payroll_requests set execution_state='EXECUTING'where id=r.id;
 if r.kind='DEDUCT'then
  if not exists(select 1 from public.financial_debt_categories where record_id=b.id and organization_id=r.organization_id and origin='CORE'and category='O_AP_EMPLOYEE')then raise exception 'PAYROLL_SOURCE_INVALID';end if;
  if l.base_amount>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=a.id),0)or l.base_amount>coalesce((select outstanding_base_amount from public.financial_event_obligation_balances where obligation_id=b.id),0)then raise exception 'PAYROLL_EXCEEDS_BALANCE';end if;
  insert into public.financial_event_obligation_allocations(organization_id,application_event_id,obligation_id,allocation_type,amount,currency,exchange_rate,base_currency,base_amount)
  select r.organization_id,e.id,v,'PAYROLL_OFFSET',l.amount,l.currency,l.exchange_rate,e.base_currency,l.base_amount from unnest(array[a.id,b.id])v;
  foreach fid in array array[a.id,b.id]loop
   select * into o from public.financial_event_obligations where id=fid;
   select array_agg(distinct x.target_record_id)into flow_ids from public.financial_event_links x where x.organization_id=r.organization_id and x.event_id=o.event_id and x.link_type='CASH_FLOW'and x.target_module='liquidity_flows'and(x.metadata->>'obligation_id'=o.id::text or(x.metadata->>'obligation_id'is null and(select count(*)from public.financial_event_obligations where event_id=o.event_id and adjusts_obligation_id is null)=1));
   if coalesce(array_length(flow_ids,1),0)>1 then raise exception 'PAYROLL_FLOW_AMBIGUOUS';end if;
   if coalesce(array_length(flow_ids,1),0)=1 then
    select * into f from public.liquidity_flows where id=flow_ids[1] and organization_id=r.organization_id for update;
    if f.currency<>l.currency or f.direction<>(case when o.obligation_type='RECEIVABLE'then 'INFLOW'else 'OUTFLOW'end)or round(l.amount*(f.base_amount/nullif(f.amount,0)),4)<>l.base_amount or l.amount>f.amount-f.settled_amount then raise exception 'PAYROLL_FLOW_MISMATCH';end if;
    update public.liquidity_flows set settled_amount=settled_amount+l.amount,settlement_status=case when settled_amount+l.amount>=amount then 'SETTLED'else 'PARTIAL'end,updated_at=now()where id=f.id;
    adjustments:=adjustments||jsonb_build_array(jsonb_build_object('id',f.id,'amount',l.amount));
    insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata)values(r.organization_id,e.id,'CASH_FLOW','liquidity_flows',f.id,jsonb_build_object('payroll_offset',true,'obligation_id',o.id));
   end if;
  end loop;
  update public.debt_payroll_requests set payload=payload||jsonb_build_object('flow_adjustments',adjustments)where id=r.id;
 else
  select * into original from public.debt_payroll_requests where id=r.target_id and organization_id=r.organization_id and kind='DEDUCT'and execution_state='EXECUTED'for update;
  if original.id is null or not exists(select 1 from public.financial_events where id=original.financial_event_id and status='ACTUAL')then raise exception 'PAYROLL_SOURCE_INVALID';end if;
  for item in select value from jsonb_array_elements(coalesce(original.payload->'flow_adjustments','[]'))loop
   select * into f from public.liquidity_flows where id=(item->>'id')::uuid and organization_id=r.organization_id for update;amt:=(item->>'amount')::numeric;
   if f.id is null or f.settled_amount<amt then raise exception 'PAYROLL_FLOW_MISMATCH';end if;
   update public.liquidity_flows set settled_amount=settled_amount-amt,settlement_status=case when settled_amount-amt<=0 then 'UNSETTLED'when settled_amount-amt>=amount then 'SETTLED'else 'PARTIAL'end,updated_at=now()where id=f.id;
  end loop;
  update public.debt_payroll_requests set execution_state='REVERSED'where id=original.id;
  perform public.transition_financial_event(original.financial_event_id,'REVERSED',e.description);
 end if;
 perform public.transition_financial_event(e.id,'ACTUAL','Approved noncash payroll offset');
 update public.debt_payroll_requests set execution_state='EXECUTED',executed_at=now()where id=r.id;
 return jsonb_build_object('id',r.id,'status','ACTUAL','cashMovementCreated',false);
end $$;
revoke all on function private.post_debt_payroll(uuid)from public,anon,authenticated;grant execute on function private.post_debt_payroll(uuid)to authenticated;
create or replace function public.post_debt_payroll(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_debt_payroll(p_id)$$;
revoke all on function public.post_debt_payroll(uuid)from public,anon;grant execute on function public.post_debt_payroll(uuid)to authenticated;
create or replace function private.cancel_debt_payroll(p_id uuid,p_reason text)returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$declare r public.debt_payroll_requests%rowtype;begin
 select * into r from public.debt_payroll_requests where id=p_id;
 if auth.uid()is null or r.id is null or not public.financial_core_can(r.organization_id,'financial_core.create')or not public.financial_core_can(r.organization_id,'financial_core.view')then raise exception 'PAYROLL_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||'|PHASE2B_CASH_WRITE',0));select * into r from public.debt_payroll_requests where id=p_id for update;
 if r.execution_state<>'PENDING'or length(trim(p_reason))<5 then raise exception 'PAYROLL_INVALID';end if;
 update public.debt_payroll_requests set execution_state='EXECUTING'where id=r.id;
 perform public.transition_financial_event(r.financial_event_id,'CANCELLED',p_reason);update public.debt_payroll_requests set execution_state='REVERSED'where id=r.id;
end $$;
revoke all on function private.cancel_debt_payroll(uuid,text)from public,anon,authenticated;grant execute on function private.cancel_debt_payroll(uuid,text)to authenticated;
create or replace function public.cancel_debt_payroll(p_id uuid,p_reason text)returns void language sql security invoker set search_path=pg_catalog,public,private as $$select private.cancel_debt_payroll(p_id,p_reason)$$;
revoke all on function public.cancel_debt_payroll(uuid,text)from public,anon;grant execute on function public.cancel_debt_payroll(uuid,text)to authenticated;
-- Every source-managed state transition and ledger mutation is atomic.
create or replace function private.guard_debt_payroll()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$declare r jsonb;eid uuid;begin
 r:=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 if tg_table_name='financial_events'then
  if tg_op='UPDATE'and old.status='ACTUAL'and new.status='REVERSED'and exists(select 1 from public.financial_event_obligations o join public.financial_event_obligation_allocations a on a.obligation_id=o.id join public.financial_events app on app.id=a.application_event_id and app.status='ACTUAL'where o.event_id=old.id and a.allocation_type='PAYROLL_OFFSET')then raise exception 'PAYROLL_HAS_ACTIVE_OFFSET';end if;
  if tg_op='UPDATE'and(new.source_module='DEBT_PAYROLL'or old.source_module='DEBT_PAYROLL')and new.source_module is distinct from old.source_module then raise exception 'PAYROLL_USE_SOURCE';end if;
  if tg_op='UPDATE'and old.source_module='DEBT_PAYROLL'and(to_jsonb(new)-array['status','updated_at'])is distinct from(to_jsonb(old)-array['status','updated_at'])then raise exception 'PAYROLL_USE_SOURCE';end if;
  if new.source_module<>'DEBT_PAYROLL'then return new;end if;
  if new.status='CANCELLED'and(tg_op='INSERT'or old.status<>'CANCELLED')and not(current_user='postgres'and exists(select 1 from public.debt_payroll_requests where financial_event_id=new.id and execution_state='EXECUTING'))then raise exception 'PAYROLL_USE_SOURCE';end if;
  if new.status='ACTUAL'and(tg_op='INSERT'or old.status<>'ACTUAL')and not(current_user='postgres'and exists(select 1 from public.debt_payroll_requests where financial_event_id=new.id and execution_state='EXECUTING'))then raise exception 'PAYROLL_USE_SOURCE';end if;
  if tg_op='UPDATE'and old.status in('ACTUAL','REVERSED')and new is distinct from old and not(current_user='postgres'and old.status='ACTUAL'and new.status='REVERSED'and exists(select 1 from public.debt_payroll_requests where target_id in(select id from public.debt_payroll_requests where financial_event_id=old.id)and execution_state='EXECUTING'and kind='REVERSE'))then raise exception 'PAYROLL_USE_SOURCE';end if;return new;
 end if;
 eid:=coalesce((r->>'application_event_id')::uuid,(r->>'event_id')::uuid);
 if tg_op='UPDATE'and current_user<>'postgres'and exists(select 1 from public.financial_events where id=coalesce((to_jsonb(old)->>'application_event_id')::uuid,(to_jsonb(old)->>'event_id')::uuid)and source_module='DEBT_PAYROLL')then raise exception 'PAYROLL_USE_SOURCE';end if;
 if current_user<>'postgres'and exists(select 1 from public.financial_events where id=eid and source_module='DEBT_PAYROLL')then raise exception 'PAYROLL_USE_SOURCE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_debt_payroll()from public,anon,authenticated;
do $trigger$begin if not exists(select 1 from pg_trigger where tgrelid='public.financial_events'::regclass and tgname='debt_payroll_event_guard')then create trigger debt_payroll_event_guard before insert or update on public.financial_events for each row execute function private.guard_debt_payroll();end if;end $trigger$;
do $trigger$begin if not exists(select 1 from pg_trigger where tgrelid='public.financial_event_lines'::regclass and tgname='debt_payroll_line_guard')then create trigger debt_payroll_line_guard before insert or update or delete on public.financial_event_lines for each row execute function private.guard_debt_payroll();end if;end $trigger$;
do $trigger$begin if not exists(select 1 from pg_trigger where tgrelid='public.financial_event_links'::regclass and tgname='debt_payroll_link_guard')then create trigger debt_payroll_link_guard before insert or update or delete on public.financial_event_links for each row execute function private.guard_debt_payroll();end if;end $trigger$;
do $trigger$begin if not exists(select 1 from pg_trigger where tgrelid='public.financial_event_obligation_allocations'::regclass and tgname='debt_payroll_allocation_guard')then create trigger debt_payroll_allocation_guard before insert or update or delete on public.financial_event_obligation_allocations for each row execute function private.guard_debt_payroll();end if;end $trigger$;

create or replace function private.guard_payroll_linked_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$begin
 if current_user<>'postgres'and exists(select 1 from public.financial_event_links x join public.financial_events e on e.id=x.event_id and e.organization_id=x.organization_id and e.status='ACTUAL'where x.organization_id=old.organization_id and x.target_module='liquidity_flows'and x.target_record_id=old.id and e.source_module='DEBT_PAYROLL')then raise exception 'PAYROLL_USE_SOURCE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_payroll_linked_flow()from public,anon,authenticated;
do $trigger$begin if not exists(select 1 from pg_trigger where tgrelid='public.liquidity_flows'::regclass and tgname='payroll_linked_flow_guard')then create trigger payroll_linked_flow_guard before update or delete on public.liquidity_flows for each row execute function private.guard_payroll_linked_flow();end if;end $trigger$;
