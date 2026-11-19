"""Disposable audited verification/pending-compliance handoff. Synthetic SQL
proof/reference fixtures only; no native/AWS/authority trust is established here.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone,timedelta
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import runpy
import unittest
import uuid
support=runpy.run_path(str(Path(__file__).with_name('zatca-enrollment-response-postgres.py')))
query,sql=support['query'],support['sql']
identity_hash=runpy.run_path(str(Path(__file__).with_name('zatca-enrollment-postgres.py')))['identity_hash']
def now(offset=0):return (datetime.now(timezone.utc)+timedelta(seconds=offset)).isoformat(timespec='milliseconds').replace('+00:00','Z')
def sha(v):return hashlib.sha256(v).hexdigest()
class Audit(unittest.TestCase):
    def setUp(self):
        self.r=support['Response']();self.r.setUp();self.receipt=self.r.record();self.f=self.r.f;self.check=str(uuid.uuid4())
        saved=self.r.original['expected_identity'];fingerprint=self.r.reference['binarySecurityTokenSha256']
        self.evidence=dict(stage='ONBOARDING_CANDIDATE_ONLY',identity=dict(stage='ONBOARDING_IDENTITY_PREFLIGHT_ONLY',
          scope=dict(organizationId=self.f.org,environment='SIMULATION',connectionId=self.f.connection,unitId=self.f.connection),profile=saved['profile'],
          certificateFingerprintSha256=fingerprint,expectedIdentitySha256=identity_hash(saved),csrSha256=saved['csrSha256'],publicKeySpkiSha256=sha(base64.b64decode(saved['kmsPublicKeySpkiBase64']))),
          path=dict(stage='CERTIFICATE_PATH_CHECK_ONLY',environment='SIMULATION',certificateFingerprintSha256=fingerprint,anchorFingerprintSha256='c'*64,
          issuerFingerprintsSha256=['c'*64],crlFingerprintsSha256=['d'*64],checkedAt=now(),engine='OpenSSL 3.0.2'))
        self.active=dict(version='ZATCA_INITIAL_CREDENTIAL_V1',secretArn='arn:aws:secretsmanager:eu-central-1:123456789012:secret:zakatflow/fatoora/'+self.f.org+'/simulation/'+self.f.connection+'-ABC123',
          secretVersionId=self.r.dispatch,certificateFingerprintSha256=fingerprint,encryptionKeyArn=self.r.reference['encryptionKeyArn'])
    def args(self,**change):
        args=dict(org=self.f.org,environment='SIMULATION',connection=self.f.connection,enrollment=self.r.enrollment,dispatch=self.r.dispatch,receipt=self.receipt['receipt_digest'],check=self.check);args.update(change);return list(args.values())
    def audit_sql(self,evidence=None,**change):return 'select row_to_json(r) from zatca_preparation.record_response_verification('+','.join(map(sql,self.args(**change)+[json.dumps(self.evidence if evidence is None else evidence)]))+') r;'
    def handoff_sql(self,active=None,**change):return 'select row_to_json(r) from zatca_preparation.record_initial_credential_handoff('+','.join(map(sql,self.args(**change)+[json.dumps(self.active if active is None else active)]))+') r;'
    def audit(self):return json.loads(query(self.f.auth()+self.audit_sql()).splitlines()[-1])
    def handoff(self):return json.loads(query(self.f.auth()+self.handoff_sql()).splitlines()[-1])
    def counts(self):return query('select (select count(*) from zatca_preparation.response_verification_audit where dispatch_id='+sql(self.r.dispatch)+')::text||\':\'||(select count(*) from zatca_preparation.initial_credential_handoffs where dispatch_id='+sql(self.r.dispatch)+')::text')
    def status(self):return query('select status from public.vat_einvoice_connections where id='+sql(self.f.connection))
    def test_records_exact_evidence_without_credential_state_change(self):
        r=self.audit();self.assertEqual(r['evidence'],self.evidence);self.assertEqual(r['recorded_by'],self.f.actor);self.assertEqual(self.status(),'KEY_READY');self.assertEqual(self.counts(),'1:0')
    def test_exact_audit_retry_keeps_first_actor_time_and_evidence(self):
        first=self.audit();actor=str(uuid.uuid4());query('insert into public.organization_members values('+','.join(map(sql,[self.f.org,actor,'OWNER','ACTIVE']))+')')
        retry=json.loads(query("select set_config('request.jwt.claim.sub',"+sql(actor)+",false);"+self.audit_sql()).splitlines()[-1]);self.assertEqual(retry,first)
    def test_changed_evidence_cannot_refresh_existing_audit(self):
        first=self.audit();v=copy.deepcopy(self.evidence);v['path']['checkedAt']=now(1)
        query(self.f.auth()+self.audit_sql(v),'ENROLLMENT_VERIFICATION_AUDIT_CHANGED');self.assertEqual(self.audit(),first)
    def test_wrong_receipt_or_scope_cannot_record(self):
        query(self.f.auth()+self.audit_sql(receipt='0'*64),'ENROLLMENT_RESPONSE_RECEIPT_CHANGED')
        query(self.f.auth()+self.audit_sql(dispatch=str(uuid.uuid4())),'ENROLLMENT_DISPATCH_REQUIRED')
        query(self.f.auth()+self.audit_sql(connection=str(uuid.uuid4())),'EINVOICE_CONNECTION_NOT_FOUND');self.assertEqual(self.counts(),'0:0')
    def test_stale_and_future_new_evidence_is_denied(self):
        for offset in [-360,60]:
            v=copy.deepcopy(self.evidence);v['path']['checkedAt']=now(offset);query(self.f.auth()+self.audit_sql(v),'ENROLLMENT_VERIFICATION_STALE')
        self.assertEqual(self.counts(),'0:0')
    def test_complete_original_identity_must_match(self):
        for field in ['expectedIdentitySha256','csrSha256','publicKeySpkiSha256','certificateFingerprintSha256']:
            v=copy.deepcopy(self.evidence);v['identity'][field]='0'*64;query(self.f.auth()+self.audit_sql(v),'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID')
        self.assertEqual(self.counts(),'0:0')
    def test_secret_extra_fields_and_wrong_stages_are_denied(self):
        for field in ['secret','binarySecurityToken','otp']:
            query(self.f.auth()+self.audit_sql({**self.evidence,field:'PRIVATE'}),'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID')
        v=copy.deepcopy(self.evidence);v['identity']['scope']['organizationId']=str(uuid.uuid4());query(self.f.auth()+self.audit_sql(v),'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID')
    def test_path_shape_duplicates_anchor_environment_and_engine_are_denied(self):
        for field,value in [('crlFingerprintsSha256',[]),('issuerFingerprintsSha256',['c'*64,'c'*64]),('anchorFingerprintSha256','0'*64),('environment','PRODUCTION'),('engine','OTHER'),('checkedAt','2026-99-99T00:00:00.000Z')]:
            v=copy.deepcopy(self.evidence);v['path'][field]=value;query(self.f.auth()+self.audit_sql(v),'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID')
    def test_concurrent_exact_audits_keep_one_record(self):
        with ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(lambda _:self.audit(),range(8)))
        self.assertEqual(len({json.dumps(r,sort_keys=True) for r in rows}),1);self.assertEqual(self.counts(),'1:0')
    def test_handoff_requires_exact_saved_check_and_receipt(self):
        query(self.f.auth()+self.handoff_sql(),'ENROLLMENT_VERIFICATION_REQUIRED');self.audit()
        query(self.f.auth()+self.handoff_sql(check=str(uuid.uuid4())),'ENROLLMENT_VERIFICATION_REQUIRED')
        query(self.f.auth()+self.handoff_sql(receipt='0'*64),'ENROLLMENT_RESPONSE_RECEIPT_CHANGED');self.assertEqual(self.status(),'KEY_READY')
    def test_handoff_sets_only_compliance_pending_and_pinned_reference(self):
        self.audit();r=self.handoff();self.assertEqual(r['state'],'COMPLIANCE_PENDING');self.assertEqual(r['active_reference'],self.active);self.assertEqual(self.status(),'COMPLIANCE_PENDING');self.assertEqual(self.counts(),'1:1')
        self.assertEqual(query('select credentials_secret_arn from public.vat_einvoice_connections where id='+sql(self.f.connection)),self.active['secretArn'])
        self.assertEqual(query('select count(*) from zatca_preparation.signer_versions where connection_id='+sql(self.f.connection)),'0')
    def test_exact_handoff_retry_preserves_first_actor_and_audit(self):
        self.audit();first=self.handoff();self.assertEqual(self.handoff(),first);self.assertEqual(self.counts(),'1:1')
        query("update public.vat_einvoice_connections set status='COMPLIANCE_PASSED' where id="+sql(self.f.connection))
        self.assertEqual(self.handoff(),first);self.assertEqual(self.status(),'COMPLIANCE_PASSED')
    def test_changed_handoff_reference_or_check_cannot_replace_first(self):
        self.audit();first=self.handoff();changed={**self.active,'secretArn':self.active['secretArn'][:-6]+'XYZ789'}
        query(self.f.auth()+self.handoff_sql(changed),'INITIAL_CREDENTIAL_HANDOFF_CHANGED');self.assertEqual(self.handoff(),first)
    def test_quarantine_or_wrong_account_version_pin_key_is_not_an_active_reference(self):
        self.audit()
        for field,value in [('secretArn',self.r.reference['secretArn']),('secretArn',self.active['secretArn'].replace('123456789012','000000000000')),
          ('secretVersionId',str(uuid.uuid4())),('certificateFingerprintSha256','0'*64),('encryptionKeyArn',self.r.key)]:
            query(self.f.auth()+self.handoff_sql({**self.active,field:value}),'INITIAL_CREDENTIAL_REFERENCE_INVALID')
        self.assertEqual(self.status(),'KEY_READY');self.assertEqual(self.counts(),'1:0')
    def test_raw_credential_extra_keys_are_denied(self):
        self.audit()
        for key in ['secret','binarySecurityToken','otp']:
            query(self.f.auth()+self.handoff_sql({**self.active,key:'PRIVATE'}),'INITIAL_CREDENTIAL_REFERENCE_INVALID')
    def test_stale_persisted_proof_cannot_authorize_first_handoff(self):
        self.audit();v=copy.deepcopy(self.evidence);v['path']['checkedAt']=now(-360)
        patch="update zatca_preparation.response_verification_audit set evidence="+sql(json.dumps(v))+"::jsonb,verification_digest=encode(sha256(convert_to(jsonb_build_object('checkId',check_id,'dispatchId',dispatch_id,'receiptDigest',receipt_digest,'evidence',"+sql(json.dumps(v))+"::jsonb)::text,'UTF8')),'hex') where check_id="+sql(self.check)+';'
        query('begin;alter table zatca_preparation.response_verification_audit disable trigger immutable_response_verification;'+patch+self.f.auth()+self.handoff_sql(),'ENROLLMENT_VERIFICATION_STALE')
        self.assertEqual(self.status(),'KEY_READY');self.assertEqual(self.counts(),'1:0')
    def test_changed_connection_state_is_never_repaired_by_retry(self):
        self.audit();self.handoff();query("update public.vat_einvoice_connections set credentials_secret_arn='OTHER' where id="+sql(self.f.connection))
        query(self.f.auth()+self.handoff_sql(),'INITIAL_CREDENTIAL_STATE_CHANGED');self.assertEqual(self.counts(),'1:1')
    def test_null_connection_state_is_not_accepted_on_retry(self):
        self.audit();self.handoff();query('update public.vat_einvoice_connections set status=null where id='+sql(self.f.connection))
        query(self.f.auth()+self.handoff_sql(),'INITIAL_CREDENTIAL_STATE_CHANGED')
    def test_no_subject_or_revoked_member_can_write_audit_or_handoff(self):
        query(self.audit_sql(),'UNAUTHORIZED');self.audit();query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        query(self.f.auth()+self.audit_sql(),'ORGANIZATION_ADMIN_REQUIRED');query(self.f.auth()+self.handoff_sql(),'ORGANIZATION_ADMIN_REQUIRED');self.assertEqual(self.status(),'KEY_READY')
    def test_changed_unit_blocks_audit_and_handoff(self):
        self.audit();query("update public.vat_einvoice_connections set common_name='Changed saved EGS' where id="+sql(self.f.connection))
        query(self.f.auth()+self.audit_sql(),'ENROLLMENT_UNIT_CHANGED');query(self.f.auth()+self.handoff_sql(),'ENROLLMENT_UNIT_CHANGED')
    def test_audit_and_handoff_are_immutable(self):
        self.audit();self.handoff()
        for table,where in [('response_verification_audit','check_id='+sql(self.check)),('initial_credential_handoffs','dispatch_id='+sql(self.r.dispatch))]:
            query('delete from zatca_preparation.'+table+' where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')
            query('update zatca_preparation.'+table+' set recorded_at=now() where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')
    def test_handoff_transaction_rollback_preserves_key_ready(self):
        self.audit();query('begin;'+self.f.auth()+self.handoff_sql()+'rollback;');self.assertEqual(self.status(),'KEY_READY');self.assertEqual(self.counts(),'1:0')
    def test_failed_handoff_audit_insert_rolls_back_the_connection_update(self):
        self.audit()
        trigger="create function zatca_preparation.qa_handoff_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_HANDOFF_WRITE_FAIL';end$$;create trigger qa_handoff_failure after insert on zatca_preparation.initial_credential_handoffs for each row execute function zatca_preparation.qa_handoff_failure();"
        query('begin;'+trigger+self.f.auth()+self.handoff_sql(),'SYNTHETIC_HANDOFF_WRITE_FAIL');self.assertEqual(self.status(),'KEY_READY');self.assertEqual(self.counts(),'1:0')
    def test_concurrent_exact_handoffs_write_one_audit(self):
        self.audit()
        with ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(lambda _:self.handoff(),range(8)))
        self.assertEqual(len({json.dumps(r,sort_keys=True) for r in rows}),1);self.assertEqual(self.counts(),'1:1')
    def test_private_rls_invoker_application_grants_and_fk_indexes(self):
        for table in ['response_verification_audit','initial_credential_handoffs']:
            self.assertEqual(query("select relrowsecurity from pg_class where oid="+sql('zatca_preparation.'+table)+"::regclass"),'t')
            for role in ['anon','authenticated','service_role']:
                self.assertEqual(query('select has_table_privilege('+sql(role)+','+sql('zatca_preparation.'+table)+",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')"),'f')
        for function in ['lock_response_snapshot(uuid,text,uuid,uuid,uuid,text)','response_evidence_valid(jsonb,uuid,text,uuid,jsonb)','record_response_verification(uuid,text,uuid,uuid,uuid,text,uuid,jsonb)','record_initial_credential_handoff(uuid,text,uuid,uuid,uuid,text,uuid,jsonb)']:
            self.assertEqual(query('select prosecdef from pg_proc where oid='+sql('zatca_preparation.'+function)+'::regprocedure'),'f')
            for role in ['anon','authenticated','service_role']:self.assertEqual(query('select has_function_privilege('+sql(role)+','+sql('zatca_preparation.'+function)+",'EXECUTE')"),'f')
        self.assertEqual(query("select count(*) from pg_index where indexrelid in ('zatca_preparation.response_verification_dispatch_idx'::regclass,'zatca_preparation.initial_credential_handoff_check_idx'::regclass)"),'2')
if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':raise SystemExit('Disposable ledger QA database required')
    query('alter default privileges in schema zatca_preparation grant all on tables to anon,authenticated,service_role;alter default privileges in schema zatca_preparation grant execute on functions to anon,authenticated,service_role;')
    query(Path(__file__).with_name('fixtures').joinpath('zatca-enrollment-verification-audit.sql').read_text())
    query('alter default privileges in schema zatca_preparation revoke all on tables from anon,authenticated,service_role;alter default privileges in schema zatca_preparation revoke all on functions from anon,authenticated,service_role;')
    unittest.main(verbosity=2)
