
create or replace function public.prevent_unlinked_zatca_sales_number_collision()
returns trigger language plpgsql set search_path='pg_catalog','public' as $$
begin
  if new.document_type = 'INVOICE' and new.accounting_document_id is null
     and exists (
       select 1 from public.vat_documents d
       where d.organization_id = new.organization_id
         and d.document_type = 'SALES'
         and d.document_kind = 'INVOICE'
         and d.document_number = new.invoice_number
     ) then
    raise exception 'ACCOUNTING_INVOICE_NUMBER_EXISTS' using errcode='23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_prevent_unlinked_zatca_sales_number_collision on public.vat_einvoices;
create trigger trg_prevent_unlinked_zatca_sales_number_collision
before insert or update of organization_id,invoice_number,document_type,accounting_document_id
on public.vat_einvoices for each row execute function public.prevent_unlinked_zatca_sales_number_collision();
