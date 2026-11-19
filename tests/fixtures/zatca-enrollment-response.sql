-- DISPOSABLE UNVERIFIED RESPONSE REFERENCE ONLY. Install after dispatch fence.
-- NO raw credentials/OTP/certificate, activation, authority call or live migration.
create table zatca_preparation.enrollment_response_receipts (
  dispatch_id uuid primary key references zatca_preparation.enrollment_dispatch_intents,
  reference jsonb not null, receipt_digest text not null check(receipt_digest ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table zatca_preparation.enrollment_response_receipts enable row level security;
create trigger immutable_enrollment_response before update or delete on zatca_preparation.enrollment_response_receipts
  for each row execute function zatca_preparation.guard_provenance();

create function zatca_preparation.record_enrollment_response_reference(
  p_org uuid,p_environment text,p_connection uuid,p_enrollment uuid,p_digest text,p_dispatch uuid,p_reference jsonb
) returns table(dispatch_id uuid,enrollment_id uuid,enrollment_digest text,reference jsonb,receipt_digest text,recorded_by uuid,recorded_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; request zatca_preparation.enrollment_requests%rowtype;
  intent zatca_preparation.enrollment_dispatch_intents%rowtype; receipt zatca_preparation.enrollment_response_receipts%rowtype;
  kms text[]; encryption text[]; prefix text; expected_digest text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid()
    and m.status='ACTIVE' and m.role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into c from public.vat_einvoice_connections v where v.organization_id=p_org and v.environment=p_environment and v.id=p_connection for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  select * into request from zatca_preparation.enrollment_requests e where e.organization_id=p_org
    and e.environment=p_environment and e.connection_id=p_connection and e.enrollment_id=p_enrollment;
  if not found then raise exception 'ORIGINAL_ENROLLMENT_REQUIRED'; end if;
  expected_digest:=encode(sha256(convert_to(jsonb_build_object('enrollmentId',request.enrollment_id,'unitStamp',request.unit_stamp,
    'csrDerBase64',request.csr_der_base64,'expectedIdentity',request.expected_identity)::text,'UTF8')),'hex');
  if request.enrollment_digest is distinct from expected_digest or request.enrollment_digest is distinct from p_digest
    then raise exception 'ENROLLMENT_RESPONSE_ORIGIN_MISMATCH'; end if;
  if request.unit_stamp is distinct from zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) then raise exception 'ENROLLMENT_UNIT_CHANGED'; end if;
  select * into intent from zatca_preparation.enrollment_dispatch_intents d where d.dispatch_id=p_dispatch and d.enrollment_id=request.enrollment_id;
  if not found or intent.enrollment_digest is distinct from request.enrollment_digest then raise exception 'ENROLLMENT_DISPATCH_REQUIRED'; end if;
  if jsonb_typeof(p_reference) is distinct from 'object' or octet_length(p_reference::text)>4096 then raise exception 'ENROLLMENT_RESPONSE_REFERENCE_INVALID'; end if;
  kms:=regexp_match(c.kms_key_arn,'^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$');
  encryption:=regexp_match(p_reference->>'encryptionKeyArn','^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$');
  prefix:='arn:aws:secretsmanager:'||kms[1]||':'||kms[2]||':secret:zakatflow/fatoora-enrollment/'||p_org||'/'||lower(p_environment)||'/'||p_connection||'/'||p_enrollment||'/'||p_dispatch||'-';
  if (jsonb_typeof(p_reference)='object' and p_reference=zatca_preparation.pick_fields(p_reference,
    array['version','secretArn','secretVersionId','encryptionKeyArn','responseSha256','binarySecurityTokenSha256'])
    and (select count(*) from jsonb_object_keys(p_reference))=6 and octet_length(p_reference::text)<=4096
    and not exists(select 1 from jsonb_each(p_reference) e where jsonb_typeof(e.value)<>'string')
    and p_reference->>'version'='ZATCA_ENROLLMENT_QUARANTINE_V1' and p_reference->>'secretVersionId'=p_dispatch::text
    and p_reference->>'responseSha256' ~ '^[a-f0-9]{64}$' and p_reference->>'binarySecurityTokenSha256' ~ '^[a-f0-9]{64}$'
    and kms is not null and encryption is not null and kms[1]=encryption[1] and kms[2]=encryption[2] and kms[3]<>encryption[3]
    and left(p_reference->>'secretArn',length(prefix))=prefix and substring(p_reference->>'secretArn' from length(prefix)+1) ~ '^[A-Za-z0-9]{6}$') is not true
    then raise exception 'ENROLLMENT_RESPONSE_REFERENCE_INVALID'; end if;
  expected_digest:=encode(sha256(convert_to(jsonb_build_object('dispatchId',p_dispatch,'enrollmentDigest',request.enrollment_digest,'reference',p_reference)::text,'UTF8')),'hex');
  select * into receipt from zatca_preparation.enrollment_response_receipts r where r.dispatch_id=p_dispatch;
  if found then
    if receipt.reference is distinct from p_reference or receipt.receipt_digest is distinct from expected_digest then raise exception 'ENROLLMENT_RESPONSE_REFERENCE_CHANGED'; end if;
  else
    if c.status is distinct from 'KEY_READY' or c.credentials_secret_arn is not null
      or exists(select 1 from zatca_preparation.signer_versions s where s.organization_id=p_org and s.environment=p_environment and s.connection_id=p_connection)
      then raise exception 'INITIAL_ENROLLMENT_STATE_REQUIRED'; end if;
    insert into zatca_preparation.enrollment_response_receipts(dispatch_id,reference,receipt_digest,recorded_by)
      values(p_dispatch,p_reference,expected_digest,auth.uid()) returning * into receipt;
  end if;
  return query select receipt.dispatch_id,request.enrollment_id,request.enrollment_digest,receipt.reference,receipt.receipt_digest,receipt.recorded_by,receipt.recorded_at;
end $$;
revoke all on zatca_preparation.enrollment_response_receipts from public;
revoke all on function zatca_preparation.record_enrollment_response_reference(uuid,text,uuid,uuid,text,uuid,jsonb) from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on zatca_preparation.enrollment_response_receipts from %I',role_name);
      execute format('revoke all on function zatca_preparation.record_enrollment_response_reference(uuid,text,uuid,uuid,text,uuid,jsonb) from %I',role_name);
    end if;
  end loop;
end $$;
