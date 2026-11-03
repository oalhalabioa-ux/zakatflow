create or replace function private.financial_reporting_events(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from public.financial_events e join public.financial_event_lines l on l.event_id=e.id and l.organization_id=p_org
   where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
   and (l.vat_amount<>0 or l.base_amount<=0 or l.base_amount<>round(l.base_amount,4)
    or coalesce(l.metadata->>'recognition_sign','1') not in('1','-1')))
 then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 with source as (
  select e.*,orig.id original_id,orig.event_date original_date,
   coalesce(orig.event_type,e.event_type) posting_type,coalesce(orig.source_module,e.source_module) posting_module
  from public.financial_events e left join public.financial_event_links rl on rl.event_id=e.id and rl.organization_id=p_org and rl.link_type='REVERSAL_OF'
   left join public.financial_events orig on orig.id=rl.related_event_id and orig.organization_id=p_org
  where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
 ), line_parts as (
  select l.*,coalesce(l.metadata->>'source_role','BASE') source_role,
   case when l.metadata->>'source_role'='INPUT_VAT' then coalesce(nullif(l.metadata->>'recoverable_percent','')::numeric,l.recoverable_percent,100) else 100 end recovery
  from public.financial_event_lines l join source e on e.id=l.event_id where l.organization_id=p_org
 ), normalized as (
  select l.*,v.part,v.amount part_amount from line_parts l cross join lateral (
    select case when l.source_role='INPUT_VAT' then 'INPUT_VAT_RECOVERABLE' else l.source_role end part,
      round(l.base_amount*l.recovery/100,4) amount
    union all select 'INPUT_VAT_NONRECOVERABLE',l.base_amount-round(l.base_amount*l.recovery/100,4) where l.source_role='INPUT_VAT' and l.recovery<100
  ) v where v.amount>0
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'organizationId',e.organization_id,'currency',e.base_currency,
  'date',e.event_date,'eventType',e.posting_type,'sourceModule',e.posting_module,'sourceKey',e.source_event_key,
  'status',e.status,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id::text||':'||l.part,
    'classificationId',l.classification_id::text||':'||l.part,'baseAmount',l.part_amount::numeric(24,4)::text,
    'cashDirection',l.cash_direction,'recognitionSign',case when e.original_id is not null then -1 else coalesce((l.metadata->>'recognition_sign')::int,1) end) order by l.line_number,l.part)
    from normalized l where l.event_id=e.id),'[]'::jsonb))
    ||case when e.original_id is not null and e.original_date>=p_from then jsonb_build_object('reversesEventId',e.original_id) else '{}' end order by e.event_date,e.id),'[]'::jsonb)
 into result from source e;
 if jsonb_array_length(result)>10000 then raise exception 'REPORTING_SOURCE_TOO_LARGE';end if;
 return result||private.financial_reporting_legacy_events(p_org,p_from,p_to);
end $$;
revoke all on function private.financial_reporting_events(uuid,date,date) from public,anon,authenticated;

