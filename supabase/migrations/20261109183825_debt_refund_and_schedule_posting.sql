-- BEGIN DEBT OPERATION SOURCE
-- Dedicated clearing identity and explicit new-operation roles; no old rows edited.
do $$
declare definition text;
 needle constant text:=$n$select id into cls from$n$;
 selection constant text:=$n$and classification_type=case when direction='INFLOW'then 'RECEIVABLE'else 'PAYABLE'end and active order by id limit 1$n$;
 line_needle constant text:=$n$'line_number',1,'classification_id',cls$n$;
begin
 definition:=pg_get_functiondef('private.prepare_debt_operation(jsonb)'::regprocedure);
 if strpos(definition,selection)=0 or strpos(definition,line_needle)=0 then raise exception 'DEBT_OPERATION_SOURCE_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$n$insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
 values(org,'DEBT_RECEIVABLE_CLEARING','تحصيل أصل الذمة','RECEIVABLE',true,uid),
 (org,'DEBT_PAYABLE_CLEARING','سداد أصل الذمة','PAYABLE',true,uid) on conflict(organization_id,code) do nothing;
 select id into cls from$n$);
 definition:=replace(definition,selection,$n$and classification_type=case when direction='INFLOW'then 'RECEIVABLE'else 'PAYABLE'end
 and code=case when direction='INFLOW' then 'DEBT_RECEIVABLE_CLEARING' else 'DEBT_PAYABLE_CLEARING' end and active$n$);
 definition:=replace(definition,line_needle,$n$'line_number',1,'metadata',jsonb_build_object('source_role',case when kind='RESCHEDULE' then 'DEBT_RESCHEDULE' when kind='REFUND' then 'DEBT_REFUND_'||o.obligation_type else null end),'classification_id',cls$n$);
 execute definition;
end $$;
-- END DEBT OPERATION SOURCE

-- BEGIN DEBT OPERATION POSTING
create function private.financial_nonposting_reschedule(p_org uuid,p_event uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.debt_operation_requests r join public.financial_events e
 on e.id=r.financial_event_id and e.organization_id=r.organization_id
 where r.organization_id=p_org and e.id=p_event and r.kind='RESCHEDULE' and r.execution_state in('EXECUTING','EXECUTED')
 and e.source_module='DEBT_OPERATIONS' and e.event_type='ADJUSTMENT'
 and (select count(*) from public.financial_event_lines where organization_id=p_org and event_id=p_event)=1
 and exists(select 1 from public.financial_event_lines where organization_id=p_org and event_id=p_event and metadata->>'source_role'='DEBT_RESCHEDULE' and cash_direction='NON_CASH')
 and not exists(select 1 from public.financial_event_obligations where organization_id=p_org and event_id=p_event)
 and not exists(select 1 from public.financial_event_obligation_allocations where organization_id=p_org and application_event_id=p_event)
 and not exists(select 1 from public.liquidity_settlements where organization_id=p_org and financial_event_id=p_event))
