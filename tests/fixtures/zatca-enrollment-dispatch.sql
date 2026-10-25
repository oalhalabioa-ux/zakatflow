-- DISPOSABLE ONE-SHOT DISPATCH INTENT ONLY. Install after enrollment-provenance.
-- No authority call, secret/OTP storage, recovery/reset, worker grant or live migration.
create table zatca_preparation.enrollment_dispatch_intents (
  dispatch_id uuid primary key,
  enrollment_id uuid not null unique references zatca_preparation.enrollment_requests,
  enrollment_digest text not null check(enrollment_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'INTENT_RECORDED' check(state='INTENT_RECORDED'),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table zatca_preparation.enrollment_dispatch_intents enable row level security;
create trigger immutable_enrollment_dispatch before update or delete on zatca_preparation.enrollment_dispatch_intents
  for each row execute function zatca_preparation.guard_provenance();

create function zatca_preparation.claim_initial_enrollment_dispatch(
  p_org uuid,p_environment text,p_connection uuid,p_enrollment uuid,p_digest text,p_dispatch uuid
) returns table(acquired boolean,dispatch_id uuid,enrollment_id uuid,enrollment_digest text,
  organization_id uuid,environment text,connection_id uuid,state text,recorded_by uuid,recorded_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.vat_einvoice_connections%rowtype; request zatca_preparation.enrollment_requests%rowtype;
  intent zatca_preparation.enrollment_dispatch_intents%rowtype; fresh boolean:=false; actual_digest text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid()
    and m.status='ACTIVE' and m.role in ('OWNER','ADMIN') for share;
  if not found then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
  select * into c from public.vat_einvoice_connections v where v.organization_id=p_org and v.environment=p_environment and v.id=p_connection for update;
  if not found then raise exception 'EINVOICE_CONNECTION_NOT_FOUND'; end if;
  if p_dispatch is null or p_enrollment is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    then raise exception 'ENROLLMENT_DISPATCH_INPUT_INVALID'; end if;
  select * into request from zatca_preparation.enrollment_requests e where e.organization_id=p_org
    and e.environment=p_environment and e.connection_id=p_connection and e.enrollment_id=p_enrollment;
  if not found then raise exception 'ORIGINAL_ENROLLMENT_REQUIRED'; end if;
  actual_digest:=encode(sha256(convert_to(jsonb_build_object('enrollmentId',request.enrollment_id,'unitStamp',request.unit_stamp,
    'csrDerBase64',request.csr_der_base64,'expectedIdentity',request.expected_identity)::text,'UTF8')),'hex');
  if request.enrollment_digest is distinct from actual_digest then raise exception 'ENROLLMENT_DISPATCH_INTEGRITY_INVALID'; end if;
  if request.enrollment_digest is distinct from p_digest then raise exception 'ENROLLMENT_DISPATCH_DIGEST_MISMATCH'; end if;
  if request.unit_stamp is distinct from zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) then raise exception 'ENROLLMENT_UNIT_CHANGED'; end if;
  select * into intent from zatca_preparation.enrollment_dispatch_intents d where d.enrollment_id=request.enrollment_id;
  if found then
    if intent.dispatch_id is distinct from p_dispatch or intent.enrollment_digest is distinct from request.enrollment_digest
      then raise exception 'ENROLLMENT_DISPATCH_CHANGED'; end if;
  else
    if c.status is distinct from 'KEY_READY' or c.credentials_secret_arn is not null or c.kms_key_arn is null
      or exists(select 1 from zatca_preparation.signer_versions s where s.organization_id=p_org and s.environment=p_environment and s.connection_id=p_connection)
      then raise exception 'INITIAL_ENROLLMENT_STATE_REQUIRED'; end if;
    insert into zatca_preparation.enrollment_dispatch_intents(dispatch_id,enrollment_id,enrollment_digest,recorded_by)
      values(p_dispatch,request.enrollment_id,request.enrollment_digest,auth.uid()) returning * into intent;
    fresh:=true;
  end if;
  return query select fresh,intent.dispatch_id,intent.enrollment_id,intent.enrollment_digest,p_org,p_environment,p_connection,
    intent.state,intent.recorded_by,intent.recorded_at;
end $$;
revoke all on zatca_preparation.enrollment_dispatch_intents from public;
revoke all on function zatca_preparation.claim_initial_enrollment_dispatch(uuid,text,uuid,uuid,text,uuid) from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on zatca_preparation.enrollment_dispatch_intents from %I',role_name);
      execute format('revoke all on function zatca_preparation.claim_initial_enrollment_dispatch(uuid,text,uuid,uuid,text,uuid) from %I',role_name);
    end if;
  end loop;
end $$;
