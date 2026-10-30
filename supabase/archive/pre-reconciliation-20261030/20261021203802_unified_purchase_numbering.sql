-- One immutable internal purchase number per company/source, shared by VAT aliases.
-- Supplier references and all recognition/settlement amounts remain unchanged.
lock table public.transactions, public.vat_documents in share row exclusive mode;

create table private.purchase_invoice_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_year integer not null,
  last_value bigint not null check (last_value > 0),
  primary key (organization_id, invoice_year)
);
create table private.purchase_invoice_numbers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check (source_type in ('ASSET','VAT')),
  source_id uuid not null,
  invoice_year integer not null,
  sequence_value bigint not null,
  number text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, source_type, source_id),
  unique (organization_id, number),
  unique (organization_id, invoice_year, sequence_value)
);
-- Keep issued allocations after a draft/source is deleted: numbers are never recycled.
alter table private.purchase_invoice_counters enable row level security;
alter table private.purchase_invoice_numbers enable row level security;
revoke all on private.purchase_invoice_counters, private.purchase_invoice_numbers from public, anon, authenticated;
alter table public.transactions add column purchase_number text;
alter table public.vat_documents add column purchase_number text;

create function private.allocate_purchase_invoice_number(p_org uuid,p_source text,p_id uuid,p_date date)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare result text; yr integer := extract(year from p_date); seq bigint;
begin
  if p_org is null or p_id is null or p_date is null or p_source not in ('ASSET','VAT') then
    raise exception 'PURCHASE_NUMBER_SOURCE_REQUIRED';
  end if;
  -- Serialize identity lookup as well as counter increment (including first use).
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 81427));
  select number into result from private.purchase_invoice_numbers
    where organization_id=p_org and source_type=p_source and source_id=p_id;
  if found then return result; end if;
  insert into private.purchase_invoice_counters(organization_id,invoice_year,last_value)
    values(p_org,yr,1) on conflict(organization_id,invoice_year) do update
    set last_value=private.purchase_invoice_counters.last_value+1 returning last_value into seq;
  result := 'PUR-' || yr::text || '-' || lpad(seq::text,greatest(6,length(seq::text)),'0');
  insert into private.purchase_invoice_numbers(organization_id,source_type,source_id,invoice_year,sequence_value,number)
    values(p_org,p_source,p_id,yr,seq,result);
  return result;
end $$;
revoke all on function private.allocate_purchase_invoice_number(uuid,text,uuid,date) from public,anon,authenticated;

-- Assign historical numbers in deterministic chronological order, preserving supplier numbers.
-- A posted source normally rejects any new column change. Pause only that guard
-- while holding both write locks; restore it in this same migration transaction.
alter table public.vat_documents disable trigger guard_accounting_invoice_source;
do $$
declare r record; num text;
begin
  for r in
    select organization_id, 'ASSET'::text as source_type, id as source_id, transaction_date, created_at
      from public.transactions where organization_id is not null and transaction_type='PURCHASE' and reversal_of_transaction_id is null
    union all
    select organization_id, 'VAT', id, transaction_date, created_at from public.vat_documents
      where document_type='PURCHASE' and document_kind='INVOICE' and asset_transaction_id is null
    order by transaction_date,created_at,source_type,source_id
  loop
    num := private.allocate_purchase_invoice_number(r.organization_id,r.source_type,r.source_id,r.transaction_date);
    if r.source_type='ASSET' then update public.transactions set purchase_number=num where id=r.source_id;
    else update public.vat_documents set purchase_number=num where id=r.source_id; end if;
  end loop;
  update public.vat_documents d set purchase_number=t.purchase_number from public.transactions t
    where d.asset_transaction_id=t.id and d.organization_id=t.organization_id
      and d.document_type='PURCHASE' and d.document_kind='INVOICE';
end $$;
alter table public.vat_documents enable trigger guard_accounting_invoice_source;

create function private.assign_asset_purchase_number()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and old.purchase_number is not null then
    if new.purchase_number is distinct from old.purchase_number or new.id<>old.id
      or new.organization_id is distinct from old.organization_id or new.transaction_type<>old.transaction_type
      or new.reversal_of_transaction_id is distinct from old.reversal_of_transaction_id then
      raise exception 'PURCHASE_NUMBER_IMMUTABLE';
    end if;
    return new;
  end if;
  new.purchase_number := null;
  if new.organization_id is not null and new.transaction_type='PURCHASE' and new.reversal_of_transaction_id is null then
    new.purchase_number := private.allocate_purchase_invoice_number(new.organization_id,'ASSET',new.id,new.transaction_date);
  end if;
  return new;
end $$;

create function private.assign_vat_purchase_number()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare asset_number text;
begin
  if tg_op='UPDATE' and old.purchase_number is not null then
    if new.purchase_number is distinct from old.purchase_number or new.id<>old.id
      or new.organization_id is distinct from old.organization_id or new.document_type<>old.document_type
      or new.document_kind<>old.document_kind or new.asset_transaction_id is distinct from old.asset_transaction_id then
      raise exception 'PURCHASE_NUMBER_IMMUTABLE';
    end if;
    return new;
  end if;
  new.purchase_number := null;
  if new.document_type='PURCHASE' and new.document_kind='INVOICE' then
    if new.asset_transaction_id is not null then
      select purchase_number into asset_number from public.transactions
        where id=new.asset_transaction_id and organization_id=new.organization_id and transaction_type='PURCHASE';
      if asset_number is null then raise exception 'PURCHASE_NUMBER_ASSET_SCOPE_MISMATCH'; end if;
      new.purchase_number := asset_number;
    else
      new.purchase_number := private.allocate_purchase_invoice_number(new.organization_id,'VAT',new.id,new.transaction_date);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.assign_asset_purchase_number(), private.assign_vat_purchase_number() from public,anon,authenticated;
create trigger assign_asset_purchase_number before insert or update on public.transactions
  for each row execute function private.assign_asset_purchase_number();
create trigger assign_vat_purchase_number before insert or update on public.vat_documents
  for each row execute function private.assign_vat_purchase_number();
comment on column public.transactions.purchase_number is 'Immutable company/year internal purchase number. reference remains the supplier invoice reference.';
comment on column public.vat_documents.purchase_number is 'Shared internal purchase number; asset aliases reuse the transaction number. document_number remains the supplier reference.';
