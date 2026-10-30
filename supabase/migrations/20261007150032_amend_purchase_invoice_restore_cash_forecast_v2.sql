
create or replace function public.amend_unsettled_purchase_invoice(p_document_id uuid,p_document_number text,p_transaction_date date,p_due_date date,p_contact_id uuid,p_counterparty_name text,p_counterparty_tax_number text,p_supply_type text,p_net numeric,p_tax_rate numeric,p_tax numeric,p_gross numeric,p_recoverable_percent numeric,p_line_items jsonb,p_notes text)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_org uuid; v_event uuid; v_counterparty uuid; v_opex uuid; v_tax_class uuid; v_flow uuid; v_settled numeric:=0; v_currency text;
begin
 select organization_id,currency into v_org,v_currency from public.vat_documents where id=p_document_id and document_type='PURCHASE' and document_kind='INVOICE' and asset_transaction_id is null for update;
 if v_org is null then raise exception 'VAT_PURCHASE_EDIT_NOT_ALLOWED'; end if;
 if not public.is_organization_admin(v_org) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 select event_id into v_event from public.financial_event_links where organization_id=v_org and link_type='SOURCE' and target_module='vat_documents' and target_record_id=p_document_id limit 1;
 if v_event is null then raise exception 'VAT_FINANCIAL_EVENT_REQUIRED'; end if;
 select coalesce(settled_amount,0),id into v_settled,v_flow from public.liquidity_flows where organization_id=v_org and source_module='VAT_INTEGRATION' and source_record_id=p_document_id order by created_at limit 1 for update;
 if v_settled>0 then raise exception 'VAT_DOCUMENT_SETTLED_LOCKED'; end if;
 if exists(select 1 from public.financial_event_obligation_allocations a join public.financial_event_obligations o on o.id=a.obligation_id where o.event_id=v_event) then raise exception 'VAT_DOCUMENT_SETTLED_LOCKED'; end if;
 select counterparty_id into v_counterparty from public.financial_vat_counterparty_map where organization_id=v_org and vat_contact_id=p_contact_id;
 if v_counterparty is null then raise exception 'VAT_COUNTERPARTY_MAPPING_REQUIRED'; end if;
 select id into v_opex from public.financial_classifications where organization_id=v_org and classification_type='OPEX' and active=true limit 1;
 select id into v_tax_class from public.financial_classifications where organization_id=v_org and classification_type='TAX' and active=true limit 1;
 if v_opex is null or v_tax_class is null then raise exception 'VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED'; end if;
 update public.vat_documents set document_number=p_document_number,transaction_date=p_transaction_date,due_date=p_due_date,counterparty_contact_id=p_contact_id,counterparty_name=p_counterparty_name,counterparty_tax_number=nullif(p_counterparty_tax_number,''),supply_type=p_supply_type,net_amount=p_net,tax_rate=p_tax_rate,tax_amount=p_tax,gross_amount=p_gross,recoverable_percent=p_recoverable_percent,line_items=p_line_items,source_net_amount=p_net,source_tax_amount=p_tax,source_gross_amount=p_gross,notes=p_notes where id=p_document_id;
 update public.financial_events set counterparty_id=v_counterparty,event_date=p_transaction_date,due_date=p_due_date,description='Purchase invoice '||p_document_number,updated_at=now() where id=v_event and status in ('DRAFT','PLANNED','COMMITTED');
 if not found then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;
 update public.financial_event_lines set amount=p_net,base_amount=p_net where event_id=v_event and classification_id=v_opex;
 update public.financial_event_lines set amount=p_tax,base_amount=p_tax where event_id=v_event and classification_id=v_tax_class;
 update public.financial_event_obligations set settleable_amount=p_gross,settleable_base_amount=p_gross where event_id=v_event and obligation_type='PAYABLE';
 if v_flow is null then
   insert into public.liquidity_flows(organization_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,notes,source_module,source_record_id,source_event_key)
   values(v_org,'OUTFLOW','OPERATING','Invoice payable · '||p_document_number,p_counterparty_name,v_counterparty,p_due_date,p_gross,v_currency,p_gross,'EXPECTED','INVOICE',p_document_number,'Generated from invoice due date; settlement clears the linked Financial Core payable.','VAT_INTEGRATION',p_document_id,'vat_documents:'||p_document_id||':cash-forecast')
   returning id into v_flow;
   insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata)
   values(v_org,v_event,'CASH_FLOW','liquidity_flows',v_flow,jsonb_build_object('purpose','INVOICE_DUE_FORECAST','due_date',p_due_date,'source_document_id',p_document_id));
 else
   update public.liquidity_flows set due_date=p_due_date,amount=p_gross,base_amount=p_gross,counterparty=p_counterparty_name,counterparty_id=v_counterparty,reference=p_document_number,title='Invoice payable · '||p_document_number,updated_at=now() where id=v_flow;
 end if;
 return p_document_id;
end $$;
