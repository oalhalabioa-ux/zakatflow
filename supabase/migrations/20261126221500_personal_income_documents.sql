-- Personal commercial records. Tax drafts cannot be promoted to issued invoices here.
create table public.personal_income_profiles (
  owner_id uuid primary key default auth.uid() references auth.users,
  seller_name text not null check (length(trim(seller_name)) between 1 and 200),
  vat_number text check (vat_number ~ '^3[0-9]{13}3$'),
  effective_from date,
  check ((vat_number is null) = (effective_from is null))
);

create table public.personal_income_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users,
  request_id uuid not null,
  serial bigint not null,
  kind text not null check (kind in ('FEE_INVOICE','TAX_DRAFT','EXTERNAL_EVIDENCE')),
  document_date date not null,
  seller_name text not null,
  seller_vat_number text,
  customer text not null check (length(trim(customer)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 500),
  source_reference text check (length(trim(source_reference)) between 1 and 200),
  net_amount numeric(16,2) not null check (net_amount > 0),
  tax_amount numeric(16,2) not null check (tax_amount >= 0),
  gross_amount numeric(16,2) generated always as (net_amount + tax_amount) stored,
  unique (owner_id,request_id),
  unique (owner_id,serial),
  check ((kind = 'EXTERNAL_EVIDENCE') = (source_reference is not null)),
  check (kind <> 'FEE_INVOICE' or tax_amount = 0)
);
create unique index personal_income_external_ref on public.personal_income_documents
  (owner_id,lower(trim(customer)),lower(trim(source_reference))) where kind = 'EXTERNAL_EVIDENCE';

alter table public.personal_income_profiles enable row level security;
alter table public.personal_income_documents enable row level security;
revoke all on public.personal_income_profiles, public.personal_income_documents from public,anon,authenticated;
grant select, insert, update on public.personal_income_profiles to authenticated;
grant select on public.personal_income_documents to authenticated;
create policy personal_income_profile_access on public.personal_income_profiles to authenticated
  using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy personal_income_document_read on public.personal_income_documents for select to authenticated using (owner_id=auth.uid());

create function public.record_personal_income_document(p_request uuid,p_mode text,p_date date,
  p_customer text,p_description text,p_reference text,p_net numeric,p_tax numeric)
returns public.personal_income_documents language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  profile public.personal_income_profiles%rowtype;
  doc public.personal_income_documents%rowtype;
  next_serial bigint;
  document_kind text;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into profile from public.personal_income_profiles where owner_id=actor for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  select * into doc from public.personal_income_documents where owner_id=actor and request_id=p_request;
  if found then
    if (case when doc.kind='EXTERNAL_EVIDENCE' then 'EVIDENCE' else 'INVOICE' end,
        doc.document_date,doc.customer,doc.description,doc.source_reference,doc.net_amount,doc.tax_amount)
       is distinct from (p_mode,p_date,trim(p_customer),trim(p_description),nullif(trim(p_reference),''),p_net,p_tax)
       then raise exception 'REQUEST_CONFLICT'; end if;
    return doc;
  end if;
  if p_mode is null or p_mode not in ('EVIDENCE','INVOICE') or p_request is null or p_date is null
    or p_net is null or p_tax is null or p_net<>round(p_net,2) or p_tax<>round(p_tax,2)
    then raise exception 'INVALID_DOCUMENT'; end if;
  document_kind := case when p_mode='EVIDENCE' then 'EXTERNAL_EVIDENCE'
    when profile.effective_from <= p_date then 'TAX_DRAFT' else 'FEE_INVOICE' end;
  if p_tax>0 and (profile.effective_from is null or profile.effective_from>p_date)
    then raise exception 'VAT_REGISTRATION_REQUIRED'; end if;
  select coalesce(max(serial),0)+1 into next_serial from public.personal_income_documents where owner_id=actor;
  insert into public.personal_income_documents(owner_id,request_id,serial,kind,document_date,seller_name,
    seller_vat_number,customer,description,source_reference,net_amount,tax_amount)
  values(actor,p_request,next_serial,document_kind,p_date,profile.seller_name,
    case when profile.effective_from<=p_date then profile.vat_number end,trim(p_customer),trim(p_description),
    nullif(trim(p_reference),''),p_net,p_tax) returning * into doc;
  return doc;
end;
$$;
revoke all on function public.record_personal_income_document(uuid,text,date,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.record_personal_income_document(uuid,text,date,text,text,text,numeric,numeric) to authenticated;
