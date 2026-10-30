do $guard$ declare definition text; begin
 if to_regprocedure('private.phase2c_links_integrity()') is not null then
  definition:=pg_get_functiondef('private.phase2c_links_integrity()'::regprocedure);
  definition:=replace(definition,'if found then', $branch$if found and tg_op='INSERT' and b.canonical_payload->>'adapter'='LINKED_NOTE_V1' then
   if new.link_type='CASH_FLOW' and new.target_module='liquidity_flows'
    and exists(select 1 from public.liquidity_flows note_flow where note_flow.id=new.target_record_id and note_flow.organization_id=b.organization_id and note_flow.source_module='VAT_INTEGRATION' and note_flow.source_record_id=b.source_record_id and private.vat_note_forecast_valid(note_flow))
    and not exists(select 1 from public.financial_event_links note_link where note_link.event_id=eid and note_link.link_type='CASH_FLOW') then return new; end if;
  end if;
  if found then$branch$);
  execute definition;
 end if;
end $guard$;
