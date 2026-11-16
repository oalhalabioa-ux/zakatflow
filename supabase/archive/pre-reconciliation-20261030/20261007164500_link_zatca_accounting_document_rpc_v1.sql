create or replace function public.link_zatca_accounting_document(p_einvoice_id uuid, p_document_id uuid)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
declare e public.vat_einvoices%rowtype; d public.vat_documents%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into e from public.vat_einvoices where id=p_einvoice_id;
 select * into d from public.vat_documents where id=p_document_id;
 if e.id is null or d.id is null or e.organization_id<>d.organization_id then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
 if not public.is_organization_admin(e.organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 if d.document_type<>'SALES' then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
 if (e.document_type='INVOICE' and d.document_kind<>'INVOICE') or
    (e.document_type='CREDIT_NOTE' and d.document_kind<>'CREDIT_NOTE') or
    (e.document_type='DEBIT_NOTE' and d.document_kind<>'DEBIT_NOTE') then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
 update public.vat_einvoices set accounting_document_id=d.id where id=e.id;
 update public.vat_documents set zatca_status=case when e.status='DRAFT' then 'DRAFT' else e.status end where id=d.id;
end $$;
grant execute on function public.link_zatca_accounting_document(uuid,uuid) to authenticated;
