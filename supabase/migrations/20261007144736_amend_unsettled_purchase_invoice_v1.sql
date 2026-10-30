
create or replace function public.amend_unsettled_purchase_invoice(p_document_id uuid,p_document_number text,p_transaction_date date,p_due_date date,p_contact_id uuid,p_counterparty_name text,p_counterparty_tax_number text,p_supply_type text,p_net numeric,p_tax_rate numeric,p_tax numeric,p_gross numeric,p_recoverable_percent numeric,p_line_items jsonb,p_notes text)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_org uuid; v_event uuid; v_counterparty uuid; v_opex uuid; v_tax_class uuid; v_flow uuid; v_settled numeric:=0;
begin
 select organization_id into v_org from public.vat_documents where id=p_document_id and document_type='PURCHASE' and document_kind='INVOICE' and asset_transaction_id is null for update;
 if v_org is null then raise exception 'VAT_PURCHASE_EDIT_NOT_ALLOWED'; end if;
 if not public.is_organization_admin(v_org) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 select event_id into v_event from public.financial_event_links where organization_id=v_org and link_type='SOURCE' and target_module='vat_documents' and target_record_id=p_document_id limit 1;
 if v_event is null then raise exception 'VAT_FINANCIAL_EVENT_REQUIRED'; end if;
 select coalesce(settled_amount,0),id into v_settled,v_flow from public.liquidity_flows where organization_id=v_org and source_record_id=p_document_id order by created_at limit 1 for update;
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
 if v_flow is not null then update public.liquidity_flows set due_date=p_due_date,amount=p_gross,base_amount=p_gross,counterparty=p_counterparty_name,counterparty_id=v_counterparty,reference=p_document_number,title='Invoice payable · '||p_document_number,updated_at=now() where id=v_flow; end if;
 return p_document_id;
end $$;
revoke all on function public.amend_unsettled_purchase_invoice(uuid,text,date,date,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,text) from public;
grant execute on function public.amend_unsettled_purchase_invoice(uuid,text,date,date,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,text) to authenticated;
