create index if not exists idx_vat_documents_user_id
  on public.vat_documents (user_id);

create index if not exists idx_vat_documents_created_by
  on public.vat_documents (created_by);

create index if not exists idx_vat_documents_currency
  on public.vat_documents (currency);

create index if not exists idx_vat_profiles_created_by
  on public.vat_profiles (created_by);
