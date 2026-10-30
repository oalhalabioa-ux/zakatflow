
create or replace function public.delete_unissued_zatca_draft_bundle(p_einvoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid; v_status text; v_doc uuid; v_notes text; v_event uuid; v_flow uuid;
begin
  select organization_id,status,accounting_document_id into v_org,v_status,v_doc
  from public.vat_einvoices where id=p_einvoice_id for update;
  if v_org is null then raise exception 'EINVOICE_NOT_FOUND'; end if;
  if not public.is_organization_admin(v_org,auth.uid()) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  if v_status <> 'DRAFT' then raise exception 'EINVOICE_DELETE_ISSUED_FORBIDDEN'; end if;

  if v_doc is not null then
    select notes into v_notes from public.vat_documents where id=v_doc and organization_id=v_org;
    if coalesce(v_notes,'') <> 'Created from ZATCA invoice workspace' then
      -- Existing accounting invoices remain the financial source of truth; only remove the ZATCA draft.
      delete from public.vat_einvoice_lines where invoice_id=p_einvoice_id;
      delete from public.vat_einvoices where id=p_einvoice_id;
      return jsonb_build_object('deleted',true,'accounting_document_deleted',false);
    end if;

    select event_id into v_event from public.financial_event_links
      where organization_id=v_org and target_module='vat_documents' and target_record_id=v_doc and link_type='SOURCE'
      limit 1;
    if v_event is not null and exists (
      select 1 from public.financial_event_obligation_allocations a
      join public.financial_event_obligations o on o.id=a.obligation_id
      where o.event_id=v_event
    ) then raise exception 'EINVOICE_DELETE_SETTLED_FORBIDDEN'; end if;

    select id into v_flow from public.liquidity_flows
      where organization_id=v_org and source_module='VAT_INTEGRATION' and source_record_id=v_doc limit 1;
    if v_flow is not null and exists(select 1 from public.liquidity_settlements where flow_id=v_flow) then
      raise exception 'EINVOICE_DELETE_SETTLED_FORBIDDEN';
    end if;

    delete from public.vat_einvoice_lines where invoice_id=p_einvoice_id;
    delete from public.vat_einvoices where id=p_einvoice_id;
    if v_flow is not null then
      delete from public.financial_event_links where target_module='liquidity_flows' and target_record_id=v_flow;
      delete from public.liquidity_flows where id=v_flow;
    end if;
    if v_event is not null then
      delete from public.financial_vat_source_bindings where event_id=v_event;
      delete from public.financial_event_status_history where event_id=v_event;
      delete from public.financial_event_links where event_id=v_event;
      delete from public.financial_event_obligations where event_id=v_event;
      delete from public.financial_event_lines where event_id=v_event;
      delete from public.financial_events where id=v_event;
    end if;
    delete from public.vat_documents where id=v_doc;
    return jsonb_build_object('deleted',true,'accounting_document_deleted',true);
  end if;

  delete from public.vat_einvoice_lines where invoice_id=p_einvoice_id;
  delete from public.vat_einvoices where id=p_einvoice_id;
  return jsonb_build_object('deleted',true,'accounting_document_deleted',false);
end $$;
revoke all on function public.delete_unissued_zatca_draft_bundle(uuid) from public;
grant execute on function public.delete_unissued_zatca_draft_bundle(uuid) to authenticated;
