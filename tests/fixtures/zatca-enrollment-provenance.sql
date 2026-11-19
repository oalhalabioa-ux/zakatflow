-- DISPOSABLE INITIAL-ENROLLMENT CANDIDATE ONLY; install after signer-registry.
-- Trusted owner-only INVOKER primitives, no application grants or live caller.
-- PostgreSQL checks persistence/scope/consistency, NOT CSR/certificate cryptography.
create table zatca_preparation.enrollment_requests (
  enrollment_id uuid primary key, organization_id uuid not null, environment text not null check(environment in ('SIMULATION','PRODUCTION')),
  connection_id uuid not null, unit_stamp text not null, csr_der_base64 text not null,
  expected_identity jsonb not null, enrollment_digest text not null,
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(organization_id,environment,connection_id)
);
create table zatca_preparation.enrollment_checks (
  check_id uuid primary key default gen_random_uuid(), registry_id uuid not null references zatca_preparation.signer_versions,
  enrollment_id uuid not null references zatca_preparation.enrollment_requests, evidence jsonb not null,
  evidence_digest text not null, checked_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(registry_id,evidence_digest)
);
create table zatca_preparation.registry_enrollments (
  registry_id uuid primary key references zatca_preparation.signer_versions,
  enrollment_id uuid not null references zatca_preparation.enrollment_requests,
  enrollment_digest text not null, first_check_id uuid not null references zatca_preparation.enrollment_checks
);
create table zatca_preparation.enrollment_reservations (
  reservation_id uuid primary key references zatca_preparation.reservation_signers,
  registry_id uuid not null references zatca_preparation.registry_enrollments,
  enrollment_digest text not null, first_check_id uuid not null references zatca_preparation.enrollment_checks
);
create table zatca_preparation.enrollment_finalization_audit (
  reservation_id uuid primary key references zatca_preparation.enrollment_reservations,
  enrollment_digest text not null, first_check_id uuid not null references zatca_preparation.enrollment_checks,
  prepared_at timestamptz not null
);
alter table zatca_preparation.enrollment_requests enable row level security;
alter table zatca_preparation.enrollment_checks enable row level security;
alter table zatca_preparation.registry_enrollments enable row level security;
alter table zatca_preparation.enrollment_reservations enable row level security;
alter table zatca_preparation.enrollment_finalization_audit enable row level security;
create trigger immutable_enrollment_request before update or delete on zatca_preparation.enrollment_requests for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_enrollment_check before update or delete on zatca_preparation.enrollment_checks for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_registry_enrollment before update or delete on zatca_preparation.registry_enrollments for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_enrollment_reservation before update or delete on zatca_preparation.enrollment_reservations for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_enrollment_finalization before update or delete on zatca_preparation.enrollment_finalization_audit for each row execute function zatca_preparation.guard_provenance();

create function zatca_preparation.canonical_public_base64(value text) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if value is null or length(value) not between 4 and 32768 or value !~ '^[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  return replace(encode(decode(value,'base64'),'base64'),E'\n','')=value;
exception when others then return false; end $$;
create function zatca_preparation.enrollment_unit_stamp(connection jsonb) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
select zatca_preparation.connection_stamp(connection-'credentials_secret_arn')
$$;

-- ZAKATFLOW_FLAT_IDENTITY_V1 receipt; same byte framing as the Node verifier.
create function zatca_preparation.enrollment_identity_digest(value jsonb) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare bytes bytea;
begin
  if jsonb_typeof(value) is distinct from 'object' then raise exception 'ENROLLMENT_IDENTITY_INVALID'; end if;
  if exists(select 1 from jsonb_each(value) x where jsonb_typeof(x.value)<>'string') then
    raise exception 'ENROLLMENT_IDENTITY_INVALID';
  end if;
  select string_agg(int4send(octet_length(convert_to(key,'UTF8')))||convert_to(key,'UTF8')||
    int4send(octet_length(convert_to(v,'UTF8')))||convert_to(v,'UTF8'),'\x'::bytea order by key collate "C") into bytes from jsonb_each_text(value) x(key,v);
  return encode(sha256(coalesce(bytes,'\x'::bytea)),'hex');
end $$;

