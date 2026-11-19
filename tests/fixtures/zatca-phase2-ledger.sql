-- EXPERIMENTAL CONTRACT: disposable PostgreSQL QA only, NOT a deployment migration.
-- No grants to application roles, production callers, financial tables or HTTP RPCs.
-- A future authorized adapter must validate the complete saved DTO and cryptographic
-- artifact before finalization. PREPARED is never ISSUED/CLEARED/REPORTED.
create schema zatca_preparation;
revoke all on schema zatca_preparation from public;

create table zatca_preparation.units (
  organization_id uuid not null,
  environment text not null check (environment in ('SIMULATION','PRODUCTION')),
  unit_id uuid not null,
  last_counter bigint not null default 0 check (last_counter >= 0),
  last_hash text not null default 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  primary key (organization_id, environment, unit_id)
);
create table zatca_preparation.entries (
  reservation_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  environment text not null,
  unit_id uuid not null,
  document_id uuid not null,
  invoice_uuid uuid not null,
  counter bigint not null check (counter > 0),
  previous_hash text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1048576),
  snapshot_digest text not null check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'RESERVED' check (state in ('RESERVED','PREPARED')),
  invoice_hash text,
  prepared_xml text,
  created_at timestamptz not null default clock_timestamp(),
  prepared_at timestamptz,
  foreign key (organization_id,environment,unit_id)
    references zatca_preparation.units(organization_id,environment,unit_id),
  unique (organization_id,environment,document_id),
  unique (organization_id,environment,invoice_uuid),
  unique (organization_id,environment,unit_id,counter),
  check ((state='RESERVED' and invoice_hash is null and prepared_xml is null and prepared_at is null)
    or (state='PREPARED' and invoice_hash is not null and prepared_xml is not null and prepared_at is not null))
);
create unique index one_pending_per_unit on zatca_preparation.entries
  (organization_id,environment,unit_id) where state='RESERVED';
alter table zatca_preparation.units enable row level security;
alter table zatca_preparation.entries enable row level security;
revoke all on all tables in schema zatca_preparation from public;

create function zatca_preparation.guard_entry() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'LEDGER_ENTRY_IMMUTABLE'; end if;
  if row(new.reservation_id,new.organization_id,new.environment,new.unit_id,new.document_id,
    new.invoice_uuid,new.counter,new.previous_hash,new.snapshot,new.snapshot_digest,new.created_at)
    is distinct from row(old.reservation_id,old.organization_id,old.environment,old.unit_id,old.document_id,
    old.invoice_uuid,old.counter,old.previous_hash,old.snapshot,old.snapshot_digest,old.created_at)
    or old.state<>'RESERVED' or new.state<>'PREPARED' then
    raise exception 'LEDGER_ENTRY_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger immutable_entry before update or delete on zatca_preparation.entries
for each row execute function zatca_preparation.guard_entry();

create function zatca_preparation.reserve(
  p_org uuid,p_environment text,p_unit uuid,p_document uuid,p_invoice_uuid uuid,p_snapshot jsonb
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare
  u zatca_preparation.units%rowtype;
  e zatca_preparation.entries%rowtype;
  fingerprint text;
begin
  if p_org is null or p_environment is null or p_unit is null or p_document is null
    or p_invoice_uuid is null or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_snapshot='{}'::jsonb or octet_length(p_snapshot::text)>1048576 then
    raise exception 'RESERVATION_INPUT_INVALID';
  end if;
  -- Same unit row is locked by reserve AND finalize; no transaction spans KMS/network I/O.
  select * into u from zatca_preparation.units where organization_id=p_org
    and environment=p_environment and unit_id=p_unit for update;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  fingerprint:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  select * into e from zatca_preparation.entries where organization_id=p_org
    and environment=p_environment and document_id=p_document;
  if found then
    if e.unit_id<>p_unit or e.invoice_uuid<>p_invoice_uuid or e.snapshot<>p_snapshot then
      raise exception 'RESERVATION_IDENTITY_CONFLICT';
    end if;
    return e;
  end if;
  if exists (select 1 from zatca_preparation.entries where organization_id=p_org
    and environment=p_environment and unit_id=p_unit and state='RESERVED') then
    raise exception 'UNIT_RESERVATION_PENDING';
  end if;
  if u.last_counter=9223372036854775807 then raise exception 'COUNTER_EXHAUSTED'; end if;
  insert into zatca_preparation.entries(organization_id,environment,unit_id,document_id,
    invoice_uuid,counter,previous_hash,snapshot,snapshot_digest)
  values(p_org,p_environment,p_unit,p_document,p_invoice_uuid,u.last_counter+1,u.last_hash,p_snapshot,fingerprint)
  returning * into e;
  return e;
end $$;

create function zatca_preparation.finalize(
  p_org uuid,p_environment text,p_unit uuid,p_reservation uuid,p_snapshot_digest text,
  p_invoice_hash text,p_prepared_xml text
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare
  u zatca_preparation.units%rowtype;
  e zatca_preparation.entries%rowtype;
begin
  if p_invoice_hash is null or p_invoice_hash !~ '^[A-Za-z0-9+/]{43}=$'
    or octet_length(decode(p_invoice_hash,'base64'))<>32
    or encode(decode(p_invoice_hash,'base64'),'base64')<>p_invoice_hash
    or p_prepared_xml is null or length(btrim(p_prepared_xml))=0
    or octet_length(p_prepared_xml)>5242880 then raise exception 'ARTIFACT_INPUT_INVALID'; end if;
  select * into u from zatca_preparation.units where organization_id=p_org
    and environment=p_environment and unit_id=p_unit for update;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  select * into e from zatca_preparation.entries where organization_id=p_org
    and environment=p_environment and unit_id=p_unit and reservation_id=p_reservation for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if p_snapshot_digest is distinct from e.snapshot_digest then raise exception 'SNAPSHOT_DIGEST_MISMATCH'; end if;
  if e.state='PREPARED' then
    if e.invoice_hash<>p_invoice_hash or e.prepared_xml<>p_prepared_xml then
      raise exception 'PREPARED_ARTIFACT_CONFLICT';
    end if;
    return e;
  end if;
  if e.counter<>u.last_counter+1 or e.previous_hash<>u.last_hash then
    raise exception 'CHAIN_HEAD_CONFLICT';
  end if;
  update zatca_preparation.entries set state='PREPARED',invoice_hash=p_invoice_hash,
    prepared_xml=p_prepared_xml,prepared_at=clock_timestamp()
    where reservation_id=e.reservation_id returning * into e;
  update zatca_preparation.units set last_counter=e.counter,last_hash=e.invoice_hash
    where organization_id=p_org and environment=p_environment and unit_id=p_unit;
  return e;
end $$;
revoke all on all functions in schema zatca_preparation from public;
