-- Personal commercial records. Tax drafts cannot be promoted to issued invoices here.
create table public.personal_income_profiles (
  owner_id uuid primary key default auth.uid() references auth.users,
  seller_name text not null check (length(trim(seller_name)) between 1 and 200),
  vat_number text check (vat_number ~ '^3[0-9]{13}3$'),
  effective_from date,
  check ((vat_number is null) = (effective_from is null))
);

-- Reviewed taxpayer setup for a phase-one simplified invoice. A taxpayer
-- subject to integration must use their separately onboarded issuing unit.
create table public.personal_income_issuers (
  owner_id uuid primary key references auth.users,
  vat_number text not null check(vat_number ~ '^3[0-9]{13}3$'),
  address text not null check(length(trim(address)) between 1 and 400),
  valid_from date not null,
  valid_until date not null check(valid_until >= valid_from)
);
alter table public.personal_income_issuers enable row level security;
revoke all on public.personal_income_issuers from public,anon,authenticated;
grant select on public.personal_income_issuers to authenticated;
create policy read_personal_issuer on public.personal_income_issuers for select to authenticated using(owner_id=auth.uid());

create table public.personal_income_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users,
  request_id uuid not null,
  serial bigint not null,
  kind text not null check (kind in ('FEE_INVOICE','TAX_DRAFT','EXTERNAL_EVIDENCE','SIMPLIFIED_INVOICE')),
  document_date date not null,
  seller_name text not null,
  seller_vat_number text,
  invoice_number bigint,
  issued_at timestamptz,
  seller_address text,
  unique(owner_id,invoice_number),
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
  issuer public.personal_income_issuers%rowtype;
  issued_number bigint;
  issue_time timestamptz;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into profile from public.personal_income_profiles where owner_id=actor for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  select * into doc from public.personal_income_documents where owner_id=actor and request_id=p_request;
  if found then
    if (case when doc.kind='EXTERNAL_EVIDENCE' then 'EVIDENCE' when doc.kind='SIMPLIFIED_INVOICE' then 'SIMPLIFIED' else 'INVOICE' end,
        doc.document_date,doc.customer,doc.description,doc.source_reference,doc.net_amount,doc.tax_amount)
       is distinct from (p_mode,p_date,trim(p_customer),trim(p_description),nullif(trim(p_reference),''),p_net,p_tax)
       then raise exception 'REQUEST_CONFLICT'; end if;
    return doc;
  end if;
  if p_mode is null or p_mode not in ('EVIDENCE','INVOICE','SIMPLIFIED') or p_request is null or p_date is null
    or p_net is null or p_tax is null or p_net<>round(p_net,2) or p_tax<>round(p_tax,2)
    then raise exception 'INVALID_DOCUMENT'; end if;
  document_kind := case when p_mode='EVIDENCE' then 'EXTERNAL_EVIDENCE'
    when profile.effective_from <= p_date then 'TAX_DRAFT' else 'FEE_INVOICE' end;
  if p_mode='SIMPLIFIED' then
    issue_time:=clock_timestamp();
    select * into issuer from public.personal_income_issuers where owner_id=actor
      and vat_number=profile.vat_number and (issue_time at time zone 'Asia/Riyadh')::date between valid_from and valid_until for share;
    if not found or profile.effective_from is null or p_date<profile.effective_from or p_date>(issue_time at time zone 'Asia/Riyadh')::date
       or p_tax<>round(p_net*0.15,2) or octet_length(profile.seller_name)>255 then raise exception 'SIMPLIFIED_ISSUER_UNAVAILABLE'; end if;
    select coalesce(max(invoice_number),0)+1 into issued_number from public.personal_income_documents where owner_id=actor;
    document_kind:='SIMPLIFIED_INVOICE';
  end if;
  if p_tax>0 and (profile.effective_from is null or profile.effective_from>p_date)
    then raise exception 'VAT_REGISTRATION_REQUIRED'; end if;
  select coalesce(max(serial),0)+1 into next_serial from public.personal_income_documents where owner_id=actor;
  insert into public.personal_income_documents(owner_id,request_id,serial,kind,document_date,seller_name,
    seller_vat_number,customer,description,source_reference,net_amount,tax_amount,invoice_number,issued_at,seller_address)
  values(actor,p_request,next_serial,document_kind,p_date,profile.seller_name,
    case when profile.effective_from<=p_date then profile.vat_number end,trim(p_customer),trim(p_description),
    nullif(trim(p_reference),''),p_net,p_tax,issued_number,issue_time,issuer.address) returning * into doc;
  return doc;
