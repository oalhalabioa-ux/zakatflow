-- Only the unpublished electronic draft is disposable. Approved recognition,
-- receipt instructions and posted cash must never be erased with its source.
create or replace function public.delete_unissued_zatca_draft_bundle(p_einvoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_org uuid; v_status text; v_doc uuid; v_notes text; v_event uuid; v_flow uuid;
 v_event_status text;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select organization_id,status,accounting_document_id into v_org,v_status,v_doc
 from public.vat_einvoices where id=p_einvoice_id for update;
 if v_org is null then raise exception 'EINVOICE_NOT_FOUND'; end if;
 -- The deployed helper takes one argument and obtains the actor from auth.uid().
 if not public.is_organization_admin(v_org) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 if v_status<>'DRAFT' then raise exception 'EINVOICE_DELETE_ISSUED_FORBIDDEN'; end if;
 if exists(select 1 from public.vat_einvoices where preceding_invoice_id=p_einvoice_id) then
  raise exception 'EINVOICE_DELETE_REFERENCED_FORBIDDEN';
 end if;
 if v_doc is not null then
  select notes into v_notes from public.vat_documents where id=v_doc and organization_id=v_org for update;
  select event_id into v_event from public.financial_event_links
   where organization_id=v_org and target_module='vat_documents' and target_record_id=v_doc and link_type='SOURCE' limit 1;
  if v_event is not null then
   select status into v_event_status from public.financial_events where id=v_event and organization_id=v_org for update;
  end if;
  select id into v_flow from public.liquidity_flows
   where organization_id=v_org and source_module='VAT_INTEGRATION' and source_record_id=v_doc limit 1 for update;
  if exists(select 1 from public.financial_event_obligation_allocations a
    join public.financial_event_obligations o on o.id=a.obligation_id where o.event_id=v_event)
   or exists(select 1 from public.liquidity_flow_settlement_allocations where flow_id=v_flow)
   or exists(select 1 from public.liquidity_flows where id=v_flow and settled_amount>0)
   or exists(select 1 from public.financial_event_links l join public.financial_events e on e.id=l.event_id
    where l.organization_id=v_org and l.target_module='liquidity_flows' and l.target_record_id=v_flow
     and l.metadata->>'purpose'='SETTLEMENT_INSTRUCTION' and e.status not in ('CANCELLED','REVERSED')) then
   raise exception 'EINVOICE_DELETE_SETTLED_FORBIDDEN';
  end if;
  if coalesce(v_notes,'')='Created from ZATCA invoice workspace' then
   if (v_event is not null and v_event_status not in ('DRAFT','PLANNED','COMMITTED'))
    or exists(select 1 from public.financial_event_approvals where event_id=v_event)
    or exists(select 1 from public.financial_budget_event_routes where event_id=v_event) then
    raise exception 'EINVOICE_DELETE_FINANCIAL_LOCKED';
   end if;
   if exists(select 1 from public.vat_einvoices where accounting_document_id=v_doc and id<>p_einvoice_id)
    or exists(select 1 from public.vat_documents where preceding_document_id=v_doc) then
    raise exception 'EINVOICE_DELETE_REFERENCED_FORBIDDEN';
   end if;
   delete from public.vat_einvoice_lines where invoice_id=p_einvoice_id;
   delete from public.vat_einvoices where id=p_einvoice_id;
   if v_flow is not null then
    delete from public.financial_event_links where organization_id=v_org and target_module='liquidity_flows' and target_record_id=v_flow;
    delete from public.liquidity_flows where id=v_flow and organization_id=v_org;
   end if;
   if v_event is not null then
    delete from public.financial_vat_source_bindings where event_id=v_event and organization_id=v_org;
    delete from public.financial_event_status_history where event_id=v_event and organization_id=v_org;
    delete from public.financial_event_links where event_id=v_event and organization_id=v_org;
    delete from public.financial_event_obligations where event_id=v_event and organization_id=v_org;
    delete from public.financial_event_lines where event_id=v_event and organization_id=v_org;
    delete from public.financial_events where id=v_event and organization_id=v_org;
   end if;
   delete from public.vat_documents where id=v_doc and organization_id=v_org;
   return jsonb_build_object('deleted',true,'accounting_document_deleted',true);
  end if;
 end if;
 -- Imported accounting documents are retained when removing their electronic draft.
 delete from public.vat_einvoice_lines where invoice_id=p_einvoice_id;
 delete from public.vat_einvoices where id=p_einvoice_id;
 return jsonb_build_object('deleted',true,'accounting_document_deleted',false);
end $fn$;
revoke all on function public.delete_unissued_zatca_draft_bundle(uuid) from public,anon;
grant execute on function public.delete_unissued_zatca_draft_bundle(uuid) to authenticated;
