-- DISPOSABLE PREPARATION CONTRACT ONLY. Load after source-freeze.sql.
-- No migration, HTTP caller, authority approval or real onboarding writer.
-- Only the trusted SQL owner may call these INVOKER functions. A future backend
-- must validate PKIX/profile/CSR/KMS/VAT/EGS/policy before recording a binding.
create table zatca_preparation.signer_versions (
  registry_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, environment text not null check(environment in ('SIMULATION','PRODUCTION')),
  connection_id uuid not null, connection_stamp text not null,
  binding jsonb not null, binding_digest text not null check(binding_digest ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
create table zatca_preparation.signer_heads (
  organization_id uuid not null, environment text not null, connection_id uuid not null,
  registry_id uuid not null references zatca_preparation.signer_versions,
  primary key(organization_id,environment,connection_id)
);
create table zatca_preparation.reservation_signers (
  reservation_id uuid primary key references zatca_preparation.entries,
  registry_id uuid not null references zatca_preparation.signer_versions,
  binding_digest text not null
);
create table zatca_preparation.signer_finalization_audit (
  reservation_id uuid primary key references zatca_preparation.reservation_signers,
  registry_id uuid not null references zatca_preparation.signer_versions,
  binding_digest text not null, prepared_at timestamptz not null
);
alter table zatca_preparation.signer_versions enable row level security;
alter table zatca_preparation.signer_heads enable row level security;
alter table zatca_preparation.reservation_signers enable row level security;
alter table zatca_preparation.signer_finalization_audit enable row level security;
create trigger immutable_signer_version before update or delete on zatca_preparation.signer_versions
for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_reservation_signer before update or delete on zatca_preparation.reservation_signers
for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_signer_finalization before update or delete on zatca_preparation.signer_finalization_audit
for each row execute function zatca_preparation.guard_provenance();

-- Shape/scope guard only, NOT cryptographic certificate or policy approval.
-- Binding stores references/public issuer material, never token/password/private key.
create function zatca_preparation.signer_binding_valid(b jsonb,p_org uuid,p_env text,p_connection uuid) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare k text[]; key_parts text[]; secret_parts text[];
begin
  if jsonb_typeof(b) is distinct from 'object' or octet_length(b::text)>200000 then return false; end if;
  select array_agg(key order by key) into k from jsonb_object_keys(b) key;
  if k is distinct from array(select unnest(array['version','organizationId','environment','unitId','connectionId',
      'kmsKeyArn','secretArn','secretVersionId','certificateFingerprintSha256','issuerChainDerBase64','policy','includeSimplifiedQr']) order by 1)
    then return false; end if;
  if (b->>'version'='ZATCA_SAVED_SIGNER_V1' and b->>'organizationId'=p_org::text and b->>'environment'=p_env
    and b->>'unitId'=p_connection::text and b->>'connectionId'=p_connection::text
    and jsonb_typeof(b->'secretVersionId')='string' and b->>'secretVersionId' ~ '^[!-~]{32,64}$'
    and jsonb_typeof(b->'certificateFingerprintSha256')='string' and b->>'certificateFingerprintSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(b->'includeSimplifiedQr')='boolean' and jsonb_typeof(b->'issuerChainDerBase64')='array'
    and jsonb_typeof(b->'policy')='object') is not true then return false; end if;
  if jsonb_array_length(b->'issuerChainDerBase64') not between 1 and 5 then return false; end if;
  if exists(select 1 from jsonb_array_elements(b->'issuerChainDerBase64') x where jsonb_typeof(x)<>'string'
    or length(x#>>'{}') not between 1 and 32768 or (x#>>'{}') !~ '^[A-Za-z0-9+/]+={0,2}$') then return false; end if;
  select array_agg(key order by key) into k from jsonb_object_keys(b->'policy') key;
  if k is distinct from array['digestSha256Base64','identifier'] then return false; end if;
  if (jsonb_typeof(b->'policy'->'identifier')='string' and length(b->'policy'->>'identifier')<=2048
    and b->'policy'->>'identifier' ~ '^https://[^[:space:]]+$'
    and jsonb_typeof(b->'policy'->'digestSha256Base64')='string'
    and b->'policy'->>'digestSha256Base64' ~ '^[A-Za-z0-9+/]{43}=$') is not true then return false; end if;
  key_parts:=regexp_match(b->>'kmsKeyArn','^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
  secret_parts:=regexp_match(b->>'secretArn','^arn:aws:secretsmanager:([a-z0-9-]+):([0-9]{12}):secret:(.+)$');
  return coalesce(key_parts is not null and secret_parts is not null and key_parts[1]=secret_parts[1] and key_parts[2]=secret_parts[2]
    and secret_parts[3] ~ ('^zakatflow/fatoora/'||p_org::text||'/'||lower(p_env)||'/'||p_connection::text||'-[A-Za-z0-9]{6}$'),false);
end $$;

create function zatca_preparation.record_signer_candidate(
  p_org uuid,p_environment text,p_connection uuid,p_binding jsonb,p_expected_head uuid
) returns zatca_preparation.signer_versions
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; current_id uuid;
  result zatca_preparation.signer_versions%rowtype; stamp text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
    and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  -- Connection lock serializes first insert and rotation; common lock order is
  -- membership -> connection -> signer head -> source parent -> ledger unit.
  select * into c from public.vat_einvoice_connections where id=p_connection and organization_id=p_org and environment=p_environment for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  if not zatca_preparation.signer_binding_valid(p_binding,p_org,p_environment,p_connection) then raise exception 'SIGNER_BINDING_INVALID'; end if;
  if c.kms_key_arn is distinct from p_binding->>'kmsKeyArn' or c.credentials_secret_arn is distinct from p_binding->>'secretArn'
    then raise exception 'SIGNER_CONNECTION_REFERENCE_MISMATCH'; end if;
  stamp:=zatca_preparation.connection_stamp(to_jsonb(c));
  select registry_id into current_id from zatca_preparation.signer_heads
    where organization_id=p_org and environment=p_environment and connection_id=p_connection for update;
  if current_id is not null then
    select * into result from zatca_preparation.signer_versions where registry_id=current_id;
    if result.binding=p_binding and result.connection_stamp=stamp then return result; end if;
  end if;
  if current_id is distinct from p_expected_head then raise exception 'SIGNER_HEAD_CHANGED'; end if;
  insert into zatca_preparation.signer_versions(organization_id,environment,connection_id,connection_stamp,binding,binding_digest,recorded_by)
    values(p_org,p_environment,p_connection,stamp,p_binding,encode(sha256(convert_to(p_binding::text,'UTF8')),'hex'),auth.uid()) returning * into result;
  insert into zatca_preparation.signer_heads values(p_org,p_environment,p_connection,result.registry_id)
    on conflict(organization_id,environment,connection_id) do update set registry_id=excluded.registry_id;
  return result;
end $$;

create function zatca_preparation.reserve_with_signer(
  p_org uuid,p_document uuid,p_environment text,p_registry uuid,p_binding_digest text,p_expected_snapshot jsonb
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare connection uuid; c public.vat_einvoice_connections%rowtype; current_id uuid;
  signer zatca_preparation.signer_versions%rowtype; e zatca_preparation.entries%rowtype;
  ref zatca_preparation.reservation_signers%rowtype; existing boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
    and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select connection_id into connection from public.vat_einvoices where organization_id=p_org and id=p_document;
  select * into c from public.vat_einvoice_connections where id=connection and organization_id=p_org and environment=p_environment for share;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  select registry_id into current_id from zatca_preparation.signer_heads
    where organization_id=p_org and environment=p_environment and connection_id=connection for share;
  if not found then raise exception 'SAVED_SIGNER_REQUIRED'; end if;
  if current_id is distinct from p_registry then raise exception 'SIGNER_HEAD_CHANGED'; end if;
  select * into signer from zatca_preparation.signer_versions where registry_id=current_id;
  if signer.organization_id is distinct from p_org or signer.environment is distinct from p_environment or signer.connection_id is distinct from connection
    then raise exception 'SIGNER_SCOPE_MISMATCH'; end if;
  if signer.binding_digest is distinct from p_binding_digest then raise exception 'SIGNER_BINDING_DIGEST_MISMATCH'; end if;
  if signer.connection_stamp is distinct from zatca_preparation.connection_stamp(to_jsonb(c)) then raise exception 'UNIT_CONFIGURATION_CHANGED'; end if;
  -- Never attribute a pre-existing unbound reservation to a later signer.
  select connection_id into connection from public.vat_einvoices where organization_id=p_org and id=p_document for update;
  if connection is distinct from c.id then raise exception 'SAVED_SOURCE_CHANGED'; end if;
  select exists(select 1 from zatca_preparation.entries where organization_id=p_org and document_id=p_document) into existing;
  e:=zatca_preparation.reserve_saved(p_org,p_document,p_environment,p_expected_snapshot);
  select * into ref from zatca_preparation.reservation_signers where reservation_id=e.reservation_id;
  if not found then
    if existing then raise exception 'RESERVATION_SIGNER_REQUIRED'; end if;
    insert into zatca_preparation.reservation_signers values(e.reservation_id,signer.registry_id,signer.binding_digest);
  elsif ref.registry_id is distinct from signer.registry_id or ref.binding_digest is distinct from signer.binding_digest then
    raise exception 'RESERVATION_SIGNER_CHANGED';
  end if;
  return e;
end $$;

create function zatca_preparation.finalize_with_signer(
  p_org uuid,p_environment text,p_unit uuid,p_reservation uuid,p_registry uuid,p_binding_digest text,
  p_credential_reference jsonb,p_snapshot_digest text,p_invoice_hash text,p_prepared_xml text
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare e zatca_preparation.entries%rowtype; signer zatca_preparation.signer_versions%rowtype;
  audit zatca_preparation.signer_finalization_audit%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
    and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into e from zatca_preparation.entries where organization_id=p_org and environment=p_environment and unit_id=p_unit and reservation_id=p_reservation;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  e:=zatca_preparation.reserve_with_signer(p_org,e.document_id,p_environment,p_registry,p_binding_digest,e.snapshot);
  select * into signer from zatca_preparation.signer_versions where registry_id=p_registry;
  if p_credential_reference is distinct from zatca_preparation.pick_fields(signer.binding,
    array['version','secretVersionId','certificateFingerprintSha256']) then raise exception 'SIGNER_CREDENTIAL_REFERENCE_MISMATCH'; end if;
  if e.state='PREPARED' and not exists(select 1 from zatca_preparation.signer_finalization_audit where reservation_id=e.reservation_id)
    then raise exception 'SIGNER_FINALIZATION_AUDIT_REQUIRED'; end if;
  e:=zatca_preparation.finalize_saved(p_org,p_environment,p_unit,p_reservation,p_snapshot_digest,p_invoice_hash,p_prepared_xml);
  insert into zatca_preparation.signer_finalization_audit values(e.reservation_id,p_registry,p_binding_digest,e.prepared_at)
    on conflict(reservation_id) do nothing;
  select * into audit from zatca_preparation.signer_finalization_audit where reservation_id=e.reservation_id;
  if audit.registry_id is distinct from p_registry or audit.binding_digest is distinct from p_binding_digest or audit.prepared_at is distinct from e.prepared_at
    then raise exception 'SIGNER_FINALIZATION_AUDIT_CONFLICT'; end if;
  return e;
end $$;

revoke all on all tables in schema zatca_preparation from public;
revoke all on all functions in schema zatca_preparation from public;
-- Supabase may supply explicit app-role default grants. The isolated ledger QA
-- does not initially create all these roles, hence the conditional revocation.
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on all tables in schema zatca_preparation from %I',role_name);
      execute format('revoke all on all functions in schema zatca_preparation from %I',role_name);
    end if;
  end loop;
end $$;