create function zatca_preparation.begin_initial_enrollment(
  p_org uuid,p_environment text,p_connection uuid,p_enrollment uuid,p_csr_der_base64 text,p_spki_base64 text,p_email text
) returns zatca_preparation.enrollment_requests
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; result zatca_preparation.enrollment_requests%rowtype;
  expected jsonb; stamp text; payload jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into c from public.vat_einvoice_connections where organization_id=p_org and environment=p_environment and id=p_connection for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  if p_enrollment is null or not zatca_preparation.canonical_public_base64(p_csr_der_base64)
    or not zatca_preparation.canonical_public_base64(p_spki_base64) or p_email is null
    or length(p_email)>254 or p_email !~ '^[!-~]+@[!-~]+$' then raise exception 'ENROLLMENT_INPUT_INVALID'; end if;
  stamp:=zatca_preparation.enrollment_unit_stamp(to_jsonb(c));
  expected:=jsonb_build_object('organizationId',p_org,'environment',p_environment,'unitId',c.id,'connectionId',c.id,
    'profile','ZAKATFLOW_SAN_DIRECTORY_V1','csrSha256',encode(sha256(decode(p_csr_der_base64,'base64')),'hex'),
    'kmsPublicKeySpkiBase64',p_spki_base64,'taxpayerVatNumber',c.taxpayer_vat_number,'commonName',c.common_name,
    'branchName',c.branch_name,'legalName',c.legal_name,'egsSerialNumber',c.egs_serial_number,'invoiceType',c.invoice_type,
    'branchLocation',c.branch_location,'industry',c.industry,'email',p_email);
  perform zatca_preparation.enrollment_identity_digest(expected);
  select * into result from zatca_preparation.enrollment_requests where organization_id=p_org and environment=p_environment and connection_id=p_connection;
  if found then
    if result.enrollment_id is distinct from p_enrollment or result.csr_der_base64 is distinct from p_csr_der_base64
      or result.expected_identity is distinct from expected or result.unit_stamp is distinct from stamp then raise exception 'ORIGINAL_ENROLLMENT_CHANGED'; end if;
    return result;
  end if;
  -- Preserve provenance BEFORE credentials/registry exist. No retroactive adoption
  -- of a regenerated CSR for a connection that already completed enrollment.
  if c.status is distinct from 'KEY_READY' or c.credentials_secret_arn is not null or c.kms_key_arn is null
    or exists(select 1 from zatca_preparation.signer_versions where organization_id=p_org and environment=p_environment and connection_id=p_connection)
    then raise exception 'INITIAL_ENROLLMENT_STATE_REQUIRED'; end if;
  payload:=jsonb_build_object('enrollmentId',p_enrollment,'unitStamp',stamp,'csrDerBase64',p_csr_der_base64,'expectedIdentity',expected);
  insert into zatca_preparation.enrollment_requests values(p_enrollment,p_org,p_environment,p_connection,stamp,p_csr_der_base64,expected,
    encode(sha256(convert_to(payload::text,'UTF8')),'hex'),auth.uid(),clock_timestamp()) returning * into result;
  return result;
end $$;

