-- Additive structured terms: existing principal contracts and posted history are unchanged.
create table public.financing_contract_terms(
 id uuid primary key references public.debt_contracts(id),organization_id uuid not null references public.organizations(id),
 terms jsonb not null,plan jsonb not null,payload_fingerprint text not null,created_at timestamptz not null default now()
);
alter table public.financing_contract_terms enable row level security;
revoke all on public.financing_contract_terms from public,anon,authenticated;grant select on public.financing_contract_terms to authenticated;
create policy financing_terms_read on public.financing_contract_terms for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create index financing_terms_org on public.financing_contract_terms(organization_id);
create table public.financing_charge_events(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.financing_contract_terms(id),organization_id uuid not null references public.organizations(id),
 installment_number integer not null,financial_event_id uuid not null unique references public.financial_events(id),created_at timestamptz not null default now()
);
alter table public.financing_charge_events enable row level security;
revoke all on public.financing_charge_events from public,anon,authenticated;grant select on public.financing_charge_events to authenticated;
create policy financing_charge_read on public.financing_charge_events for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create index financing_charge_contract on public.financing_charge_events(organization_id,contract_id,installment_number);

create function public.calculate_financing_schedule(p jsonb)returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare principal numeric:=(p->>'principal')::numeric;annual numeric:=(p->>'annualRate')::numeric;n int:=(p->>'count')::int;freq int:=(p->>'frequencyMonths')::int;basis int:=(p->>'yearDays')::int;
 start_dt date:=(p->>'startDate')::date;first_dt date:=(p->>'firstDueDate')::date;method text:=p->>'method';repayment text:=p->>'repayment';
 i int;due date;prev date;days int;r numeric;discount numeric:=1;pv numeric:=0;payment numeric;equal_principal numeric;balance numeric;part numeric;charge numeric;charged numeric:=0;flat_total numeric;result jsonb:='[]';rates jsonb:='[]';item jsonb;
begin
 if principal is null or principal<=0 or principal>1e12 or principal<>round(principal,4) or principal::text in('NaN','Infinity','-Infinity') or annual is null or annual<0 or annual>100 or annual::text in('NaN','Infinity','-Infinity') or n is null or n not between 1 and 48 or freq is null or freq not in(1,3,6,12)or basis is null or basis not in(354,360,365)or start_dt is null or first_dt is null or first_dt<=start_dt or method is null or method not in('FLAT','DECLINING')or repayment is null or repayment not in('EQUAL_PAYMENT','EQUAL_PRINCIPAL')or(method='FLAT'and repayment<>'EQUAL_PRINCIPAL') then raise exception 'INVALID_FINANCE_TERMS';end if;
 prev:=start_dt;
 for i in 0..n-1 loop
  due:=(first_dt+make_interval(months=>i*freq))::date;days:=due-prev;
  r:=annual/100*days/basis;discount:=discount*(1+r);pv:=pv+1/discount;
  rates:=rates||jsonb_build_array(jsonb_build_object('from',prev,'due',due,'days',days,'rate',r));prev:=due;
 end loop;
 payment:=round(principal/pv,4);equal_principal:=trunc(principal/n,4);balance:=principal;flat_total:=round(principal*annual/100*(prev-start_dt)/basis,4);
 for i in 0..n-1 loop
  item:=rates->i;charge:=case when method='FLAT'and i=n-1 then flat_total-charged else round((case when method='FLAT'then principal else balance end)*(item->>'rate')::numeric,4)end;charged:=charged+charge;
  part:=case when i=n-1 then balance when repayment='EQUAL_PAYMENT'then payment-charge else equal_principal end;part:=round(least(part,balance),4);
  if part<=0 then raise exception 'FINANCE_PRECISION_OR_NEGATIVE_AMORTIZATION';end if;
  result:=result||jsonb_build_array(jsonb_build_object('number',i+1,'from',item->>'from','due_date',item->>'due','days',(item->>'days')::int,'opening',balance,'principal',part,'finance',charge,'total',part+charge,'closing',balance-part));balance:=balance-part;
 end loop;return result;
end $$;
revoke all on function public.calculate_financing_schedule(jsonb)from public,anon;grant execute on function public.calculate_financing_schedule(jsonb)to authenticated;

