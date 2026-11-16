alter table public.vat_documents
  add column if not exists preceding_document_id uuid null references public.vat_documents(id),
  add column if not exists zatca_status text not null default 'NOT_ISSUED'
    check (zatca_status in ('NOT_ISSUED','DRAFT','ISSUED','SUBMITTED','CLEARED','REPORTED'));

create index if not exists vat_documents_preceding_idx on public.vat_documents(preceding_document_id);

alter table public.vat_documents drop constraint if exists vat_documents_document_kind_check;
alter table public.vat_documents add constraint vat_documents_document_kind_check
  check (document_kind in ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')) not valid;
alter table public.vat_documents validate constraint vat_documents_document_kind_check;

comment on column public.vat_documents.zatca_status is 'Compliance projection state only; financial recognition remains sourced from vat_documents.';
