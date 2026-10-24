-- DISPOSABLE QA CANDIDATE ONLY. Not a migration; no application grants or caller.
-- Requires source-shaped harness tables (or a separately reviewed real schema).
-- All functions are INVOKER. SQL owner is the private backend stand-in in QA.
create table zatca_preparation.document_context (
  invoice_id uuid primary key references public.vat_einvoices(id),
  organization_id uuid not null,
  context jsonb not null check (jsonb_typeof(context)='object')
);
alter table zatca_preparation.document_context enable row level security;

create function zatca_preparation.pick_fields(value jsonb, fields text[]) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(value) where key=any(fields)
$$;

-- Owner-only default lookup. The separately reviewed QA permission adapter can
-- replace only this boolean primitive, without exposing the ledger to app roles.
create function zatca_preparation.source_is_frozen(p_org uuid,p_invoice uuid) returns boolean
language sql volatile security invoker set search_path=pg_catalog as $$
select exists(select 1 from zatca_preparation.entries where organization_id=p_org and document_id=p_invoice)
$$;

create function zatca_preparation.guard_source() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare ids uuid[]; parent_id uuid; org uuid;
begin
  if tg_table_name='vat_einvoices' then
    ids:=array[old.id];
  else
    if tg_op='INSERT' then ids:=array[new.invoice_id];
    elsif tg_op='DELETE' then ids:=array[old.invoice_id];
    else ids:=array[old.invoice_id,new.invoice_id]; end if;
  end if;
  -- Parent row is the common serialization point for header/line/context writes.
  -- Sorting both parents also protects moving a line between invoices.
  for parent_id in select distinct x from unnest(ids) x order by x loop
    select organization_id into org from public.vat_einvoices where id=parent_id for update;
    if zatca_preparation.source_is_frozen(org,parent_id) then
      raise exception 'EINVOICE_SOURCE_FROZEN';
    end if;
    if tg_table_name<>'vat_einvoices' then
      -- Also version the parent for ordinary line/context writers. Otherwise a
      -- stale REPEATABLE READ reservation could lock an unchanged parent and
      -- read old child rows. The header trigger does not recurse into this branch.
      update public.vat_einvoices set updated_at=clock_timestamp() where id=parent_id;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger phase2_frozen_header before update or delete on public.vat_einvoices
for each row execute function zatca_preparation.guard_source();
create trigger phase2_frozen_line before insert or update or delete on public.vat_einvoice_lines
for each row execute function zatca_preparation.guard_source();
-- Context uses the same invoice_id guard contract. This table is private and no
-- production writer exists; changing context after reservation must also fail.
create trigger phase2_frozen_context before insert or update or delete on zatca_preparation.document_context
for each row execute function zatca_preparation.guard_source();

