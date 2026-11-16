alter table public.vat_einvoices
  add column if not exists due_date date;

alter table public.vat_einvoices
  add constraint vat_einvoices_due_date_not_before_issue
  check (due_date is null or due_date >= issue_date) not valid;

alter table public.vat_einvoices
  validate constraint vat_einvoices_due_date_not_before_issue;
