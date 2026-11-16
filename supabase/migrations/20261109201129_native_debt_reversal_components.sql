-- Native reversals retain real, distinct database lines. Clearing classifications
-- remain on the cash command; reporting inherits the verified original semantics.
create function private.financial_native_reversal_original(p_org uuid,p_line uuid)
returns public.financial_event_lines language plpgsql stable set search_path='' as $$
declare l public.financial_event_lines%rowtype;o public.financial_event_lines%rowtype;target uuid;
begin
 select * into l from public.financial_event_lines where organization_id=p_org and id=p_line;
 if not (l.metadata ? 'native_reversal_version') then return null;end if;
 if l.metadata->>'native_reversal_version' is distinct from '1' then raise exception 'REPORTING_NATIVE_REVERSAL_SOURCE_INVALID';end if;
 select r.target_id into target from public.debt_operation_requests r
 join public.financial_event_links x on x.organization_id=r.organization_id and x.event_id=r.financial_event_id
 and x.link_type='REVERSAL_OF' and x.related_event_id=r.target_id
 join public.financial_events e on e.id=r.financial_event_id and e.organization_id=r.organization_id
 where r.organization_id=p_org and r.financial_event_id=l.event_id and r.kind='REVERSE'
 and e.source_module='DEBT_OPERATIONS' and e.event_type='REVERSAL';
 select * into o from public.financial_event_lines where organization_id=p_org and event_id=target
 and id::text=l.metadata->>'reversal_of_line_id';
 if o.id is null or o.id=l.id or o.line_number<>l.line_number
 or row(o.amount,o.base_amount,o.currency,o.exchange_rate) is distinct from row(l.amount,l.base_amount,l.currency,l.exchange_rate)
 or l.cash_direction is distinct from (case o.cash_direction when 'INFLOW' then 'OUTFLOW' when 'OUTFLOW' then 'INFLOW' else 'NON_CASH' end)
 or l.recoverable_percent is distinct from o.recoverable_percent
 or l.metadata is distinct from (o.metadata||jsonb_build_object('native_reversal_version',1,'reversal_of_line_id',o.id))
 or (select count(*) from public.financial_event_lines where organization_id=p_org and event_id=l.event_id)
 <> (select count(*) from public.financial_event_lines where organization_id=p_org and event_id=target)
 then raise exception 'REPORTING_NATIVE_REVERSAL_SOURCE_INVALID';end if;
 return o;
end $$;
revoke all on function private.financial_native_reversal_original(uuid,uuid) from public,anon,authenticated;

do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('private.prepare_debt_operation(jsonb)'::regprocedure);
 needle:='''lines'',jsonb_build_array(jsonb_build_object(';
 if strpos(definition,needle)=0 then raise exception 'NATIVE_REVERSAL_PREPARE_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$n$'lines',case when kind='REVERSE' then
 (select jsonb_agg(jsonb_build_object('line_number',original.line_number,'classification_id',cls,
 'description',p->>'reason','amount',original.amount,'currency',original.currency,'exchange_rate',original.exchange_rate,
 'base_amount',original.base_amount,'cash_direction',case original.cash_direction when 'INFLOW' then 'OUTFLOW' when 'OUTFLOW' then 'INFLOW' else 'NON_CASH' end,
 'vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0,'recoverable_percent',original.recoverable_percent,
 'metadata',original.metadata||jsonb_build_object('native_reversal_version',1,'reversal_of_line_id',original.id)) order by original.line_number)
 from public.financial_event_lines original where original.organization_id=org and original.event_id=e.id)
 else jsonb_build_array(jsonb_build_object($n$);
 needle:='''vat_rate'',0,''vat_amount'',0)),''obligations''';
 if strpos(definition,needle)=0 then raise exception 'NATIVE_REVERSAL_LINES_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'''vat_rate'',0,''vat_amount'',0)) end,''obligations''');
 execute definition;
 definition:=pg_get_functiondef('private.post_debt_operation(uuid)'::regprocedure);
 needle:='''financial_core.post'',l.base_amount,e.base_currency';
 if strpos(definition,needle)=0 then raise exception 'NATIVE_REVERSAL_PERMISSION_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'''financial_core.post'',(select sum(base_amount) from public.financial_event_lines where organization_id=r.organization_id and event_id=e.id),e.base_currency');
 execute definition;
end $$;

do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('private.financial_reporting_events(uuid,date,date)'::regprocedure);
 needle:='select l.*,coalesce(l.metadata';
 if strpos(definition,needle)=0 then raise exception 'NATIVE_REVERSAL_NORMALIZER_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,$n$select l.*,
 coalesce(native.classification_id,l.classification_id) reporting_classification_id,
 coalesce(native.cash_direction,l.cash_direction) reporting_cash_direction,
 native.id original_line_id,coalesce(l.metadata$n$);
 needle:='where l.organization_id=p_org' ;
 -- Only the line-parts CTE has this exact original-line join suffix.
 definition:=replace(definition,'and ol.line_number=l.line_number where l.organization_id=p_org',
 'and ol.line_number=l.line_number left join lateral private.financial_native_reversal_original(p_org,l.id) native on true where l.organization_id=p_org');
 definition:=replace(definition,'''classificationId'',l.classification_id::text||'':''||l.part',
 '''originalLineId'',case when l.original_line_id is not null then l.original_line_id::text||'':''||l.part end,''classificationId'',l.reporting_classification_id::text||'':''||l.part');
 definition:=replace(definition,'''cashDirection'',l.cash_direction,''recognitionSign''','''cashDirection'',l.reporting_cash_direction,''recognitionSign''');
 execute definition;
 definition:=pg_get_functiondef('private.financial_resolve_event_posting(uuid,jsonb,uuid,jsonb,boolean)'::regprocedure);
 needle:='where x @> signature limit 1';
 if strpos(definition,needle)=0 then raise exception 'NATIVE_REVERSAL_RESOLVER_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,needle,'where x @> signature and (l->>''originalLineId'' is null or x->>''lineId''=l->>''originalLineId'') limit 1');
 execute definition;
end $$;