$$;
revoke all on function private.financial_nonposting_reschedule(uuid,uuid) from public,anon,authenticated;
create function private.financial_debt_refund_rules(p_org uuid,p_event jsonb,p_rules jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare r record;leaf text;direction text;cls text;rules jsonb;
begin
 if p_event->>'sourceModule' is distinct from 'DEBT_OPERATIONS' or p_event->>'eventType' is distinct from 'SETTLEMENT' or p_event->>'reversesEventId' is not null then return p_rules;end if;
 select request.*,o.obligation_type,adjustment.settleable_base_amount into r from public.debt_operation_requests request
 join public.financial_event_obligations o on o.id=request.target_id and o.organization_id=request.organization_id
 join public.financial_event_obligations adjustment on adjustment.organization_id=o.organization_id and adjustment.event_id=request.financial_event_id and adjustment.adjusts_obligation_id=o.id and adjustment.adjustment_effect='DECREASE'
 where request.organization_id=p_org and request.financial_event_id=(p_event->>'id')::uuid and request.kind='REFUND' and request.execution_state in('EXECUTING','EXECUTED');
 if not found or r.obligation_type not in('SUPPLIER_ADVANCE','CUSTOMER_ADVANCE')
 or (select count(*) from public.financial_event_obligations where organization_id=p_org and event_id=(p_event->>'id')::uuid)<>1
 or jsonb_array_length(p_event->'lines') is distinct from 1
 or (p_event->'lines'->0->>'recognitionSign')::int is distinct from 1
 or r.settleable_base_amount is distinct from (p_event->'lines'->0->>'baseAmount')::numeric or r.settleable_base_amount<=0 then raise exception 'REPORTING_REFUND_SOURCE_REQUIRED';end if;
 direction:=case r.obligation_type when 'SUPPLIER_ADVANCE' then 'INFLOW' else 'OUTFLOW' end;
 cls:=p_event->'lines'->0->>'classificationId';
 if p_event->'lines'->0->>'cashDirection' is distinct from direction
 or split_part(cls,':',2) is distinct from 'DEBT_REFUND_'||r.obligation_type then raise exception 'REPORTING_REFUND_SOURCE_REQUIRED';end if;
 leaf:=private.financial_original_obligation_account(p_org,r.target_id);
 select coalesce(jsonb_agg(value),'[]'::jsonb) into rules from jsonb_array_elements(p_rules)
 where not(value->>'sourceModule'='DEBT_OPERATIONS' and value->>'eventType'='SETTLEMENT' and value->>'classificationId'=cls and value->>'cashDirection'=direction);
 return rules||jsonb_build_array(jsonb_build_object('sourceModule','DEBT_OPERATIONS','eventType','SETTLEMENT','classificationId',cls,'cashDirection',direction,
 'debitAccountId',case direction when 'INFLOW' then '1000' else leaf end,'creditAccountId',case direction when 'INFLOW' then leaf else '1000' end,'cashActivity','OPERATING','detailed',true));
end $$;
revoke all on function private.financial_debt_refund_rules(uuid,jsonb,jsonb) from public,anon,authenticated;
do $$
declare definition text;needle constant text:='private.financial_advance_application_rules(new.organization_id,ev,pol.rules)';
begin
 definition:=pg_get_functiondef('private.financial_capture_actual_posting()'::regprocedure);
 if strpos(definition,needle)=0 or strpos(definition,'if new.status<>''ACTUAL'' then return null;end if;')=0 then raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'private.financial_debt_refund_rules(new.organization_id,ev,'||needle||')');
 definition:=replace(definition,'if new.status<>''ACTUAL'' then return null;end if;',
 'if new.status<>''ACTUAL'' then return null;end if; if private.financial_nonposting_reschedule(new.organization_id,new.id) then return null;end if;');
 -- Capture must retain the original-event identity even when the normalizer's
 -- date window excludes it. Dynamic source adapters must not treat a reversal
 -- as a fresh refund, advance application or installment.
 if strpos(definition,'if ev is null then raise exception ''REPORTING_SOURCE_NORMALIZATION_REQUIRED'';end if;')=0 then raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,'if ev is null then raise exception ''REPORTING_SOURCE_NORMALIZATION_REQUIRED'';end if;',
 $n$if ev is null then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 ev:=ev||coalesce((select jsonb_build_object('reversesEventId',related_event_id) from public.financial_event_links
 where organization_id=new.organization_id and event_id=new.id and link_type='REVERSAL_OF'),'{}'::jsonb);$n$);
 execute definition;
end $$;
-- END DEBT OPERATION POSTING

-- BEGIN RESCHEDULE NORMALIZATION
-- Only new tagged, verified nonposting schedule changes are excluded. Legacy
-- snapshots/events keep their existing behavior and need explicit remediation.
do $$
declare definition text;needle constant text:='return result||private.financial_reporting_legacy_events(p_org,p_from,p_to);';
begin
 definition:=pg_get_functiondef('private.financial_reporting_events(uuid,date,date)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'REPORTING_NORMALIZER_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,$n$return coalesce((select jsonb_agg(item) from jsonb_array_elements(result) item
 where not private.financial_nonposting_reschedule(p_org,(item->>'id')::uuid)),'[]'::jsonb)||private.financial_reporting_legacy_events(p_org,p_from,p_to);$n$);
end $$;
-- END RESCHEDULE NORMALIZATION
