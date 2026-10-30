create or replace function private.create_participation_contract(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();org uuid:=(p->>'organization_id')::uuid;req uuid:=(p->>'request_id')::uuid;prior public.participation_contracts%rowtype;capital numeric:=(p->>'capital')::numeric;fx numeric:=(p->>'exchange_rate')::numeric;profit numeric:=(p->>'investor_profit_pct')::numeric;loss numeric:=(p->>'investor_loss_pct')::numeric;start_dt date:=(p->>'start_date')::date;maturity date:=nullif(p->>'maturity_date','')::date;base text;new_id uuid;fp text:=md5(p::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 if req is null or capital is null or capital<=0 or capital>1e12 or capital<>round(capital,4)or capital::text in('NaN','Infinity','-Infinity')or fx is null or fx<=0 or fx>1e6 or fx::text in('NaN','Infinity','-Infinity')or profit is null or profit<=0 or profit>100 or profit::text in('NaN','Infinity','-Infinity')or loss is null or loss<=0 or loss>100 or loss::text in('NaN','Infinity','-Infinity')or start_dt is null or maturity<start_dt or(p->>'currency')!~'^[A-Z]{3}$'or p->>'capital_treatment'is null or p->>'capital_treatment'not in('FINANCING','EQUITY')or p->>'variable_return'is distinct from 'true'or length(trim(coalesce(p->>'reference','')))not between 1 and 120 or length(trim(coalesce(p->>'description','')))not between 3 and 500 or length(trim(coalesce(p->>'project','')))not between 3 and 160 or length(trim(coalesce(p->>'accounting_basis','')))not between 15 and 1000 or length(trim(coalesce(p->>'exit_terms','')))not between 15 and 1000 or length(trim(coalesce(p->>'loss_terms','')))not between 15 and 1000 then raise exception 'PARTICIPATION_TERMS_INVALID';end if;
 select base_currency into base from public.organizations where id=org;if base is null or(p->>'currency'=base and fx<>1)then raise exception 'PARTICIPATION_CURRENCY_INVALID';end if;
 if not exists(select 1 from public.liquidity_counterparties where id=(p->>'counterparty_id')::uuid and organization_id=org and active)or(nullif(p->>'entity_id','')is not null and not exists(select 1 from public.organization_entities where id=(p->>'entity_id')::uuid and organization_id=org and active))then raise exception 'PARTICIPATION_SCOPE_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|PARTICIPATION_CREATE|'||req::text,0));select * into prior from public.participation_contracts where organization_id=org and request_id=req;
 if prior.id is not null then if prior.payload_fingerprint<>fp then raise exception 'PARTICIPATION_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'replay',true);end if;
 insert into public.participation_contracts(organization_id,request_id,counterparty_id,entity_id,reference,description,project,capital,currency,exchange_rate,start_date,maturity_date,investor_profit_pct,investor_loss_pct,capital_treatment,accounting_basis,exit_terms,loss_terms,payload_fingerprint,created_by)
 values(org,req,(p->>'counterparty_id')::uuid,nullif(p->>'entity_id','')::uuid,trim(p->>'reference'),trim(p->>'description'),trim(p->>'project'),capital,p->>'currency',fx,start_dt,maturity,profit,loss,p->>'capital_treatment',trim(p->>'accounting_basis'),trim(p->>'exit_terms'),trim(p->>'loss_terms'),fp,uid)returning participation_contracts.id into new_id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(uid,'participation_contract',new_id,'CREATE',p);return jsonb_build_object('id',new_id,'state','DRAFT');
end $$;


create or replace function private.finish_participation_contract(p_id uuid,p_action text,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.participation_contracts%rowtype;net numeric;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.participation_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.post')or p_action is null or p_action not in('CLOSE','CANCEL')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|PARTICIPATION_CONTRACT|'||c.id,0));select * into c from public.participation_contracts where id=p_id for update;
 if c.state=(case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end)then return jsonb_build_object('id',c.id,'replay',true);end if;
 if c.state in('CANCELLED','CLOSED')then raise exception 'PARTICIPATION_CONTRACT_CLOSED';end if;
 if exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status in('DRAFT','PLANNED','COMMITTED'))then raise exception 'PARTICIPATION_PENDING_MOVEMENTS';end if;
 if p_action='CANCEL'and exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL')then raise exception 'PARTICIPATION_HAS_POSTED_MOVEMENTS';end if;
 if p_action='CLOSE'then
  select coalesce(sum(case when m.kind='CAPITAL_RECEIPT'then m.amount when m.kind in('CAPITAL_RETURN','LOSS')then -m.amount else 0 end),0)into net from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL';
  if net<>0 or exists(select 1 from public.participation_movements m join public.financial_event_obligation_balances b on b.event_id=m.recognition_event_id where m.contract_id=c.id and b.outstanding_base_amount>0)then raise exception 'PARTICIPATION_OPEN_CAPITAL_OR_DISTRIBUTIONS';end if;
 end if;
 update public.participation_contracts set state=case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end where id=c.id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(auth.uid(),'participation_contract',c.id,p_action,jsonb_build_object('organization_id',c.organization_id,'reason',p_reason));return jsonb_build_object('id',c.id,'state',case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end);
end $$;

create function private.participation_clearing_classification()returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)values(new.organization_id,'PARTICIPATION_PAYABLE_CLEARING','تسوية مستحقات المستثمرين','PAYABLE',true,auth.uid())on conflict(organization_id,code)do nothing;return new;end $$;
revoke all on function private.participation_clearing_classification()from public,anon,authenticated;
create trigger participation_clearing_classification before insert on public.participation_movements for each row execute function private.participation_clearing_classification();


create or replace function private.cancel_participation_movement(p_id uuid,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.participation_movements%rowtype;event_state text;flow uuid;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.create')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));select * into m from public.participation_movements where id=p_id for update;
 if m.execution_state='CANCELLED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if m.execution_state<>'PREPARED'or exists(select 1 from public.financial_events where id in(m.recognition_event_id,m.cash_event_id)and status in('ACTUAL','REVERSED'))then raise exception 'POSTED_PARTICIPATION_REQUIRES_CORRECTION';end if;
 select e.status into event_state from public.financial_events e where e.id=m.recognition_event_id;
 if event_state<>'CANCELLED'then perform public.transition_financial_event(m.recognition_event_id,'CANCELLED',p_reason);end if;
 if m.cash_event_id is not null then select e.status into event_state from public.financial_events e where e.id=m.cash_event_id;if event_state<>'CANCELLED'then perform public.transition_financial_event(m.cash_event_id,'CANCELLED',p_reason);end if;end if;
 flow:=m.flow_id;update public.participation_movements set execution_state='CANCELLED',flow_id=null where id=m.id;
 if flow is not null then delete from public.financial_event_links where event_id in(m.recognition_event_id,m.cash_event_id)and target_module='liquidity_flows'and target_record_id=flow;delete from public.liquidity_flows where id=flow and settled_amount=0;end if;
 return jsonb_build_object('id',m.id,'status','CANCELLED');
end $$;