create function private.create_financed_contract(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c jsonb:=p->'contract';t jsonb:=p->'terms';org uuid:=(c->>'organization_id')::uuid;plan jsonb;schedule jsonb;r jsonb;prior public.financing_contract_terms%rowtype;fp text:=md5(p::text);
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.create')then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
 if c->>'kind' is distinct from 'LOAN'or c->>'mode' is distinct from 'NEW'or(t->>'annualRate')::numeric<=0 or(t->>'principal')::numeric is distinct from(c->>'principal')::numeric or t->>'startDate'is distinct from c->>'date'then raise exception 'INVALID_FINANCE_TERMS';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|FINANCED_CONTRACT|'||(c->>'request_id'),0));
 select f.* into prior from public.financing_contract_terms f join public.debt_contracts d on d.id=f.id where d.organization_id=org and d.request_id=(c->>'request_id')::uuid;
 if prior.id is not null then if prior.payload_fingerprint<>fp then raise exception 'DEBT_CONTRACT_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'replay',true);end if;
 plan:=public.calculate_financing_schedule(t);select jsonb_agg(jsonb_build_object('amount',(v->>'principal')::numeric,'due_date',v->>'due_date')order by(v->>'number')::int)into schedule from jsonb_array_elements(plan)v;
 r:=private.create_debt_contract(jsonb_set(c,'{schedule}',schedule));
 -- An existing ordinary contract cannot be reclassified by replaying its request ID.
 if coalesce((r->>'replay')::boolean,false)then raise exception 'EXISTING_CONTRACT_CANNOT_BE_RECLASSIFIED';end if;
 insert into public.financing_contract_terms(id,organization_id,terms,plan,payload_fingerprint)values((r->>'id')::uuid,org,t,plan,fp);return r;
end $$;
revoke all on function private.create_financed_contract(jsonb)from public,anon;grant execute on function private.create_financed_contract(jsonb)to authenticated;
create function public.create_financed_contract(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.create_financed_contract(p_payload);$$;
revoke all on function public.create_financed_contract(jsonb)from public,anon;grant execute on function public.create_financed_contract(jsonb)to authenticated;

create function private.prepare_financing_charge(p_id uuid,p_number integer)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c public.debt_contracts%rowtype;t public.financing_contract_terms%rowtype;item jsonb;eid uuid;cls uuid;base text;amount numeric;event_state text;seq int;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.debt_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.create')then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|FINANCE_CHARGE|'||p_id::text,0));
 select * into t from public.financing_contract_terms where id=p_id;item:=t.plan->(p_number-1);
 if item is null or p_number<1 or(item->>'finance')::numeric<=0 or(item->>'due_date')::date>(now()at time zone 'Asia/Riyadh')::date then raise exception 'FINANCE_CHARGE_NOT_DUE';end if;
 select status,base_currency into event_state,base from public.financial_events where id=c.financial_event_id;
 if event_state<>'ACTUAL'then raise exception 'ACTUAL_FINANCING_REQUIRED';end if;
 select e.id into eid from public.financing_charge_events a join public.financial_events e on e.id=a.financial_event_id where a.contract_id=p_id and a.installment_number=p_number and e.status not in('CANCELLED','REVERSED')order by a.created_at desc limit 1;
 if eid is not null then return jsonb_build_object('eventId',eid,'replay',true);end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(c.organization_id,case when c.side='PAYABLE'then 'CONTRACT_FINANCE_COST'else 'CONTRACT_FINANCE_RETURN'end,case when c.side='PAYABLE'then 'تكلفة تمويل مستحقة'else 'عائد تمويل مستحق'end,case when c.side='PAYABLE'then 'OPEX'else 'REVENUE'end,true,auth.uid())on conflict(organization_id,code)do nothing;
 select id into cls from public.financial_classifications where organization_id=c.organization_id and code=case when c.side='PAYABLE'then 'CONTRACT_FINANCE_COST'else 'CONTRACT_FINANCE_RETURN'end and active;
 if cls is null then raise exception 'FINANCE_CLASSIFICATION_REQUIRED';end if;
 select count(*)+1 into seq from public.financing_charge_events where contract_id=p_id and installment_number=p_number;amount:=(item->>'finance')::numeric;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',c.organization_id,'entity_id',c.entity_id,'counterparty_id',c.counterparty_id,'event_type',case when c.side='PAYABLE'then 'EXPENSE'else 'REVENUE'end,'source_module','FINANCE_CONTRACTS','source_record_id',c.id,'source_event_key','charge:'||c.id||':'||p_number||':'||seq,'event_date',item->>'due_date','due_date',item->>'due_date','base_currency',base,'description','تكلفة / عائد تمويل · '||c.reference||' · قسط '||p_number,'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description','تكلفة / عائد الفترة المستحق','amount',amount,'currency',c.currency,'exchange_rate',c.exchange_rate,'base_amount',round(amount*c.exchange_rate,4),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',jsonb_build_array(jsonb_build_object('obligation_key','finance-charge:'||p_number,'obligation_type',c.side,'settleable_amount',amount,'currency',c.currency,'exchange_rate',c.exchange_rate,'base_currency',base,'settleable_base_amount',round(amount*c.exchange_rate,4))),'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','debt_contracts','target_record_id',c.id))));
 insert into public.financing_charge_events(contract_id,organization_id,installment_number,financial_event_id)values(c.id,c.organization_id,p_number,eid);
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata)select eid,c.organization_id,'CASH_FLOW','liquidity_flows',f.id,jsonb_build_object('obligation_id',o.id)from public.liquidity_flows f join public.financial_event_obligations o on o.event_id=eid where f.organization_id=c.organization_id and f.source_module='FINANCE_PLAN'and f.source_event_key='finance-plan:'||c.id||':'||p_number;
 perform public.transition_financial_event(eid,'PLANNED','Finance period completed');perform public.transition_financial_event(eid,'COMMITTED','Awaiting finance charge approval');return jsonb_build_object('eventId',eid);
