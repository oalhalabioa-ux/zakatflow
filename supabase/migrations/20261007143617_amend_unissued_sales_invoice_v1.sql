
create or replace function public.amend_unissued_sales_invoice(
 p_document_id uuid,p_document_number text,p_transaction_date date,p_due_date date,p_contact_id uuid,
 p_counterparty_name text,p_counterparty_tax_number text,p_supply_type text,p_net numeric,p_tax_rate numeric,p_tax numeric,p_gross numeric,
 p_line_items jsonb,p_notes text
) returns uuid
language plpgsql security definer set search_path='pg_catalog','public'
as $$
declare v_org uuid; v_event uuid; v_flow uuid; v_counterparty uuid; v_revenue_class uuid; v_tax_class uuid; v_tax_line uuid; v_settled numeric;
begin
 select organization_id into v_org from public.vat_documents where id=p_document_id and document_type='SALES' and document_kind='INVOICE' for update;
 if v_org is null then raise exception 'VAT_DOCUMENT_NOT_FOUND'; end if;
 if not public.is_organization_admin(v_org) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 if exists(select 1 from public.vat_einvoices where accounting_document_id=p_document_id and status in ('ISSUED','SUBMITTED','CLEARED','REPORTED')) then raise exception 'VAT_DOCUMENT_ISSUED_LOCKED'; end if;
 select id,settled_amount into v_flow,v_settled from public.liquidity_flows where organization_id=v_org and source_module='VAT_INTEGRATION' and source_record_id=p_document_id order by created_at limit 1 for update;
 if coalesce(v_settled,0)>0 then raise exception 'VAT_DOCUMENT_SETTLED_LOCKED'; end if;
 select event_id into v_event from public.financial_event_links where organization_id=v_org and link_type='SOURCE' and target_module='vat_documents' and target_record_id=p_document_id limit 1;
 if v_event is null then raise exception 'VAT_FINANCIAL_EVENT_REQUIRED'; end if;
 select m.counterparty_id into v_counterparty from public.financial_vat_counterparty_map m where m.organization_id=v_org and m.vat_contact_id=p_contact_id;
 if v_counterparty is null then raise exception 'VAT_COUNTERPARTY_MAPPING_REQUIRED'; end if;
 select id into v_revenue_class from public.financial_classifications where organization_id=v_org and classification_type='REVENUE' and active=true limit 1;
 select id into v_tax_class from public.financial_classifications where organization_id=v_org and classification_type='TAX' and active=true limit 1;
 if v_revenue_class is null or v_tax_class is null then raise exception 'VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED'; end if;

 update public.vat_documents set document_number=p_document_number,transaction_date=p_transaction_date,due_date=p_due_date,
  counterparty_contact_id=p_contact_id,counterparty_name=p_counterparty_name,counterparty_tax_number=nullif(p_counterparty_tax_number,''),
  supply_type=p_supply_type,net_amount=p_net,tax_rate=p_tax_rate,tax_amount=p_tax,gross_amount=p_gross,line_items=p_line_items,
  source_net_amount=p_net,source_tax_amount=p_tax,source_gross_amount=p_gross,notes=p_notes
 where id=p_document_id;

 update public.financial_events set counterparty_id=v_counterparty,event_date=p_transaction_date,due_date=p_due_date,
  description='Sales invoice '||p_document_number,updated_at=now() where id=v_event and status in ('DRAFT','PLANNED','COMMITTED');
 if not found then raise exception 'VAT_FINANCIAL_EVENT_LOCKED'; end if;

 update public.financial_event_lines set amount=p_net,base_amount=p_net,description='Sales revenue recognition'
 where event_id=v_event and classification_id=v_revenue_class;
 select id into v_tax_line from public.financial_event_lines where event_id=v_event and classification_id=v_tax_class limit 1;
 if p_tax>0 then
   if v_tax_line is null then
     insert into public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,cost_center_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment,vat_rate,vat_amount)
     select v_event,v_org,coalesce((select max(line_number) from public.financial_event_lines where event_id=v_event),0)+1,'Output VAT recognition',v_tax_class,null,p_tax,base_currency,1,p_tax,'NON_CASH','OUT_OF_SCOPE',0,0 from public.financial_events where id=v_event;
   else update public.financial_event_lines set amount=p_tax,base_amount=p_tax,description='Output VAT recognition' where id=v_tax_line; end if;
 elsif v_tax_line is not null then delete from public.financial_event_lines where id=v_tax_line; end if;

 update public.financial_event_obligations set settleable_amount=p_gross,settleable_base_amount=p_gross where event_id=v_event and obligation_type='RECEIVABLE';
 update public.liquidity_flows set due_date=p_due_date,amount=p_gross,base_amount=p_gross,counterparty=p_counterparty_name,counterparty_id=v_counterparty,
  reference=p_document_number,title='Invoice receivable · '||p_document_number,updated_at=now()
 where id=v_flow;
 return p_document_id;
end $$;
revoke all on function public.amend_unissued_sales_invoice(uuid,text,date,date,uuid,text,text,text,numeric,numeric,numeric,numeric,jsonb,text) from public;
grant execute on function public.amend_unissued_sales_invoice(uuid,text,date,date,uuid,text,text,text,numeric,numeric,numeric,numeric,jsonb,text) to authenticated;
