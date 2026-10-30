alter table public.vat_documents
  add column if not exists line_items jsonb;