end $$;
revoke all on function private.prepare_financing_charge(uuid,integer)from public,anon;grant execute on function private.prepare_financing_charge(uuid,integer)to authenticated;
create function public.prepare_financing_charge(p_id uuid,p_number integer)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.prepare_financing_charge(p_id,p_number);$$;
revoke all on function public.prepare_financing_charge(uuid,integer)from public,anon;grant execute on function public.prepare_financing_charge(uuid,integer)to authenticated;

create function private.post_financed_contract(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare c public.debt_contracts%rowtype;t public.financing_contract_terms%rowtype;item jsonb;r jsonb;flow uuid;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.debt_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.post')then raise exception 'DEBT_CONTRACT_ACCESS_DENIED';end if;
 select * into t from public.financing_contract_terms where id=p_id;
 if t.id is null then raise exception 'FINANCED_CONTRACT_REQUIRED';end if;
 r:=private.post_debt_contract(p_id);
 for item in select value from jsonb_array_elements(t.plan)loop
  if(item->>'finance')::numeric>0 and not exists(select 1 from public.liquidity_flows where organization_id=c.organization_id and source_module='FINANCE_PLAN'and source_event_key='finance-plan:'||c.id||':'||(item->>'number'))then
   insert into public.liquidity_flows(organization_id,entity_id,account_id,direction,flow_type,title,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
   values(c.organization_id,c.entity_id,c.account_id,case when c.side='PAYABLE'then 'OUTFLOW'else 'INFLOW'end,'FINANCING','تكلفة / عائد مجدول · '||c.reference||' · قسط '||(item->>'number'),c.counterparty_id,(item->>'due_date')::date,(item->>'finance')::numeric,c.currency,round((item->>'finance')::numeric*c.exchange_rate,4),'EXPECTED','MANUAL',c.reference,'FINANCE_PLAN',c.id,'finance-plan:'||c.id||':'||(item->>'number'))returning id into flow;
  end if;
 end loop;return r;
end $$;
revoke all on function private.post_financed_contract(uuid)from public,anon;grant execute on function private.post_financed_contract(uuid)to authenticated;
create function public.post_financed_contract(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_financed_contract(p_id);$$;
revoke all on function public.post_financed_contract(uuid)from public,anon;grant execute on function public.post_financed_contract(uuid)to authenticated;

create function private.guard_finance_plan_flow()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.source_module='FINANCE_PLAN'then
  if tg_op='DELETE'or row(new.organization_id,new.source_module,new.source_record_id,new.source_event_key,new.amount,new.currency,new.base_amount,new.direction,new.due_date)is distinct from row(old.organization_id,old.source_module,old.source_record_id,old.source_event_key,old.amount,old.currency,old.base_amount,old.direction,old.due_date)then raise exception 'FINANCE_PLAN_IMMUTABLE';end if;
  if (new.status='ACTUAL'and old.status<>'ACTUAL'or new.settled_amount is distinct from old.settled_amount)and not exists(select 1 from public.financial_event_links l join public.financial_events e on e.id=l.event_id join public.financing_charge_events a on a.financial_event_id=e.id where l.target_record_id=old.id and l.link_type='CASH_FLOW'and e.status='ACTUAL')then raise exception 'FINANCE_CHARGE_RECOGNITION_REQUIRED';end if;
 end if;if tg_op='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.guard_finance_plan_flow()from public,anon,authenticated;
create trigger finance_plan_flow_guard before update or delete on public.liquidity_flows for each row execute function private.guard_finance_plan_flow();
create function private.guard_finance_contract_operation()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if new.kind in('RESCHEDULE','REVERSE')and exists(select 1 from public.financing_contract_terms t join public.debt_contracts c on c.id=t.id where c.organization_id=new.organization_id and(new.target_id=c.id or new.target_id=c.financial_event_id))then raise exception 'STRUCTURED_FINANCING_REQUIRES_CONTRACT_AMENDMENT';end if;return new;
end $$;
revoke all on function private.guard_finance_contract_operation()from public,anon,authenticated;
create trigger structured_finance_operation_guard before insert or update on public.debt_operation_requests for each row execute function private.guard_finance_contract_operation();