create function zatca_preparation.reserve_saved(
  p_org uuid,p_document uuid,p_environment text,p_expected_snapshot jsonb
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare
  actor uuid:=auth.uid(); member public.organization_members%rowtype;
  h public.vat_einvoices%rowtype; c public.vat_einvoice_connections%rowtype;
  ctx jsonb; snapshot jsonb; draft jsonb; lines jsonb; amounts jsonb; totals jsonb;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if p_org is null or p_document is null or p_environment is null
      or p_environment not in ('SIMULATION','PRODUCTION') or p_expected_snapshot is null then
    raise exception 'RESERVATION_INPUT_INVALID';
  end if;
  -- Keep membership and connection stable until reservation commits. Revocation
  -- before this lock wins; a revocation afterward waits, then applies normally.
  select * into member from public.organization_members where organization_id=p_org and user_id=actor for share;
  if not found or member.status is distinct from 'ACTIVE' or member.role is null or member.role not in ('OWNER','ADMIN') then
    raise exception 'ORGANIZATION_ADMIN_REQUIRED';
  end if;
  -- Discover the connection without locking the parent, then follow the stable
  -- membership -> connection -> parent -> unit lock order. Recheck the linkage
  -- after locking the parent; never lock a newly changed connection out of order.
  select * into h from public.vat_einvoices where organization_id=p_org and id=p_document;
  if not found then raise exception 'EINVOICE_DRAFT_NOT_FOUND'; end if;
  select * into c from public.vat_einvoice_connections where organization_id=p_org
    and id=h.connection_id and environment=p_environment for share;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  select * into h from public.vat_einvoices where organization_id=p_org and id=p_document for update;
  if not found then raise exception 'EINVOICE_DRAFT_NOT_FOUND'; end if;
  if h.connection_id is distinct from c.id then raise exception 'SAVED_SOURCE_CHANGED'; end if;
  if h.status is distinct from 'DRAFT' then raise exception 'EINVOICE_DRAFT_LOCKED'; end if;
  if c.status is distinct from (case p_environment when 'SIMULATION' then 'COMPLIANCE_PASSED' else 'CONNECTED' end)
    then raise exception 'EINVOICE_CONNECTION_NOT_READY'; end if;
  if c.taxpayer_vat_number is distinct from h.seller_vat_number then raise exception 'SELLER_VAT_MISMATCH'; end if;
  if ((h.invoice_category='STANDARD' and c.invoice_type in ('1000','1100'))
      or (h.invoice_category='SIMPLIFIED' and c.invoice_type in ('0100','1100'))) is not true
    or c.egs_serial_number is null or btrim(c.egs_serial_number)='' then raise exception 'EINVOICE_UNIT_CATEGORY_MISMATCH'; end if;
  -- Context writers already serialize through the parent trigger. A second
  -- context-row lock here would invert the BEFORE-trigger lock order.
  select context into ctx from zatca_preparation.document_context where invoice_id=h.id and organization_id=p_org;
  if not found then raise exception 'SAVED_XML_CONTEXT_REQUIRED'; end if;
  draft:=zatca_preparation.pick_fields(to_jsonb(h),array[
    'organization_id','buyer_contact_id','connection_id','invoice_number','document_type','invoice_category',
    'issue_date','due_date','issue_time','currency','exchange_rate','seller_name','seller_vat_number',
    'seller_address','seller_city','seller_building_number','seller_district','seller_additional_number',
    'seller_postal_code','seller_country_code','buyer_name','buyer_vat_number','buyer_address','buyer_city',
    'buyer_building_number','buyer_district','buyer_additional_number','buyer_postal_code','buyer_country_code',
    'payment_means_code','billing_reference','preceding_invoice_id','note_reason']);
  select jsonb_agg(zatca_preparation.pick_fields(to_jsonb(l),array[
      'item_name','description','quantity','unit_code','unit_price','discount_amount','tax_category',
      'tax_rate','tax_exemption_reason_code','tax_exemption_reason']) order by l.line_number),
    jsonb_agg(jsonb_build_object('line_number',l.line_number,'line_extension_amount',l.line_extension_amount::text,
      'tax_amount',l.tax_amount::text,'gross_amount',l.gross_amount::text) order by l.line_number)
    into lines,amounts from public.vat_einvoice_lines l where invoice_id=h.id;
  if lines is null or jsonb_array_length(lines) not between 1 and 500 then raise exception 'SAVED_LINES_REQUIRED'; end if;
  totals:=jsonb_build_object('line_extension_amount',h.line_extension_amount::text,
    'allowance_total_amount',h.allowance_total_amount::text,'tax_exclusive_amount',h.tax_exclusive_amount::text,
    'tax_total_amount',h.tax_total_amount::text,'tax_inclusive_amount',h.tax_inclusive_amount::text,'payable_amount',h.payable_amount::text);
  snapshot:=jsonb_build_object('version','ZATCA_PREPARATION_V1','scope',jsonb_build_object(
    'organizationId',p_org,'environment',p_environment,'unitId',c.id,'connectionId',c.id,
    'documentId',h.id,'invoiceUuid',h.invoice_uuid),'draft',draft||jsonb_build_object('lines',lines),
    'context',ctx,'savedTotals',totals,'savedLineAmounts',amounts);
  if snapshot is distinct from p_expected_snapshot then raise exception 'SAVED_SOURCE_CHANGED'; end if;
  -- Touch the parent BEFORE inserting the ledger entry, inside the same transaction.
  -- A pre-existing REPEATABLE READ writer must then serialize/fail rather than use
  -- an old snapshot after waiting on an unchanged parent row. No financial field changes.
  if not exists(select 1 from zatca_preparation.entries where organization_id=p_org and document_id=h.id) then
    update public.vat_einvoices set updated_at=clock_timestamp() where id=h.id;
  end if;
  return zatca_preparation.reserve(p_org,p_environment,c.id,h.id,h.invoice_uuid,snapshot);
end $$;
revoke all on all tables in schema zatca_preparation from public;
revoke all on all functions in schema zatca_preparation from public;
