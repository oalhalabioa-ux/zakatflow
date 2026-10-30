-- Cash posting updates flow evidence before the settlement reaches ACTUAL.
-- Validate the projection total against adjusted obligations throughout that transaction.
-- Validate adjusted invoice forecasts against live obligations, not original gross.
create or replace function private.vat_note_forecast_valid(p_flow public.liquidity_flows)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; eid uuid; outstanding numeric; expected_direction text;
begin
 select * into d from public.vat_documents where id=p_flow.source_record_id and organization_id=p_flow.organization_id;
 if d.id is null or p_flow.source_module<>'VAT_INTEGRATION' or p_flow.source_event_key is distinct from 'vat_documents:'||d.id||':cash-forecast' or p_flow.currency<>d.currency or p_flow.base_amount<>p_flow.amount or p_flow.settled_amount<0 or p_flow.settled_amount>p_flow.amount then return false; end if;
 select event_id into eid from public.financial_event_links where organization_id=d.organization_id and link_type='SOURCE' and target_module='vat_documents' and target_record_id=d.id;
 if eid is null then return false; end if;
 select coalesce(sum(b.adjusted_settleable_base_amount),0) into outstanding from public.financial_event_obligation_balances b where b.event_id=eid and b.organization_id=d.organization_id and b.obligation_type in('RECEIVABLE','PAYABLE');
 if d.document_kind='CREDIT_NOTE' then expected_direction:=case when d.document_type='SALES' then 'OUTFLOW' else 'INFLOW' end;
 else expected_direction:=case when d.document_type='SALES' then 'INFLOW' else 'OUTFLOW' end; end if;
 return p_flow.direction=expected_direction and p_flow.amount=greatest(p_flow.settled_amount,outstanding)
  and exists(select 1 from public.financial_events e where e.id=eid and e.organization_id=d.organization_id and e.status='ACTUAL' and e.counterparty_id is not distinct from p_flow.counterparty_id);
end $$;
revoke all on function private.vat_note_forecast_valid(public.liquidity_flows) from public,anon,authenticated;

