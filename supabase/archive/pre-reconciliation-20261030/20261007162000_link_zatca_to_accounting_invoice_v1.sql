alter table public.vat_einvoices
  add column if not exists accounting_document_id uuid null references public.vat_documents(id);

create unique index if not exists vat_einvoices_accounting_document_uidx
  on public.vat_einvoices(accounting_document_id)
  where accounting_document_id is not null;

comment on column public.vat_einvoices.accounting_document_id is
  '1:1 link to the accounting invoice source. ZATCA document is compliance-only and must not duplicate recognition or liquidity.';
