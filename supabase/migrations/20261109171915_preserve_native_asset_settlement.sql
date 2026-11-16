-- New asset settlements clear the original recorded obligation, including
-- multi-line gain/loss and VAT, rather than the current generic payable rule.
-- Never recalculate historical payment snapshots or guess a split allocation.
create function private.financial_resolve_native_asset_payment(p_org uuid,p_event jsonb,p_lines jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 origin record;
 source_event jsonb;
 resolved_line jsonb;
 source_line jsonb;
 leg record;
 account_code text;
 candidate text;
 obligation_net numeric:=0;
 direction text;
 amount numeric;
begin
 if p_event->>'eventType' is distinct from 'SETTLEMENT'
  or coalesce(p_event->>'id','') !~ '^[0-9a-f-]{36}$'
  or p_event->>'reversesEventId' is not null then return p_lines;end if;
 select e.id,e.event_date,e.source_module,e.event_type,e.source_record_id,e.source_event_key,
  o.obligation_type,o.settleable_base_amount,a.base_amount allocation_amount,r.lines
 into origin
 from public.financial_event_obligation_allocations a
 join public.financial_event_obligations o on o.id=a.obligation_id and o.organization_id=a.organization_id
 join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id
 left join private.financial_event_posting_resolutions r on r.organization_id=e.organization_id and r.event_id=e.id::text
 where a.organization_id=p_org and a.application_event_id=(p_event->>'id')::uuid
  and a.allocation_type='PAYMENT'
  and ((e.source_module='ASSET_LIFECYCLE' and e.event_type='ADJUSTMENT' and o.obligation_type='RECEIVABLE')
   or (e.source_module='ASSETS_INTEGRATION' and e.event_type='ASSET_PURCHASE' and o.obligation_type='PAYABLE'))
 limit 1;
 if not found then return p_lines;end if;
 direction:=case origin.obligation_type when 'RECEIVABLE' then 'INFLOW' else 'OUTFLOW' end;
 if (select count(*) from public.financial_event_obligation_allocations
   where organization_id=p_org and application_event_id=(p_event->>'id')::uuid)<>1
  or jsonb_array_length(p_lines) is distinct from 1
  or jsonb_array_length(p_event->'lines') is distinct from 1
  or p_lines->0->>'cashDirection' is distinct from direction
  or p_event->'lines'->0->>'cashDirection' is distinct from direction
  or (p_event->'lines'->0->>'recognitionSign')::int is distinct from 1
  or origin.allocation_amount is distinct from (p_event->'lines'->0->>'baseAmount')::numeric
  or origin.allocation_amount<=0 then
  raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';
 end if;
 if origin.lines is null or jsonb_array_length(origin.lines)=0 then
  raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';
 end if;
 -- Only native acquisitions with a known capital/investment classification
 -- receive investing cash activity. Generic ASSET inventory is not guessed.
 if origin.source_module='ASSETS_INTEGRATION' and not exists (
  select 1 from public.financial_event_lines l join public.financial_classifications c
   on c.id=l.classification_id and c.organization_id=l.organization_id
  where l.organization_id=p_org and l.event_id=origin.id and c.classification_type in ('CAPEX','INVESTMENT')
 ) then raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';end if;
 select ev into source_event from jsonb_array_elements(
  private.financial_reporting_events(p_org,origin.event_date,origin.event_date)) ev
 where ev->>'id'=origin.id::text;
 if source_event is null or source_event->>'reversesEventId' is not null
  or jsonb_array_length(source_event->'lines') is distinct from jsonb_array_length(origin.lines)
  or (select count(distinct value->>'lineId') from jsonb_array_elements(origin.lines))<>jsonb_array_length(origin.lines) then
  raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';
 end if;
 for resolved_line in select value from jsonb_array_elements(origin.lines) loop
  select l into source_line from jsonb_array_elements(source_event->'lines') l
   where l->>'id'=resolved_line->>'lineId';
  if source_line is null or source_line->>'classificationId' is distinct from resolved_line->>'classificationId'
   or source_line->>'cashDirection' is distinct from 'NON_CASH'
   or resolved_line->>'cashDirection' is distinct from 'NON_CASH'
   or (source_line->>'recognitionSign')::int is distinct from 1 then
   raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';
  end if;
  if origin.source_module='ASSET_LIFECYCLE' and split_part(source_line->>'classificationId',':',2) not in
   ('SALE_LOSS','SALE_GAIN','SALE_NET_BOOK_VALUE','OUTPUT_VAT','ACCUMULATED_DEPRECIATION_RELEASE',
    'INVESTMENT_SALE_LOSS','INVESTMENT_SALE_GAIN','INVESTMENT_SALE_NET_BOOK_VALUE','INVESTMENT_OUTPUT_VAT') then
   raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';end if;
  amount:=(source_line->>'baseAmount')::numeric;
  if amount is null or amount<=0 then raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';end if;
  for leg in select * from (values
   (resolved_line->>'debitAccountId',1),(resolved_line->>'creditAccountId',-1)) v(code,sign) loop
   select c.code into candidate from public.financial_chart_custom_accounts c
   where c.organization_id=p_org and c.code=leg.code
    and c.reporting_code=case origin.obligation_type when 'RECEIVABLE' then '1100' else '2100' end
    and c.is_active and c.is_postable
    and not exists(select 1 from public.financial_chart_custom_accounts child
     where child.organization_id=p_org and child.parent_code=c.code);
   if candidate is not null then
    if account_code is not null and account_code<>candidate then
     raise exception 'REPORTING_PAYMENT_ALLOCATION_REQUIRED';end if;
    account_code:=candidate;
    obligation_net:=obligation_net+amount*leg.sign;
   end if;
  end loop;
 end loop;
 if origin.obligation_type='PAYABLE' then obligation_net:=-obligation_net;end if;
 if account_code is null or origin.settleable_base_amount is null or obligation_net<=0
  or obligation_net<>origin.settleable_base_amount then
  raise exception 'REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED';
 end if;
 return jsonb_build_array(p_lines->0||jsonb_build_object(
  case origin.obligation_type when 'RECEIVABLE' then 'creditAccountId' else 'debitAccountId' end,
  account_code,'cashActivity','INVESTING'));
end;
$$;
revoke all on function private.financial_resolve_native_asset_payment(uuid,jsonb,jsonb) from public,anon,authenticated;

do $$
declare definition text;
 needle constant text:='private.financial_resolve_manual_payment(new.organization_id,ev,private.financial_resolve_event_posting(new.organization_id,ev,pol.id,pol.rules,true))';
begin
 definition:=pg_get_functiondef('private.financial_capture_actual_posting()'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'REPORTING_ACTUAL_POSTING_SIGNATURE_CHANGED';end if;
 execute replace(definition,needle,'private.financial_resolve_native_asset_payment(new.organization_id,ev,'||needle||')');
end;
$$;