end;
$$;
revoke all on function public.record_personal_income_document(uuid,text,date,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.record_personal_income_document(uuid,text,date,text,text,text,numeric,numeric) to authenticated;

-- The document, receivable, transaction and lot commit or roll back together.
alter table public.personal_income_documents add column receivable_id uuid unique references public.asset_accounts;
create function public.personal_income_recognize() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  total numeric := new.net_amount + new.tax_amount;
  movement uuid;
  attribution jsonb := jsonb_build_object('personal_income_document_id',new.id,'entry_source','PERSONAL_INCOME');
begin
  if new.kind='TAX_DRAFT' then return new; end if;
  if new.document_date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'FUTURE_DOCUMENT'; end if;
  if (select base_currency from public.profiles where id=new.owner_id) is distinct from 'SAR' then
    raise exception 'SAR_BASE_REQUIRED';
  end if;
  insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,unit,is_zakatable,metadata)
    values(new.owner_id,'RECEIVABLE',new.customer,'SAR','PERSONAL','unit',true,attribution)
    returning id into new.receivable_id;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,
    base_currency,base_value,reference,notes,metadata,created_by)
    values(new.owner_id,new.receivable_id,'ADD',new.document_date,total,'SAR',total,'SAR',total,
      new.serial::text,new.description,attribution||jsonb_build_object('non_cash',true),new.owner_id)
    returning id into movement;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,
    origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status)
    values(new.owner_id,new.receivable_id,movement,new.document_date,new.document_date,new.document_date,new.document_date,total,total,total,total,'ACTIVE');
  return new;
end;
$$;
revoke all on function public.personal_income_recognize() from public,anon,authenticated;
create trigger recognize_personal_income before insert on public.personal_income_documents
for each row execute function public.personal_income_recognize();

-- Attach supporting evidence to the original document without a financial movement.
create table public.personal_income_evidence (
  document_id uuid not null references public.personal_income_documents,
  request_id uuid not null,
  reference text not null check(length(trim(reference)) between 1 and 200),
  filename text not null check(length(trim(filename)) between 1 and 180),
  pdf_base64 text not null check(length(pdf_base64) between 8 and 1398104 and left(pdf_base64,7)='JVBERi0'),
  primary key(document_id,request_id),
  unique(document_id,reference)
);
alter table public.personal_income_evidence enable row level security;
revoke all on public.personal_income_evidence from public,anon,authenticated;
grant select,insert on public.personal_income_evidence to authenticated;
create policy personal_income_evidence_owner on public.personal_income_evidence to authenticated
using(exists(select 1 from public.personal_income_documents d where d.id=document_id and d.owner_id=auth.uid()))
with check(exists(select 1 from public.personal_income_documents d where d.id=document_id and d.owner_id=auth.uid()));

create function public.personal_income_period(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('currency','SAR','net',coalesce(sum(net_amount),0)::text,
   'tax',coalesce(sum(tax_amount),0)::text,'count',count(*))
 from public.personal_income_documents
 where owner_id=auth.uid() and receivable_id is not null and document_date between p_from and p_to;
$$;
revoke all on function public.personal_income_period(date,date) from public,anon;
grant execute on function public.personal_income_period(date,date) to authenticated;
