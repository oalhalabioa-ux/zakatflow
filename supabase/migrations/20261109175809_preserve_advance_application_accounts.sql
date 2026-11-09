-- Resolve an obligation from its ORIGINAL captured posting and canonical amounts.
-- A shared control, multiple leaf accounts or a missing snapshot is not guessed.
create function private.financial_original_obligation_account(p_org uuid,p_obligation uuid)
returns text language plpgsql stable set search_path='' as $$
declare o record;ev jsonb;legs jsonb;r jsonb;l jsonb;leg record;candidate text;account_code text;total numeric:=0;expected numeric;roots text[];normal_sign integer;
begin
 select ob.*,e.event_date into o from public.financial_event_obligations ob
 join public.financial_events e on e.id=ob.event_id and e.organization_id=ob.organization_id
 where ob.organization_id=p_org and ob.id=p_obligation;
 if not found then raise exception 'REPORTING_OBLIGATION_SOURCE_REQUIRED';end if;
 roots:=case o.obligation_type when 'SUPPLIER_ADVANCE' then array['1300'] when 'CUSTOMER_ADVANCE' then array['2400']
 when 'PAYABLE' then array['2100','2200','2300','2500'] when 'RECEIVABLE' then array['1100','1200','1800'] end;
 normal_sign:=case when o.obligation_type in ('PAYABLE','CUSTOMER_ADVANCE') then -1 else 1 end;
 if roots is null then raise exception 'REPORTING_OBLIGATION_SOURCE_REQUIRED';end if;
 select lines into legs from private.financial_event_posting_resolutions where organization_id=p_org and event_id=o.event_id::text;
 select value into ev from jsonb_array_elements(private.financial_reporting_events(p_org,o.event_date,o.event_date)) where value->>'id'=o.event_id::text;
 if legs is null or ev is null or ev->>'reversesEventId' is not null
 or jsonb_array_length(legs)=0 or jsonb_array_length(legs) is distinct from jsonb_array_length(ev->'lines')
 or (select count(distinct value->>'lineId') from jsonb_array_elements(legs))<>jsonb_array_length(legs) then
 raise exception 'REPORTING_OBLIGATION_SOURCE_REQUIRED';end if;
 for r in select value from jsonb_array_elements(legs) loop
  select value into l from jsonb_array_elements(ev->'lines') where value->>'id'=r->>'lineId';
  if l is null or l->>'classificationId' is distinct from r->>'classificationId'
   or (l->>'recognitionSign')::int is distinct from 1 or (l->>'baseAmount')::numeric is null or (l->>'baseAmount')::numeric<=0 then
   raise exception 'REPORTING_OBLIGATION_SOURCE_REQUIRED';end if;
  for leg in select * from (values(r->>'debitAccountId',1),(r->>'creditAccountId',-1)) v(code,sign) loop
   select c.code into candidate from public.financial_chart_custom_accounts c where c.organization_id=p_org and c.code=leg.code
    and c.reporting_code=any(roots) and c.is_active and c.is_postable
    and not exists(select 1 from public.financial_chart_custom_accounts child where child.organization_id=p_org and child.parent_code=c.code);
   if candidate is not null then
    if account_code is not null and candidate<>account_code then raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';end if;
    account_code:=candidate;total:=total+(l->>'baseAmount')::numeric*leg.sign*normal_sign;
   end if;
  end loop;
 end loop;
 select sum(settleable_base_amount) into expected from public.financial_event_obligations
 where organization_id=p_org and event_id=o.event_id and obligation_type=o.obligation_type;
 if account_code is null or expected is null or total<=0 or total<>expected then raise exception 'REPORTING_OBLIGATION_SOURCE_REQUIRED';end if;
 return account_code;
end $$;
revoke all on function private.financial_original_obligation_account(uuid,uuid) from public,anon,authenticated;

create function private.financial_advance_application_rules(p_org uuid,p_event jsonb,p_rules jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare allocation record;advance_code text;invoice_code text;cls text;rules jsonb;
begin
 if p_event->>'sourceModule' is distinct from 'ADVANCE_WORKSPACE' or p_event->>'eventType' is distinct from 'ADJUSTMENT'
 or p_event->>'reversesEventId' is not null then return p_rules;end if;
 if (select count(*) from public.financial_event_obligation_allocations where organization_id=p_org and application_event_id=(p_event->>'id')::uuid)<>1 then
 raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';end if;
 select a.*,adv.obligation_type advance_side,ob.obligation_type invoice_side into allocation
 from public.financial_event_obligation_allocations a
 join public.financial_event_obligations adv on adv.id=a.source_advance_obligation_id and adv.organization_id=a.organization_id
 join public.financial_event_obligations ob on ob.id=a.obligation_id and ob.organization_id=a.organization_id
 where a.organization_id=p_org and a.application_event_id=(p_event->>'id')::uuid and a.allocation_type='ADVANCE_APPLICATION';
 if not found or not ((allocation.advance_side='SUPPLIER_ADVANCE' and allocation.invoice_side='PAYABLE')
 or (allocation.advance_side='CUSTOMER_ADVANCE' and allocation.invoice_side='RECEIVABLE'))
 or jsonb_array_length(p_event->'lines') is distinct from 1
 or p_event->'lines'->0->>'cashDirection' is distinct from 'NON_CASH'
 or (p_event->'lines'->0->>'recognitionSign')::int is distinct from 1
 or allocation.base_amount is distinct from (p_event->'lines'->0->>'baseAmount')::numeric or allocation.base_amount<=0 then
 raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';end if;
 advance_code:=private.financial_original_obligation_account(p_org,allocation.source_advance_obligation_id);
 invoice_code:=private.financial_original_obligation_account(p_org,allocation.obligation_id);
 cls:=p_event->'lines'->0->>'classificationId';
 select coalesce(jsonb_agg(value),'[]'::jsonb) into rules from jsonb_array_elements(p_rules)
 where not(value->>'sourceModule'='ADVANCE_WORKSPACE' and value->>'eventType'='ADJUSTMENT'
  and value->>'classificationId'=cls and value->>'cashDirection'='NON_CASH');
 return rules||jsonb_build_array(jsonb_build_object('sourceModule','ADVANCE_WORKSPACE','eventType','ADJUSTMENT',
 'classificationId',cls,'cashDirection','NON_CASH','detailed',true,
 'debitAccountId',case allocation.advance_side when 'SUPPLIER_ADVANCE' then invoice_code else advance_code end,
 'creditAccountId',case allocation.advance_side when 'SUPPLIER_ADVANCE' then advance_code else invoice_code end));
end $$;
revoke all on function private.financial_advance_application_rules(uuid,jsonb,jsonb) from public,anon,authenticated;

-- Only the new ACTUAL capture path; backfills and reversal snapshots stay frozen.
do $$
declare definition text;needle constant text:='private.financial_resolve_event_posting(new.organization_id,ev,pol.id,pol.rules,true)';
begin
 definition:=pg_get_functiondef('private.financial_capture_actual_posting()'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,'private.financial_resolve_event_posting(new.organization_id,ev,pol.id,private.financial_advance_application_rules(new.organization_id,ev,pol.rules),true)');
end $$;
