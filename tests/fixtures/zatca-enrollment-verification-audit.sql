-- DISPOSABLE VERIFICATION AUDIT / INITIAL CREDENTIAL HANDOFF CANDIDATE ONLY.
-- Install after response receipts. No native/AWS trust proof, live migration,
-- authority compliance approval, signer registry write or invoice activation.
create table zatca_preparation.response_verification_audit (
  check_id uuid primary key, dispatch_id uuid not null references zatca_preparation.enrollment_dispatch_intents,
  receipt_digest text not null, evidence jsonb not null, verification_digest text not null,
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
create index response_verification_dispatch_idx on zatca_preparation.response_verification_audit(dispatch_id);
create table zatca_preparation.initial_credential_handoffs (
  dispatch_id uuid primary key references zatca_preparation.enrollment_dispatch_intents,
  check_id uuid not null references zatca_preparation.response_verification_audit,
  receipt_digest text not null, active_reference jsonb not null, handoff_digest text not null,
  state text not null default 'COMPLIANCE_PENDING' check(state='COMPLIANCE_PENDING'),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
create index initial_credential_handoff_check_idx on zatca_preparation.initial_credential_handoffs(check_id);
alter table zatca_preparation.response_verification_audit enable row level security;
alter table zatca_preparation.initial_credential_handoffs enable row level security;
create trigger immutable_response_verification before update or delete on zatca_preparation.response_verification_audit
  for each row execute function zatca_preparation.guard_provenance();
create trigger immutable_initial_handoff before update or delete on zatca_preparation.initial_credential_handoffs
  for each row execute function zatca_preparation.guard_provenance();

-- Shared private locked consistency snapshot. No crypto/storage trust is implied.
create function zatca_preparation.lock_response_snapshot(p_org uuid,p_env text,p_connection uuid,p_enrollment uuid,p_dispatch uuid,p_receipt_digest text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; e zatca_preparation.enrollment_requests%rowtype;
  d zatca_preparation.enrollment_dispatch_intents%rowtype; r zatca_preparation.enrollment_response_receipts%rowtype; hash text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into c from public.vat_einvoice_connections v where v.organization_id=p_org and v.environment=p_env and v.id=p_connection for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  select * into e from zatca_preparation.enrollment_requests v where v.organization_id=p_org and v.environment=p_env and v.connection_id=p_connection and v.enrollment_id=p_enrollment;
  if not found then raise exception 'ORIGINAL_ENROLLMENT_REQUIRED'; end if;
  hash:=encode(sha256(convert_to(jsonb_build_object('enrollmentId',e.enrollment_id,'unitStamp',e.unit_stamp,'csrDerBase64',e.csr_der_base64,'expectedIdentity',e.expected_identity)::text,'UTF8')),'hex');
  if e.enrollment_digest is distinct from hash then raise exception 'ENROLLMENT_RESPONSE_ORIGIN_MISMATCH'; end if;
  if e.unit_stamp is distinct from zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) then raise exception 'ENROLLMENT_UNIT_CHANGED'; end if;
  select * into d from zatca_preparation.enrollment_dispatch_intents v where v.dispatch_id=p_dispatch and v.enrollment_id=e.enrollment_id;
  if not found or d.enrollment_digest is distinct from e.enrollment_digest then raise exception 'ENROLLMENT_DISPATCH_REQUIRED'; end if;
  select * into r from zatca_preparation.enrollment_response_receipts v where v.dispatch_id=d.dispatch_id;
  if not found then raise exception 'ENROLLMENT_RESPONSE_REFERENCE_REQUIRED'; end if;
  hash:=encode(sha256(convert_to(jsonb_build_object('dispatchId',d.dispatch_id,'enrollmentDigest',e.enrollment_digest,'reference',r.reference)::text,'UTF8')),'hex');
  if r.receipt_digest is distinct from hash or (p_receipt_digest is not null and r.receipt_digest is distinct from p_receipt_digest)
    then raise exception 'ENROLLMENT_RESPONSE_RECEIPT_CHANGED'; end if;
  return jsonb_build_object('enrollmentDigest',e.enrollment_digest,'receiptDigest',r.receipt_digest,'identity',e.expected_identity,'reference',r.reference,
    'kmsKeyArn',c.kms_key_arn,'status',c.status,'credentialsSecretArn',c.credentials_secret_arn);
end $$;

create function zatca_preparation.response_evidence_valid(s jsonb,p_org uuid,p_env text,p_connection uuid,v jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare identity jsonb; path jsonb; expected jsonb; a jsonb;
begin
  if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>32768
    or v is distinct from zatca_preparation.pick_fields(v,array['stage','identity','path']) or v->>'stage' is distinct from 'ONBOARDING_CANDIDATE_ONLY'
    then return false; end if;
  identity:=s->'identity';path:=v->'path';
  expected:=jsonb_build_object('stage','ONBOARDING_IDENTITY_PREFLIGHT_ONLY','scope',jsonb_build_object('organizationId',p_org,'environment',p_env,'unitId',p_connection,'connectionId',p_connection),
    'profile',identity->>'profile','certificateFingerprintSha256',s->'reference'->>'binarySecurityTokenSha256',
    'expectedIdentitySha256',zatca_preparation.enrollment_identity_digest(identity),'csrSha256',identity->>'csrSha256',
    'publicKeySpkiSha256',encode(sha256(decode(identity->>'kmsPublicKeySpkiBase64','base64')),'hex'));
  if v->'identity' is distinct from expected or jsonb_typeof(path) is distinct from 'object' then return false; end if;
  if (path=zatca_preparation.pick_fields(path,array['stage','environment','certificateFingerprintSha256','anchorFingerprintSha256','issuerFingerprintsSha256','crlFingerprintsSha256','checkedAt','engine'])
    and (select count(*) from jsonb_object_keys(path))=8 and path->>'stage'='CERTIFICATE_PATH_CHECK_ONLY' and path->>'environment'=p_env
    and path->>'certificateFingerprintSha256'=s->'reference'->>'binarySecurityTokenSha256' and path->>'anchorFingerprintSha256' ~ '^[a-f0-9]{64}$'
    and path->>'checkedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    and path->>'engine' ~ '^OpenSSL 3\.[0-9]+\.[0-9]+$') is not true then return false; end if;
  if jsonb_typeof(path->'issuerFingerprintsSha256') is distinct from 'array' or jsonb_typeof(path->'crlFingerprintsSha256') is distinct from 'array' then return false; end if;
  if jsonb_array_length(path->'issuerFingerprintsSha256') not between 1 and 5 or jsonb_array_length(path->'crlFingerprintsSha256') not between 1 and 6 then return false; end if;
  foreach a in array array[path->'issuerFingerprintsSha256',path->'crlFingerprintsSha256'] loop
    if exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$')
      or (select count(*)<>count(distinct x) from jsonb_array_elements(a) x) then return false; end if;
  end loop;
  if path->>'anchorFingerprintSha256' is distinct from path->'issuerFingerprintsSha256'->>-1 then return false; end if;
  perform (path->>'checkedAt')::timestamptz;
  return true;
exception when others then return false;
end $$;

create function zatca_preparation.record_response_verification(p_org uuid,p_env text,p_connection uuid,p_enrollment uuid,p_dispatch uuid,p_receipt_digest text,p_check uuid,p_evidence jsonb)
returns zatca_preparation.response_verification_audit language plpgsql security invoker set search_path=pg_catalog as $$
declare s jsonb; r zatca_preparation.response_verification_audit%rowtype; hash text; checked_at timestamptz;
begin
  s:=zatca_preparation.lock_response_snapshot(p_org,p_env,p_connection,p_enrollment,p_dispatch,p_receipt_digest);
  if p_check is null or p_receipt_digest is null then raise exception 'ENROLLMENT_VERIFICATION_INPUT_INVALID'; end if;
  if not zatca_preparation.response_evidence_valid(s,p_org,p_env,p_connection,p_evidence) then raise exception 'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID'; end if;
  hash:=encode(sha256(convert_to(jsonb_build_object('checkId',p_check,'dispatchId',p_dispatch,'receiptDigest',p_receipt_digest,'evidence',p_evidence)::text,'UTF8')),'hex');
  select * into r from zatca_preparation.response_verification_audit a where a.check_id=p_check;
  if found then
    if r.dispatch_id is distinct from p_dispatch or r.receipt_digest is distinct from p_receipt_digest or r.evidence is distinct from p_evidence or r.verification_digest is distinct from hash
      then raise exception 'ENROLLMENT_VERIFICATION_AUDIT_CHANGED'; end if;
    return r;
  end if;
  checked_at:=(p_evidence->'path'->>'checkedAt')::timestamptz;
  if checked_at<clock_timestamp()-interval '5 minutes' or checked_at>clock_timestamp()+interval '5 seconds' then raise exception 'ENROLLMENT_VERIFICATION_STALE'; end if;
  if s->>'status' is distinct from 'KEY_READY' or s->>'credentialsSecretArn' is not null
    or exists(select 1 from zatca_preparation.signer_versions v where v.organization_id=p_org and v.environment=p_env and v.connection_id=p_connection)
    then raise exception 'INITIAL_ENROLLMENT_STATE_REQUIRED'; end if;
  insert into zatca_preparation.response_verification_audit(check_id,dispatch_id,receipt_digest,evidence,verification_digest,recorded_by)
    values(p_check,p_dispatch,p_receipt_digest,p_evidence,hash,auth.uid()) returning * into r;
  return r;
end $$;

-- Strict, opaque initial-credential handoff only. Protected backend must create
-- and verify the exact active secret version first; SQL does not contact AWS.
create function zatca_preparation.record_initial_credential_handoff(p_org uuid,p_env text,p_connection uuid,p_enrollment uuid,p_dispatch uuid,p_receipt_digest text,p_check uuid,p_active jsonb)
returns zatca_preparation.initial_credential_handoffs language plpgsql security invoker set search_path=pg_catalog as $$
declare s jsonb; v zatca_preparation.response_verification_audit%rowtype; r zatca_preparation.initial_credential_handoffs%rowtype;
  hash text; key text[]; prefix text; checked_at timestamptz;
begin
  s:=zatca_preparation.lock_response_snapshot(p_org,p_env,p_connection,p_enrollment,p_dispatch,p_receipt_digest);
  if p_check is null or p_receipt_digest is null then raise exception 'ENROLLMENT_VERIFICATION_INPUT_INVALID'; end if;
  select * into v from zatca_preparation.response_verification_audit a where a.check_id=p_check and a.dispatch_id=p_dispatch;
  if not found or v.receipt_digest is distinct from p_receipt_digest then raise exception 'ENROLLMENT_VERIFICATION_REQUIRED'; end if;
  hash:=encode(sha256(convert_to(jsonb_build_object('checkId',v.check_id,'dispatchId',v.dispatch_id,'receiptDigest',v.receipt_digest,'evidence',v.evidence)::text,'UTF8')),'hex');
  if v.verification_digest is distinct from hash or not zatca_preparation.response_evidence_valid(s,p_org,p_env,p_connection,v.evidence) then raise exception 'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID'; end if;
  if jsonb_typeof(p_active) is distinct from 'object' or octet_length(p_active::text)>4096 then raise exception 'INITIAL_CREDENTIAL_REFERENCE_INVALID'; end if;
  key:=regexp_match(s->>'kmsKeyArn','^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$');
  prefix:='arn:aws:secretsmanager:'||key[1]||':'||key[2]||':secret:zakatflow/fatoora/'||p_org||'/'||lower(p_env)||'/'||p_connection||'-';
  if (p_active=zatca_preparation.pick_fields(p_active,array['version','secretArn','secretVersionId','certificateFingerprintSha256','encryptionKeyArn'])
    and (select count(*) from jsonb_object_keys(p_active))=5 and not exists(select 1 from jsonb_each(p_active) e where jsonb_typeof(e.value)<>'string')
    and p_active->>'version'='ZATCA_INITIAL_CREDENTIAL_V1' and p_active->>'secretVersionId'=p_dispatch::text
    and p_active->>'certificateFingerprintSha256'=s->'reference'->>'binarySecurityTokenSha256'
    and p_active->>'encryptionKeyArn'=s->'reference'->>'encryptionKeyArn' and key is not null
    and left(p_active->>'secretArn',length(prefix))=prefix and substring(p_active->>'secretArn' from length(prefix)+1) ~ '^[A-Za-z0-9]{6}$') is not true
    then raise exception 'INITIAL_CREDENTIAL_REFERENCE_INVALID'; end if;
  hash:=encode(sha256(convert_to(jsonb_build_object('dispatchId',p_dispatch,'checkId',p_check,'receiptDigest',p_receipt_digest,'activeReference',p_active)::text,'UTF8')),'hex');
  select * into r from zatca_preparation.initial_credential_handoffs a where a.dispatch_id=p_dispatch;
  if found then
    if r.check_id is distinct from p_check or r.receipt_digest is distinct from p_receipt_digest or r.active_reference is distinct from p_active or r.handoff_digest is distinct from hash
      then raise exception 'INITIAL_CREDENTIAL_HANDOFF_CHANGED'; end if;
    if s->>'credentialsSecretArn' is distinct from p_active->>'secretArn' or (s->>'status' in ('COMPLIANCE_PENDING','COMPLIANCE_PASSED')) is not true
      then raise exception 'INITIAL_CREDENTIAL_STATE_CHANGED'; end if;
    return r;
  end if;
  checked_at:=(v.evidence->'path'->>'checkedAt')::timestamptz;
  if checked_at<clock_timestamp()-interval '5 minutes' or checked_at>clock_timestamp()+interval '5 seconds' then raise exception 'ENROLLMENT_VERIFICATION_STALE'; end if;
  if s->>'status' is distinct from 'KEY_READY' or s->>'credentialsSecretArn' is not null
    or exists(select 1 from zatca_preparation.signer_versions a where a.organization_id=p_org and a.environment=p_env and a.connection_id=p_connection)
    then raise exception 'INITIAL_ENROLLMENT_STATE_REQUIRED'; end if;
  update public.vat_einvoice_connections set status='COMPLIANCE_PENDING',credentials_secret_arn=p_active->>'secretArn'
    where organization_id=p_org and environment=p_env and id=p_connection;
  insert into zatca_preparation.initial_credential_handoffs(dispatch_id,check_id,receipt_digest,active_reference,handoff_digest,recorded_by)
    values(p_dispatch,p_check,p_receipt_digest,p_active,hash,auth.uid()) returning * into r;
  return r;
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