-- Consistency checks on evidence produced by verifyZatcaOnboardingCandidate.
-- A trusted backend must actually run that verifier with protected roots/fresh
-- CRLs and fresh KMS metadata; a shaped JSON object is NOT cryptographic proof.
create function zatca_preparation.record_enrolled_signer_candidate(
  p_org uuid,p_environment text,p_connection uuid,p_enrollment uuid,p_binding jsonb,p_evidence jsonb,p_expected_head uuid
) returns zatca_preparation.signer_versions
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; request zatca_preparation.enrollment_requests%rowtype;
  version zatca_preparation.signer_versions%rowtype; current_id uuid; linked zatca_preparation.registry_enrollments%rowtype;
  identity jsonb; path jsonb; issuer_pins jsonb; checked_at timestamptz; check_id uuid; evidence_hash text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into c from public.vat_einvoice_connections where organization_id=p_org and environment=p_environment and id=p_connection for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  select * into request from zatca_preparation.enrollment_requests where enrollment_id=p_enrollment and organization_id=p_org and environment=p_environment and connection_id=p_connection;
  if not found then raise exception 'ORIGINAL_ENROLLMENT_REQUIRED'; end if;
  if request.unit_stamp is distinct from zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) then raise exception 'ENROLLMENT_UNIT_CHANGED'; end if;
  if not zatca_preparation.signer_binding_valid(p_binding,p_org,p_environment,p_connection) then raise exception 'SIGNER_BINDING_INVALID'; end if;
  identity:=jsonb_build_object('stage','ONBOARDING_IDENTITY_PREFLIGHT_ONLY','scope',jsonb_build_object('organizationId',p_org,'environment',p_environment,'unitId',c.id,'connectionId',c.id),
    'profile',request.expected_identity->>'profile','certificateFingerprintSha256',p_binding->>'certificateFingerprintSha256',
    'expectedIdentitySha256',zatca_preparation.enrollment_identity_digest(request.expected_identity),
    'csrSha256',request.expected_identity->>'csrSha256','publicKeySpkiSha256',encode(sha256(decode(request.expected_identity->>'kmsPublicKeySpkiBase64','base64')),'hex'));
  path:=p_evidence->'path';
  if (jsonb_typeof(p_evidence)='object' and octet_length(p_evidence::text)<=32768 and p_evidence=zatca_preparation.pick_fields(p_evidence,array['stage','identity','path'])
    and p_evidence->>'stage'='ONBOARDING_CANDIDATE_ONLY' and p_evidence->'identity'=identity and jsonb_typeof(path)='object'
    and path=zatca_preparation.pick_fields(path,array['stage','environment','certificateFingerprintSha256','anchorFingerprintSha256','issuerFingerprintsSha256','crlFingerprintsSha256','checkedAt','engine'])
    and path->>'stage'='CERTIFICATE_PATH_CHECK_ONLY' and path->>'environment'=p_environment and path->>'certificateFingerprintSha256'=p_binding->>'certificateFingerprintSha256'
    and jsonb_typeof(path->'crlFingerprintsSha256')='array' and jsonb_typeof(path->'checkedAt')='string'
    and path->>'checkedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    and path->>'engine' ~ '^OpenSSL 3\.[0-9]+\.[0-9]+$') is not true then raise exception 'ENROLLMENT_EVIDENCE_INVALID'; end if;
  if jsonb_array_length(path->'crlFingerprintsSha256') not between 1 and 6 or exists(select 1 from jsonb_array_elements(path->'crlFingerprintsSha256') x
    where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$') or
    (select count(*)<>count(distinct x) from jsonb_array_elements(path->'crlFingerprintsSha256') x) then raise exception 'ENROLLMENT_EVIDENCE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_binding->'issuerChainDerBase64') x where not zatca_preparation.canonical_public_base64(x)) then raise exception 'ENROLLMENT_EVIDENCE_INVALID'; end if;
  select jsonb_agg(encode(sha256(decode(x,'base64')),'hex') order by n) into issuer_pins from jsonb_array_elements_text(p_binding->'issuerChainDerBase64') with ordinality t(x,n);
  if path->'issuerFingerprintsSha256' is distinct from issuer_pins or path->>'anchorFingerprintSha256' is distinct from issuer_pins->>(jsonb_array_length(issuer_pins)-1) then raise exception 'ENROLLMENT_EVIDENCE_INVALID'; end if;
  begin checked_at:=(path->>'checkedAt')::timestamptz; exception when others then raise exception 'ENROLLMENT_EVIDENCE_INVALID'; end;
  if checked_at < clock_timestamp()-interval '5 minutes' or checked_at > clock_timestamp()+interval '5 seconds' then raise exception 'ENROLLMENT_EVIDENCE_STALE'; end if;
  select registry_id into current_id from zatca_preparation.signer_heads where organization_id=p_org and environment=p_environment and connection_id=p_connection for update;
  version:=zatca_preparation.record_signer_candidate(p_org,p_environment,p_connection,p_binding,p_expected_head);
  select * into linked from zatca_preparation.registry_enrollments where registry_id=version.registry_id;
  if not found and version.registry_id=current_id then raise exception 'REGISTRY_ENROLLMENT_PROVENANCE_REQUIRED'; end if;
  if found and (linked.enrollment_id is distinct from request.enrollment_id or linked.enrollment_digest is distinct from request.enrollment_digest)
    then raise exception 'REGISTRY_ENROLLMENT_CONFLICT'; end if;
  evidence_hash:=encode(sha256(convert_to(p_evidence::text,'UTF8')),'hex');
  insert into zatca_preparation.enrollment_checks(registry_id,enrollment_id,evidence,evidence_digest,checked_by)
    values(version.registry_id,request.enrollment_id,p_evidence,evidence_hash,auth.uid()) on conflict(registry_id,evidence_digest) do nothing;
  select checks.check_id into check_id from zatca_preparation.enrollment_checks checks where registry_id=version.registry_id and checks.evidence_digest=evidence_hash;
  insert into zatca_preparation.registry_enrollments values(version.registry_id,request.enrollment_id,request.enrollment_digest,check_id) on conflict(registry_id) do nothing;
  return version;
end $$;

-- Capture only at original signer reservation insertion; never backfill old rows.
create function zatca_preparation.capture_enrollment_reservation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  insert into zatca_preparation.enrollment_reservations
    select new.reservation_id,new.registry_id,r.enrollment_digest,r.first_check_id from zatca_preparation.registry_enrollments r where r.registry_id=new.registry_id;
  return new;
end $$;
create trigger capture_original_enrollment after insert on zatca_preparation.reservation_signers for each row execute function zatca_preparation.capture_enrollment_reservation();
create function zatca_preparation.reserve_with_enrollment(
  p_org uuid,p_document uuid,p_environment text,p_registry uuid,p_binding_digest text,p_enrollment_digest text,p_snapshot jsonb
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare e zatca_preparation.entries%rowtype; ref zatca_preparation.enrollment_reservations%rowtype;
begin
  e:=zatca_preparation.reserve_with_signer(p_org,p_document,p_environment,p_registry,p_binding_digest,p_snapshot);
  select * into ref from zatca_preparation.enrollment_reservations where reservation_id=e.reservation_id;
  if not found then raise exception 'RESERVATION_ENROLLMENT_REQUIRED'; end if;
  if ref.registry_id is distinct from p_registry or ref.enrollment_digest is distinct from p_enrollment_digest then raise exception 'RESERVATION_ENROLLMENT_MISMATCH'; end if;
  return e;
end $$;
create function zatca_preparation.finalize_with_enrollment(
  p_org uuid,p_environment text,p_unit uuid,p_reservation uuid,p_registry uuid,p_binding_digest text,p_enrollment_digest text,
  p_credential_reference jsonb,p_snapshot_digest text,p_invoice_hash text,p_xml text
) returns zatca_preparation.entries
language plpgsql security invoker set search_path=pg_catalog as $$
declare e zatca_preparation.entries%rowtype; ref zatca_preparation.enrollment_reservations%rowtype;
  audit zatca_preparation.enrollment_finalization_audit%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into e from zatca_preparation.entries where organization_id=p_org and environment=p_environment and unit_id=p_unit and reservation_id=p_reservation;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  e:=zatca_preparation.reserve_with_enrollment(p_org,e.document_id,p_environment,p_registry,p_binding_digest,p_enrollment_digest,e.snapshot);
  select * into ref from zatca_preparation.enrollment_reservations where reservation_id=e.reservation_id;
  if e.state='PREPARED' and not exists(select 1 from zatca_preparation.enrollment_finalization_audit where reservation_id=e.reservation_id)
    then raise exception 'ENROLLMENT_FINALIZATION_AUDIT_REQUIRED'; end if;
  e:=zatca_preparation.finalize_with_signer(p_org,p_environment,p_unit,p_reservation,p_registry,p_binding_digest,p_credential_reference,p_snapshot_digest,p_invoice_hash,p_xml);
  insert into zatca_preparation.enrollment_finalization_audit values(e.reservation_id,ref.enrollment_digest,ref.first_check_id,e.prepared_at) on conflict(reservation_id) do nothing;
  select * into audit from zatca_preparation.enrollment_finalization_audit where reservation_id=e.reservation_id;
  if audit.enrollment_digest is distinct from ref.enrollment_digest or audit.first_check_id is distinct from ref.first_check_id or audit.prepared_at is distinct from e.prepared_at
    then raise exception 'ENROLLMENT_FINALIZATION_AUDIT_CONFLICT'; end if;
  return e;
end $$;
revoke all on all tables in schema zatca_preparation from public;
revoke all on all functions in schema zatca_preparation from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on all tables in schema zatca_preparation from %I',role_name);
      execute format('revoke all on all functions in schema zatca_preparation from %I',role_name);
    end if;
  end loop;
end $$;
