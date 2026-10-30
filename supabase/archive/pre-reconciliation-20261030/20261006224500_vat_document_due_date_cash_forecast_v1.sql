-- Invoice due date foundation for operational cash forecasting.
-- Additive only: existing VAT documents remain valid and untouched.
alter table public.vat_documents
  add column if not exists due_date date;

alter table public.vat_documents
  drop constraint if exists vat_documents_due_date_not_before_transaction;

alter table public.vat_documents
  add constraint vat_documents_due_date_not_before_transaction
  check (due_date is null or due_date >= transaction_date) not valid;

alter table public.vat_documents
  validate constraint vat_documents_due_date_not_before_transaction;

create index if not exists vat_documents_org_due_idx
  on public.vat_documents (organization_id, due_date)
  where due_date is not null;
