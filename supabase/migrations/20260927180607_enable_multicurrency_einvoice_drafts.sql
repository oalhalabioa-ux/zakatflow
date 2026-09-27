-- Allow e-invoice drafts in any active ISO currency and retain the exchange
-- rate and VAT total in the Saudi accounting currency for reporting.
alter table public.vat_einvoices
  drop constraint if exists vat_einvoices_currency_check;

alter table public.vat_einvoices
  add column if not exists exchange_rate numeric(20,10) not null default 1
    check (exchange_rate > 0),
  add column if not exists tax_total_amount_sar numeric(20,2) not null default 0
    check (tax_total_amount_sar >= 0);

update public.vat_einvoices
set exchange_rate = 1,
    tax_total_amount_sar = tax_total_amount
where currency = 'SAR';

alter table public.vat_einvoices
  drop constraint if exists vat_einvoice_sar_rate_is_one;

alter table public.vat_einvoices
  add constraint vat_einvoice_sar_rate_is_one
    check (currency <> 'SAR' or exchange_rate = 1);
