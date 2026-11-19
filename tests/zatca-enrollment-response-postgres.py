"""Disposable unverified opaque response references. No AWS/authority calls.
Run after dispatch QA, before native integration and application grants.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import runpy
import unittest
import uuid
support=runpy.run_path(str(Path(__file__).with_name('zatca-source-freeze-postgres.py')))
query,sql=support['query'],support['sql']

class Response(unittest.TestCase):
    def setUp(self):
        self.f=support['SourceFreeze']();self.f.setUp();self.enrollment=str(uuid.uuid4());self.dispatch=str(uuid.uuid4())
        self.key='arn:aws:kms:eu-central-1:123456789012:key/'+str(uuid.uuid4())
        query("update public.vat_einvoice_connections set status='KEY_READY',credentials_secret_arn=null,kms_key_arn="+sql(self.key)+' where id='+sql(self.f.connection))
        self.original=json.loads(query(self.f.auth()+"select row_to_json(r) from zatca_preparation.begin_initial_enrollment("
          +','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,self.enrollment,'MAA=','MAA=','qa@example.invalid']))+") r").splitlines()[-1])
        self.claim()
        self.reference=dict(version='ZATCA_ENROLLMENT_QUARANTINE_V1',secretVersionId=self.dispatch,
          secretArn='arn:aws:secretsmanager:eu-central-1:123456789012:secret:zakatflow/fatoora-enrollment/'+self.f.org+'/simulation/'+self.f.connection+'/'+self.enrollment+'/'+self.dispatch+'-ABC123',
          encryptionKeyArn='arn:aws:kms:eu-central-1:123456789012:key/'+str(uuid.uuid4()),responseSha256='a'*64,binarySecurityTokenSha256='b'*64)
    def claim(self):
        args=[self.f.org,'SIMULATION',self.f.connection,self.enrollment,self.original['enrollment_digest'],self.dispatch]
        query(self.f.auth()+'select * from zatca_preparation.claim_initial_enrollment_dispatch('+','.join(map(sql,args))+')')
    def record_sql(self,reference=None,**change):
        args=dict(org=self.f.org,environment='SIMULATION',connection=self.f.connection,enrollment=self.enrollment,digest=self.original['enrollment_digest'],dispatch=self.dispatch)
        args.update(change);values=list(args.values())+[json.dumps(self.reference if reference is None else reference)]
        return 'select row_to_json(r) from zatca_preparation.record_enrollment_response_reference('+','.join(map(sql,values))+') r;'
    def record(self): return json.loads(query(self.f.auth()+self.record_sql()).splitlines()[-1])
    def count(self): return query('select count(*) from zatca_preparation.enrollment_response_receipts where dispatch_id='+sql(self.dispatch))
    def test_records_reference_only_without_activating_credentials(self):
        r=self.record();self.assertEqual(r['reference'],self.reference);self.assertEqual(r['recorded_by'],self.f.actor)
        self.assertEqual(query('select status from public.vat_einvoice_connections where id='+sql(self.f.connection)),'KEY_READY')
        self.assertEqual(query('select credentials_secret_arn is null from public.vat_einvoice_connections where id='+sql(self.f.connection)),'t')
    def test_exact_retry_preserves_first_actor_time_and_digest(self):
        first=self.record();self.assertEqual(self.record(),first);self.assertEqual(self.count(),'1')
        actor=str(uuid.uuid4());query('insert into public.organization_members values('+','.join(map(sql,[self.f.org,actor,'OWNER','ACTIVE']))+')')
        retry=json.loads(query("select set_config('request.jwt.claim.sub',"+sql(actor)+",false);"+self.record_sql()).splitlines()[-1]);self.assertEqual(retry,first)
    def test_eight_simultaneous_records_do_not_duplicate(self):
        with ThreadPoolExecutor(max_workers=8) as pool: rows=list(pool.map(lambda _:self.record(),range(8)))
        self.assertEqual(len({json.dumps(r,sort_keys=True) for r in rows}),1);self.assertEqual(self.count(),'1')
    def test_changed_reference_cannot_replace_original(self):
        first=self.record()
        for field in ['responseSha256','binarySecurityTokenSha256']:
            bad={**self.reference,field:'c'*64};query(self.f.auth()+self.record_sql(bad),'ENROLLMENT_RESPONSE_REFERENCE_CHANGED')
        self.assertEqual(self.record(),first)
    def test_rejects_raw_secret_and_unexpected_reference_keys(self):
        for field in ['secret','binarySecurityToken','otp','actorId']:
            query(self.f.auth()+self.record_sql({**self.reference,field:'PRIVATE'}),'ENROLLMENT_RESPONSE_REFERENCE_INVALID')
        self.assertEqual(self.count(),'0')
    def test_rejects_wrong_version_key_account_and_path(self):
        for field,value in [('secretVersionId',str(uuid.uuid4())),('version','OTHER'),('responseSha256','bad'),('encryptionKeyArn',self.key),
          ('encryptionKeyArn',self.reference['encryptionKeyArn'].replace('123456789012','000000000000')),
          ('secretArn',self.reference['secretArn'].replace('/simulation/','/production/')),('secretArn',self.reference['secretArn']+'EXTRA')]:
            query(self.f.auth()+self.record_sql({**self.reference,field:value}),'ENROLLMENT_RESPONSE_REFERENCE_INVALID')
        self.assertEqual(self.count(),'0')
    def test_missing_dispatch_or_wrong_origin_is_rejected(self):
        query(self.f.auth()+self.record_sql(dispatch=str(uuid.uuid4())),'ENROLLMENT_DISPATCH_REQUIRED')
        query(self.f.auth()+self.record_sql(digest='0'*64),'ENROLLMENT_RESPONSE_ORIGIN_MISMATCH')
        query(self.f.auth()+self.record_sql(enrollment=str(uuid.uuid4())),'ORIGINAL_ENROLLMENT_REQUIRED');self.assertEqual(self.count(),'0')
    def test_missing_actor_revoked_role_and_cross_scope_are_denied(self):
        query(self.record_sql(),'UNAUTHORIZED')
        query(self.f.auth()+self.record_sql(connection=str(uuid.uuid4())),'EINVOICE_CONNECTION_NOT_FOUND')
        query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        query(self.f.auth()+self.record_sql(),'ORGANIZATION_ADMIN_REQUIRED');self.assertEqual(self.count(),'0')
    def test_changed_unit_blocks_recording_and_retry(self):
        self.record();query("update public.vat_einvoice_connections set common_name='Changed' where id="+sql(self.f.connection))
        query(self.f.auth()+self.record_sql(),'ENROLLMENT_UNIT_CHANGED');self.assertEqual(self.count(),'1')
    def test_no_backfill_after_credentials_but_exact_record_retry_is_allowed(self):
        first=self.record();query("update public.vat_einvoice_connections set status='COMPLIANCE_PASSED',credentials_secret_arn='SYNTHETIC' where id="+sql(self.f.connection))
        self.assertEqual(self.record(),first)
        other=Response();other.setUp();query("update public.vat_einvoice_connections set credentials_secret_arn='SYNTHETIC' where id="+sql(other.f.connection))
        query(other.f.auth()+other.record_sql(),'INITIAL_ENROLLMENT_STATE_REQUIRED');self.assertEqual(other.count(),'0')
    def test_immutable_and_atomic_rollback(self):
        query('begin;'+self.f.auth()+self.record_sql()+'rollback;');self.assertEqual(self.count(),'0');self.record()
        where=' where dispatch_id='+sql(self.dispatch)
        query('delete from zatca_preparation.enrollment_response_receipts'+where,'PREPARATION_PROVENANCE_IMMUTABLE')
        query("update zatca_preparation.enrollment_response_receipts set receipt_digest='"+'0'*64+"'"+where,'PREPARATION_PROVENANCE_IMMUTABLE')
    def test_private_invoker_rls_and_explicit_application_grants(self):
        self.assertEqual(query("select relrowsecurity from pg_class where oid='zatca_preparation.enrollment_response_receipts'::regclass"),'t')
        self.assertEqual(query("select prosecdef from pg_proc where oid='zatca_preparation.record_enrollment_response_reference(uuid,text,uuid,uuid,text,uuid,jsonb)'::regprocedure"),'f')
        for role in ['anon','authenticated','service_role']:
            self.assertEqual(query('select has_table_privilege('+sql(role)+",'zatca_preparation.enrollment_response_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')"),'f')
            self.assertEqual(query('select has_function_privilege('+sql(role)+",'zatca_preparation.record_enrollment_response_reference(uuid,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')"),'f')

if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa': raise SystemExit('Disposable ledger QA database required')
    query("alter default privileges in schema zatca_preparation grant all on tables to anon,authenticated,service_role;alter default privileges in schema zatca_preparation grant execute on functions to anon,authenticated,service_role;")
    query(Path(__file__).with_name('fixtures').joinpath('zatca-enrollment-response.sql').read_text())
    query("alter default privileges in schema zatca_preparation revoke all on tables from anon,authenticated,service_role;alter default privileges in schema zatca_preparation revoke all on functions from anon,authenticated,service_role;")
    unittest.main(verbosity=2)
