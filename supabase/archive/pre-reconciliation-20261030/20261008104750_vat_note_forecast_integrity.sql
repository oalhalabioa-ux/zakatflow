-- Validate adjusted invoice forecasts against live obligations, not original gross.
create or replace function private.vat_note_forecast_valid(p_flow public.liquidity_flows)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; eid uuid; outstanding numeric; expected_direction text;
begin
 select * into d from public.vat_documents where id=p_flow.source_record_id and organization_id=p_flow.organization_id;
 if d.id is null or p_flow.source_module<>'VAT_INTEGRATION' or p_flow.source_event_key is distinct from 'vat_documents:'||d.id||':cash-forecast' or p_flow.currency<>d.currency or p_flow.base_amount<>p_flow.amount or p_flow.settled_amount<0 or p_flow.settled_amount>p_flow.amount then return false; end if;
 select event_id into eid from public.financial_event_links where organization_id=d.organization_id and link_type='SOURCE' and target_module='vat_documents' and target_record_id=d.id;
 if eid is null then return false; end if;
 select coalesce(sum(b.outstanding_base_amount),0) into outstanding from public.financial_event_obligation_balances b where b.event_id=eid and b.organization_id=d.organization_id and b.obligation_type in('RECEIVABLE','PAYABLE');
 if d.document_kind='CREDIT_NOTE' then expected_direction:=case when d.document_type='SALES' then 'OUTFLOW' else 'INFLOW' end;
 else expected_direction:=case when d.document_type='SALES' then 'INFLOW' else 'OUTFLOW' end; end if;
 return p_flow.direction=expected_direction and p_flow.amount=p_flow.settled_amount+outstanding
  and exists(select 1 from public.financial_events e where e.id=eid and e.organization_id=d.organization_id and e.status='ACTUAL' and e.counterparty_id is not distinct from p_flow.counterparty_id);
end $$;
revoke all on function private.vat_note_forecast_valid(public.liquidity_flows) from public,anon,authenticated;

do $guard$ declare definition text; begin
 if to_regprocedure('private.phase2c_expected_integrity()') is not null then
  definition:=pg_get_functiondef('private.phase2c_expected_integrity()'::regprocedure);
  definition:=replace(definition,E'begin\n', $branch$begin
  if tg_op<>'DELETE' and new.source_module='VAT_INTEGRATION' and (
   exists(select 1 from public.financial_vat_source_bindings b where b.organization_id=new.organization_id and b.source_record_id=new.source_record_id and b.canonical_payload->>'adapter'='LINKED_NOTE_V1')
   or exists(select 1 from public.vat_documents n join public.financial_vat_source_bindings b on b.source_record_id=n.id and b.organization_id=n.organization_id join public.financial_events e on e.id=b.event_id where n.preceding_document_id=new.source_record_id and n.organization_id=new.organization_id and e.status='ACTUAL' and b.canonical_payload->>'adapter'='LINKED_NOTE_V1')) then
   if not private.vat_note_forecast_valid(new) then raise exception 'VAT_NOTE_FORECAST_PARITY_REQUIRED'; end if;
   return new;
  end if;
$branch$);
  execute definition;
 end if;
end $guard$;
