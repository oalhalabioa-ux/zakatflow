"""Owner-only initial enrollment persistence contract; synthetic SQL evidence.
Run after registry QA, before native enrollment round trip and app permissions.
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
support=runpy.run_path(str(Path(__file__).with_name('zatca-source-freeze-postgres.py')))
query,sql=support['query'],support['sql']

def now(offset=0):
    return (datetime.now(timezone.utc)+timedelta(seconds=offset)).isoformat(timespec='milliseconds').replace('+00:00','Z')
def sha(value): return hashlib.sha256(value).hexdigest()
def identity_hash(value):
    return sha(b''.join(len(s.encode()).to_bytes(4,'big')+s.encode() for k in sorted(value) for s in [k,value[k]]))

class Enrollment(unittest.TestCase):
    def setUp(self):
        self.f=support['SourceFreeze']();self.f.setUp();self.enrollment_id=str(uuid.uuid4())
        self.csr=base64.b64encode(b'SYNTHETIC_NOT_A_SIGNED_CSR').decode();self.spki=base64.b64encode(b'SYNTHETIC_NOT_A_PUBLIC_KEY').decode()
        self.binding=dict(version='ZATCA_SAVED_SIGNER_V1',organizationId=self.f.org,environment='SIMULATION',unitId=self.f.connection,connectionId=self.f.connection,
          kmsKeyArn='arn:aws:kms:eu-central-1:123456789012:key/'+str(uuid.uuid4()),
          secretArn='arn:aws:secretsmanager:eu-central-1:123456789012:secret:zakatflow/fatoora/'+self.f.org+'/simulation/'+self.f.connection+'-ABC123',
          secretVersionId=str(uuid.uuid4()),certificateFingerprintSha256='a'*64,issuerChainDerBase64=[base64.b64encode(b'SYNTHETIC_ISSUER').decode()],
          policy=dict(identifier='https://example.invalid/synthetic-policy',digestSha256Base64='A'*43+'='),includeSimplifiedQr=False)
        query('update public.vat_einvoice_connections set status=\'KEY_READY\',credentials_secret_arn=null,kms_key_arn='+sql(self.binding['kmsKeyArn'])+' where id='+sql(self.f.connection))
        self.enrollment=self.begin()
        query('update public.vat_einvoice_connections set status=\'COMPLIANCE_PASSED\',credentials_secret_arn='+sql(self.binding['secretArn'])+' where id='+sql(self.f.connection))
        self.evidence=self.proof(); self.version=self.record()

    def begin_sql(self,csr=None,spki=None,email='qa@example.invalid',enrollment_id=None):
        return 'select row_to_json(r) from zatca_preparation.begin_initial_enrollment('+','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,enrollment_id or self.enrollment_id,csr or self.csr,spki or self.spki,email]))+') r;'
    def begin(self): return json.loads(query(self.f.auth()+self.begin_sql()).splitlines()[-1])
    def proof(self):
        return dict(stage='ONBOARDING_CANDIDATE_ONLY',identity=dict(stage='ONBOARDING_IDENTITY_PREFLIGHT_ONLY',scope=dict(organizationId=self.f.org,environment='SIMULATION',unitId=self.f.connection,connectionId=self.f.connection),
          expectedIdentitySha256=identity_hash(self.enrollment['expected_identity']),profile='ZAKATFLOW_SAN_DIRECTORY_V1',certificateFingerprintSha256=self.binding['certificateFingerprintSha256'],csrSha256=sha(base64.b64decode(self.csr)),publicKeySpkiSha256=sha(base64.b64decode(self.spki))),
          path=dict(stage='CERTIFICATE_PATH_CHECK_ONLY',environment='SIMULATION',certificateFingerprintSha256=self.binding['certificateFingerprintSha256'],
            anchorFingerprintSha256=sha(b'SYNTHETIC_ISSUER'),issuerFingerprintsSha256=[sha(b'SYNTHETIC_ISSUER')],crlFingerprintsSha256=['b'*64],checkedAt=now(),engine='OpenSSL 3.5.7'))
    def record_sql(self,binding=None,evidence=None,head=None,enrollment_id=None):
        return 'select row_to_json(r) from zatca_preparation.record_enrolled_signer_candidate('+','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,enrollment_id or self.enrollment_id,json.dumps(binding or self.binding),json.dumps(evidence or self.evidence),head]))+') r;'
    def record(self,**kwargs): return json.loads(query(self.f.auth()+self.record_sql(**kwargs)).splitlines()[-1])
    def reserve_sql(self,digest=None,version=None):
        v=version or self.version
        return 'select row_to_json(r) from zatca_preparation.reserve_with_enrollment('+','.join(map(sql,[self.f.org,self.f.doc,'SIMULATION',v['registry_id'],v['binding_digest'],digest or self.enrollment['enrollment_digest'],json.dumps(self.f.snapshot)]))+') r;'
    def reserve(self): return json.loads(query(self.f.auth()+self.reserve_sql()).splitlines()[-1])
    def finalize_sql(self,e,digest=None):
        ref={k:self.binding[k] for k in ['version','secretVersionId','certificateFingerprintSha256']};payload='<synthetic-enrollment-storage-only/>'
        args=[self.f.org,'SIMULATION',self.f.connection,e['reservation_id'],self.version['registry_id'],self.version['binding_digest'],digest or self.enrollment['enrollment_digest'],json.dumps(ref),e['snapshot_digest'],base64.b64encode(hashlib.sha256(payload.encode()).digest()).decode(),payload]
        return 'select row_to_json(r) from zatca_preparation.finalize_with_enrollment('+','.join(map(sql,args))+') r;'
    def check_count(self): return query('select count(*) from zatca_preparation.enrollment_checks where registry_id='+sql(self.version['registry_id']))

    def test_original_request_exact_retry_preserves_original_actor_digest_and_time(self):
        self.assertEqual(self.begin(),self.enrollment)
        self.assertEqual(self.enrollment['expected_identity']['csrSha256'],sha(base64.b64decode(self.csr)))
        self.assertEqual(self.enrollment['recorded_by'],self.f.actor)
    def test_original_csr_key_email_or_operation_cannot_change(self):
        for kwargs in [dict(csr='MAA='),dict(spki='MAA='),dict(email='other@example.invalid'),dict(enrollment_id=str(uuid.uuid4()))]:
            query(self.f.auth()+self.begin_sql(**kwargs),'ORIGINAL_ENROLLMENT_CHANGED')
    def test_initial_provenance_cannot_be_invented_after_credentials_exist(self):
        f=support['SourceFreeze']();f.setUp()
        statement='select zatca_preparation.begin_initial_enrollment('+','.join(map(sql,[f.org,'SIMULATION',f.connection,str(uuid.uuid4()),self.csr,self.spki,'qa@example.invalid']))+');'
        query(f.auth()+statement,'INITIAL_ENROLLMENT_STATE_REQUIRED')
    def test_changed_saved_unit_blocks_recording_and_original_retry(self):
        query("update public.vat_einvoice_connections set branch_name='Changed' where id="+sql(self.f.connection))
        query(self.f.auth()+self.record_sql(),'ENROLLMENT_UNIT_CHANGED');query(self.f.auth()+self.begin_sql(),'ORIGINAL_ENROLLMENT_CHANGED')
    def test_record_retry_deduplicates_checks_and_preserves_first_link(self):
        self.assertEqual(self.record(),self.version);self.assertEqual(self.check_count(),'1')
        first=query('select first_check_id from zatca_preparation.registry_enrollments where registry_id='+sql(self.version['registry_id']))
        proof=self.proof();proof['path']['crlFingerprintsSha256']=['c'*64];self.record(evidence=proof)
        self.assertEqual(self.check_count(),'2')
        self.assertEqual(first,query('select first_check_id from zatca_preparation.registry_enrollments where registry_id='+sql(self.version['registry_id'])))
    def test_wrong_missing_and_extra_identity_evidence_is_rejected(self):
        for field,value in [('expectedIdentitySha256','0'*64),('csrSha256','0'*64),('publicKeySpkiSha256','0'*64),('certificateFingerprintSha256','0'*64),('profile','AUTO'),('stage','APPROVED')]:
            p=copy.deepcopy(self.evidence);p['identity'][field]=value
            query(self.f.auth()+self.record_sql(evidence=p),'ENROLLMENT_EVIDENCE_INVALID')
        for patch in [dict(approved=True),dict(path=None),dict(stage='APPROVED')]:
            query(self.f.auth()+self.record_sql(evidence={**self.evidence,**patch}),'ENROLLMENT_EVIDENCE_INVALID')
    def test_wrong_chain_anchor_environment_and_crl_evidence_is_rejected(self):
        for field,value in [('environment','PRODUCTION'),('certificateFingerprintSha256','0'*64),('anchorFingerprintSha256','0'*64),
          ('issuerFingerprintsSha256',['0'*64]),('crlFingerprintsSha256',[]),('crlFingerprintsSha256',['b'*64,'b'*64]),('engine','OpenSSL 1.1.1'),('extra','x')]:
            p=copy.deepcopy(self.evidence);p['path'][field]=value
            query(self.f.auth()+self.record_sql(evidence=p),'ENROLLMENT_EVIDENCE_INVALID')
    def test_stale_future_and_invalid_evidence_times_fail_closed(self):
        for date,error in [(now(-301),'ENROLLMENT_EVIDENCE_STALE'),(now(60),'ENROLLMENT_EVIDENCE_STALE'),('2026-99-99T00:00:00.000Z','ENROLLMENT_EVIDENCE_INVALID')]:
            p=copy.deepcopy(self.evidence);p['path']['checkedAt']=date;query(self.f.auth()+self.record_sql(evidence=p),error)
    def test_other_enrollment_scope_cannot_be_adopted(self):
        query(self.f.auth()+self.record_sql(enrollment_id=str(uuid.uuid4())),'ORIGINAL_ENROLLMENT_REQUIRED')
    def test_legacy_registry_version_cannot_receive_provenance_retroactively(self):
        b={**self.binding,'secretVersionId':str(uuid.uuid4())}
        args=[self.f.org,'SIMULATION',self.f.connection,json.dumps(b),self.version['registry_id']]
        old=json.loads(query(self.f.auth()+'select row_to_json(r) from zatca_preparation.record_signer_candidate('+','.join(map(sql,args))+') r;').splitlines()[-1])
        query(self.f.auth()+self.record_sql(binding=b,head=old['registry_id']),'REGISTRY_ENROLLMENT_PROVENANCE_REQUIRED')
    def test_legacy_registry_without_enrollment_cannot_reserve_through_enrolled_path(self):
        b={**self.binding,'secretVersionId':str(uuid.uuid4())}
        args=[self.f.org,'SIMULATION',self.f.connection,json.dumps(b),self.version['registry_id']]
        old=json.loads(query(self.f.auth()+'select row_to_json(r) from zatca_preparation.record_signer_candidate('+','.join(map(sql,args))+') r;').splitlines()[-1])
        query(self.f.auth()+self.reserve_sql(version=old),'RESERVATION_ENROLLMENT_REQUIRED')
        self.assertEqual(query('select count(*) from zatca_preparation.entries where organization_id='+sql(self.f.org)),'0')

    def test_reservation_captures_original_check_and_finalization_is_idempotent(self):
        e=self.reserve();self.assertEqual(e,self.reserve())
        prepared=query(self.f.auth()+self.finalize_sql(e));self.assertEqual(prepared,query(self.f.auth()+self.finalize_sql(e)))
        self.assertEqual(self.f.head(),'1');self.assertEqual(self.f.audit_count(),'1')
        self.assertEqual(query('select count(*) from zatca_preparation.enrollment_finalization_audit where reservation_id='+sql(e['reservation_id'])),'1')
        self.assertEqual(query('select status from public.vat_einvoices where id='+sql(self.f.doc)),'DRAFT')
    def test_wrong_original_digest_rolls_back_reservation_and_finalization(self):
        query(self.f.auth()+self.reserve_sql(digest='0'*64),'RESERVATION_ENROLLMENT_MISMATCH')
        self.assertEqual(query('select count(*) from zatca_preparation.entries where organization_id='+sql(self.f.org)),'0')
        e=self.reserve();query(self.f.auth()+self.finalize_sql(e,digest='0'*64),'RESERVATION_ENROLLMENT_MISMATCH');self.assertEqual(self.f.head(),'0')
    def test_legacy_finalization_cannot_receive_enrollment_audit_retroactively(self):
        e=self.reserve()
        registry=runpy.run_path(str(Path(__file__).with_name('zatca-signer-registry-postgres.py')))['Registry']()
        registry.f=self.f;registry.version=self.version
        query(self.f.auth()+registry.finalize_sql(e))
        query(self.f.auth()+self.finalize_sql(e),'ENROLLMENT_FINALIZATION_AUDIT_REQUIRED')
    def test_immutable_original_checks_links_reservation_and_finalization_audit(self):
        e=self.reserve();query(self.f.auth()+self.finalize_sql(e))
        for table,where in [('enrollment_requests','enrollment_id='+sql(self.enrollment_id)),('enrollment_checks','registry_id='+sql(self.version['registry_id'])),
          ('registry_enrollments','registry_id='+sql(self.version['registry_id'])),('enrollment_reservations','reservation_id='+sql(e['reservation_id'])),('enrollment_finalization_audit','reservation_id='+sql(e['reservation_id']))]:
            query('delete from zatca_preparation.'+table+' where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')
            query('update zatca_preparation.'+table+' set '+where.split('=')[0]+'='+where.split('=')[1]+' where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')
    def test_conflicting_enrollment_audit_rolls_back_chain_and_all_audits(self):
        e=self.reserve();check=query('select first_check_id from zatca_preparation.registry_enrollments where registry_id='+sql(self.version['registry_id']))
        insert='insert into zatca_preparation.enrollment_finalization_audit values('+','.join(map(sql,[e['reservation_id'],'bad',check]))+',now());'
        query('begin;'+insert+self.f.auth()+self.finalize_sql(e),'ENROLLMENT_FINALIZATION_AUDIT_CONFLICT')
        self.assertEqual(self.f.head(),'0');self.assertEqual(self.f.audit_count(),'0')
    def test_revoked_actor_cannot_begin_record_reserve_or_finalize(self):
        e=self.reserve();query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        for statement in [self.begin_sql(),self.record_sql(),self.reserve_sql(),self.finalize_sql(e)]: query(self.f.auth()+statement,'ORGANIZATION_ADMIN_REQUIRED')
    def test_concurrent_records_reservations_and_finalizers_do_not_duplicate(self):
        with ThreadPoolExecutor(max_workers=8) as pool: versions=list(pool.map(lambda _:self.record(),range(8)))
        self.assertEqual(len({v['registry_id'] for v in versions}),1);self.assertEqual(self.check_count(),'1')
        with ThreadPoolExecutor(max_workers=8) as pool: entries=list(pool.map(lambda _:self.reserve(),range(8)))
        self.assertEqual(len({e['reservation_id'] for e in entries}),1)
        with ThreadPoolExecutor(max_workers=8) as pool: result=list(pool.map(lambda _:query(self.f.auth()+self.finalize_sql(entries[0])),range(8)))
        self.assertEqual(len(set(result)),1);self.assertEqual(self.f.head(),'1')

if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':
        raise SystemExit('Disposable ledger QA database required')
    query(Path(__file__).with_name('fixtures').joinpath('zatca-enrollment-provenance.sql').read_text())
    unittest.main(verbosity=2)
