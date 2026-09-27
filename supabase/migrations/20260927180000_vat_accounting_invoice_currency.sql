alter table public.vat_documents
  add column if not exists source_currency text not null default 'SAR' references public.currencies(code),
  add column if not exists exchange_rate numeric(24,10) not null default 1 check (exchange_rate > 0),
  add column if not exists source_net_amount numeric(20,2) not null default 0 check (source_net_amount >= 0),
  add column if not exists source_tax_amount numeric(20,2) not null default 0 check (source_tax_amount >= 0),
  add column if not exists source_gross_amount numeric(20,2) not null default 0 check (source_gross_amount >= 0);

update public.vat_documents
set source_currency = currency,
    source_net_amount = net_amount,
    source_tax_amount = tax_amount,
    source_gross_amount = gross_amount
where source_net_amount = 0 and source_tax_amount = 0 and source_gross_amount = 0;

comment on column public.vat_documents.currency is 'Currency used by VAT summaries; amounts are normalized to the organization base currency.';
comment on column public.vat_documents.source_currency is 'Currency shown on the original accounting invoice.';
comment on column public.vat_documents.exchange_rate is 'Organization base currency units per one source currency unit.';
