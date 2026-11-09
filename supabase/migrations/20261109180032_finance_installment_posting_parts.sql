-- Newly prepared installments have one normalized source component per obligation.
create function private.financial_installment_posting_rules(p_org uuid,p_event jsonb,p_rules jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare contract_id uuid;part jsonb;allocation record;leaf text;role text;activity text;rules jsonb:=p_rules;seen uuid[]:='{}';roles text[]:='{}';direction text;
begin
 if p_event->>'eventType' is distinct from 'SETTLEMENT' or p_event->>'reversesEventId' is not null then return p_rules;end if;
 select source_record_id into contract_id from public.financial_events where organization_id=p_org and id=(p_event->>'id')::uuid
 and source_module='OPERATIONAL_CONSOLE' and source_event_key like 'financing-installment:%';
 if not found then return p_rules;end if;
 if contract_id is null or jsonb_array_length(p_event->'lines') not between 1 and 2
 or (select count(*) from public.financial_event_obligation_allocations where organization_id=p_org and application_event_id=(p_event->>'id')::uuid)<>jsonb_array_length(p_event->'lines') then
 raise exception 'REPORTING_FINANCE_COMPONENTS_REQUIRED';end if;
 for part in select value from jsonb_array_elements(p_event->'lines') loop
  select a.*,o.obligation_type,e.source_module,e.source_record_id into allocation
  from public.financial_event_lines l
  join public.financial_event_obligation_allocations a on a.organization_id=l.organization_id and a.application_event_id=l.event_id and a.obligation_id::text=l.metadata->>'settlement_obligation_id' and a.allocation_type='PAYMENT'
  join public.financial_event_obligations o on o.id=a.obligation_id and o.organization_id=a.organization_id
  join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id
  where l.organization_id=p_org and l.event_id=(p_event->>'id')::uuid and l.id::text||':'||(l.metadata->>'source_role')=part->>'id';
  if not found or allocation.source_record_id is distinct from contract_id or allocation.obligation_type not in('PAYABLE','RECEIVABLE')
   or allocation.obligation_id=any(seen) or allocation.base_amount is distinct from (part->>'baseAmount')::numeric or allocation.base_amount<=0
   or (part->>'recognitionSign')::int is distinct from 1 then raise exception 'REPORTING_FINANCE_COMPONENTS_REQUIRED';end if;
  role:=case allocation.source_module when 'DEBT_CONTRACTS' then 'FINANCE_PRINCIPAL_PAYMENT' when 'FINANCE_CONTRACTS' then 'FINANCE_CHARGE_PAYMENT' end;
  if role is null or role=any(roles) or split_part(part->>'classificationId',':',2) is distinct from role then raise exception 'REPORTING_FINANCE_COMPONENTS_REQUIRED';end if;
  seen:=array_append(seen,allocation.obligation_id);roles:=array_append(roles,role);
  if direction is not null and direction<>(case allocation.obligation_type when 'PAYABLE' then 'OUTFLOW' else 'INFLOW' end) then raise exception 'REPORTING_FINANCE_COMPONENTS_REQUIRED';end if;
  direction:=case allocation.obligation_type when 'PAYABLE' then 'OUTFLOW' else 'INFLOW' end;
  if part->>'cashDirection' is distinct from direction then raise exception 'REPORTING_FINANCE_COMPONENTS_REQUIRED';end if;
  leaf:=private.financial_original_obligation_account(p_org,allocation.obligation_id);
  select value->>'cashActivity' into activity from jsonb_array_elements(p_rules)
   where value->>'sourceModule'='OPERATIONAL_CONSOLE' and value->>'eventType'='SETTLEMENT'
    and value->>'classificationId'=part->>'classificationId' and value->>'cashDirection'=direction;
  activity:=coalesce(activity,case when role='FINANCE_CHARGE_PAYMENT' then 'OPERATING' when direction='OUTFLOW' then 'FINANCING' else 'INVESTING' end);
  select coalesce(jsonb_agg(value),'[]'::jsonb) into rules from jsonb_array_elements(rules)
   where not(value->>'sourceModule'='OPERATIONAL_CONSOLE' and value->>'eventType'='SETTLEMENT'
    and value->>'classificationId'=part->>'classificationId' and value->>'cashDirection'=direction);
  rules:=rules||jsonb_build_array(jsonb_build_object('sourceModule','OPERATIONAL_CONSOLE','eventType','SETTLEMENT','classificationId',part->>'classificationId',
    'cashDirection',direction,'debitAccountId',case direction when 'OUTFLOW' then leaf else '1000' end,
    'creditAccountId',case direction when 'OUTFLOW' then '1000' else leaf end,'cashActivity',activity,'detailed',true));
 end loop;
 return rules;
end $$;
revoke all on function private.financial_installment_posting_rules(uuid,jsonb,jsonb) from public,anon,authenticated;
do $$
declare definition text;needle constant text:='private.financial_advance_application_rules(new.organization_id,ev,pol.rules)';
begin
 definition:=pg_get_functiondef('private.financial_capture_actual_posting()'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,'private.financial_installment_posting_rules(new.organization_id,ev,'||needle||')');
end $$;
