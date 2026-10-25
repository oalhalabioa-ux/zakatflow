"""Private signer persistence candidate, run AFTER source QA and BEFORE permissions.
No real AWS credentials or certificate trust/authority acceptance is asserted.
"""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
import os
from pathlib import Path
import runpy
import unittest
import uuid

support=runpy.run_path(str(Path(__file__).with_name('zatca-source-freeze-postgres.py')))
query,sql=support['query'],support['sql']

class Registry(unittest.TestCase):
    def setUp(self):
        self.f=support['SourceFreeze'](); self.f.setUp()
        self.binding=dict(version='ZATCA_SAVED_SIGNER_V1',organizationId=self.f.org,environment='SIMULATION',
          unitId=self.f.connection,connectionId=self.f.connection,
          kmsKeyArn='arn:aws:kms:eu-central-1:123456789012:key/'+str(uuid.uuid4()),
          secretArn='arn:aws:secretsmanager:eu-central-1:123456789012:secret:zakatflow/fatoora/'+self.f.org+'/simulation/'+self.f.connection+'-ABC123',
          secretVersionId=str(uuid.uuid4()),certificateFingerprintSha256='a'*64,
          issuerChainDerBase64=['U1lOVEhFVElDX05PVF9BX0NFUlRJRklDQVRF'],
          policy=dict(identifier='https://example.invalid/synthetic-policy',digestSha256Base64='A'*43+'='),includeSimplifiedQr=False)
        query('update public.vat_einvoice_connections set kms_key_arn='+sql(self.binding['kmsKeyArn'])+',credentials_secret_arn='+sql(self.binding['secretArn'])+' where id='+sql(self.f.connection))
        self.version=self.record()

    def record_sql(self,binding=None,head=None):
        return 'select row_to_json(r) from zatca_preparation.record_signer_candidate('+','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,json.dumps(binding or self.binding),head]))+') r;'

    def record(self,binding=None,head=None):
        return json.loads(query(self.f.auth()+self.record_sql(binding,head)).splitlines()[-1])

    def reserve_sql(self,version=None):
        v=version or self.version
        return 'select row_to_json(r) from zatca_preparation.reserve_with_signer('+','.join(map(sql,[self.f.org,self.f.doc,'SIMULATION',v['registry_id'],v['binding_digest'],json.dumps(self.f.snapshot)]))+') r;'

    def reserve(self,version=None):
        return json.loads(query(self.f.auth()+self.reserve_sql(version)).splitlines()[-1])

    def finalize_sql(self,e,version=None,reference=None):
        v=version or self.version
        ref=reference if reference is not None else {k:v['binding'][k] for k in ['version','secretVersionId','certificateFingerprintSha256']}
        # Deliberately synthetic SQL storage artifact, not signed UBL.
        args=','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,e['reservation_id'],v['registry_id'],v['binding_digest'],json.dumps(ref)]))
        # Reuse exact digest/hash/storage arguments from source contract.
        import base64,hashlib
        payload='<synthetic-storage-artifact/>'
        args+=','+','.join(map(sql,[e['snapshot_digest'],base64.b64encode(hashlib.sha256(payload.encode()).digest()).decode(),payload]))
        return 'select row_to_json(r) from zatca_preparation.finalize_with_signer('+args+') r;'

    def rotate(self,field='secretVersionId'):
        b=copy.deepcopy(self.binding)
        if field=='secretVersionId': b[field]=str(uuid.uuid4())
        elif field=='certificateFingerprintSha256': b[field]='b'*64
        elif field=='policy': b[field]['digestSha256Base64']='B'*43+'='
        else: b[field]=['QU5PVEhFUl9TWU5USEVUSUNfSVNTVUVS']
        return self.record(b,self.version['registry_id'])

    def test_roundtrip_and_exact_retries_preserve_single_audits_and_counter(self):
        e=self.reserve(); self.assertEqual(self.reserve(),e)
        a=query(self.f.auth()+self.finalize_sql(e)); self.assertEqual(a,query(self.f.auth()+self.finalize_sql(e)))
        self.assertEqual(query('select count(*) from zatca_preparation.signer_finalization_audit where reservation_id='+sql(e['reservation_id'])),'1')
        self.assertEqual(self.f.head(),'1')
        self.assertEqual(query('select status from public.vat_einvoices where id='+sql(self.f.doc)),'DRAFT')

    def test_idempotent_registration_does_not_make_versions(self):
        self.assertEqual(self.record(),self.version)
        self.assertEqual(query('select count(*) from zatca_preparation.signer_versions where organization_id='+sql(self.f.org)),'1')

    def test_stale_rotation_compare_and_swap_is_denied(self):
        self.rotate(); b=copy.deepcopy(self.binding);b['secretVersionId']=str(uuid.uuid4())
        query(self.f.auth()+self.record_sql(b,self.version['registry_id']),'SIGNER_HEAD_CHANGED')

    def test_version_pin_policy_and_chain_rotation_block_reserved_finalization(self):
        e=self.reserve()
        for field in ['secretVersionId','certificateFingerprintSha256','policy','issuerChainDerBase64']:
            # Roll back each rotation independently to test the same reserved version.
            b=copy.deepcopy(self.binding)
            if field=='secretVersionId': b[field]=str(uuid.uuid4())
            elif field=='certificateFingerprintSha256': b[field]='b'*64
            elif field=='policy': b[field]['digestSha256Base64']='B'*43+'='
            else: b[field]=['QU5PVEhFUl9TWU5USEVUSUM=']
            query('begin;'+self.f.auth()+self.record_sql(b,self.version['registry_id'])+self.finalize_sql(e),'SIGNER_HEAD_CHANGED')
        self.assertEqual(self.f.head(),'0');self.assertEqual(self.f.audit_count(),'0')

    def test_old_reservation_cannot_be_rebound_to_rotated_head(self):
        self.reserve(); newer=self.rotate()
        query(self.f.auth()+self.reserve_sql(newer),'RESERVATION_SIGNER_CHANGED')

    def test_unbound_legacy_reservation_cannot_be_backfilled(self):
        self.f.reserved()
        query(self.f.auth()+self.reserve_sql(),'RESERVATION_SIGNER_REQUIRED')

    def test_wrong_digest_or_scope_denied_before_reservation(self):
        bad={**self.version,'binding_digest':'0'*64}
        query(self.f.auth()+self.reserve_sql(bad),'SIGNER_BINDING_DIGEST_MISMATCH')
        bad={**self.version,'registry_id':str(uuid.uuid4())}
        query(self.f.auth()+self.reserve_sql(bad),'SIGNER_HEAD_CHANGED')
        self.assertEqual(self.f.head(),'0')

    def test_corrupt_head_cannot_select_another_organization_signer(self):
        other=Registry();other.setUp()
        query('update zatca_preparation.signer_heads set registry_id='+sql(other.version['registry_id'])+' where organization_id='+sql(self.f.org))
        query(self.f.auth()+self.reserve_sql(other.version),'SIGNER_SCOPE_MISMATCH')

    def test_missing_current_registry_denied(self):
        query('delete from zatca_preparation.signer_heads where organization_id='+sql(self.f.org))
        query(self.f.auth()+self.reserve_sql(),'SAVED_SIGNER_REQUIRED')

    def test_forged_or_extra_credential_reference_rolls_back_finalization(self):
        e=self.reserve()
        for patch in [{'secretVersionId':str(uuid.uuid4())},{'certificateFingerprintSha256':'b'*64},{'extra':'x'}]:
            ref={k:self.binding[k] for k in ['version','secretVersionId','certificateFingerprintSha256']};ref.update(patch)
            query(self.f.auth()+self.finalize_sql(e,reference=ref),'SIGNER_CREDENTIAL_REFERENCE_MISMATCH')
        self.assertEqual(self.f.head(),'0');self.assertEqual(self.f.audit_count(),'0')

    def test_source_reference_change_denied(self):
        e=self.reserve()
        query('update public.vat_einvoice_connections set kms_key_arn='+sql('CHANGED')+' where id='+sql(self.f.connection))
        query(self.f.auth()+self.finalize_sql(e),'UNIT_CONFIGURATION_CHANGED')

    def test_private_versions_reservation_and_audit_are_immutable(self):
        e=self.reserve();query(self.f.auth()+self.finalize_sql(e))
        for table,column,value,where in [
          ('signer_versions','binding_digest','0'*64,'registry_id='+sql(self.version['registry_id'])),
          ('reservation_signers','binding_digest','0'*64,'reservation_id='+sql(e['reservation_id'])),
          ('signer_finalization_audit','binding_digest','0'*64,'reservation_id='+sql(e['reservation_id']))]:
            query('update zatca_preparation.'+table+' set '+column+'='+sql(value)+' where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')
            query('delete from zatca_preparation.'+table+' where '+where,'PREPARATION_PROVENANCE_IMMUTABLE')

    def test_legacy_prepared_cannot_get_signer_audit_retroactively(self):
        e=self.reserve();query(self.f.auth()+self.f.finalize(e))
        query(self.f.auth()+self.finalize_sql(e),'SIGNER_FINALIZATION_AUDIT_REQUIRED')

    def test_corrupt_audit_conflict_rolls_back_whole_finalization(self):
        e=self.reserve()
        insert='insert into zatca_preparation.signer_finalization_audit values('+','.join(map(sql,[e['reservation_id'],self.version['registry_id'],'bad']))+',now());'
        query('begin;'+insert+self.f.auth()+self.finalize_sql(e),'SIGNER_FINALIZATION_AUDIT_CONFLICT')
        self.assertEqual(self.f.head(),'0');self.assertEqual(self.f.audit_count(),'0')

    def test_revoked_actor_cannot_register_reserve_or_finalize(self):
        e=self.reserve()
        query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        for statement in [self.record_sql(),self.reserve_sql(),self.finalize_sql(e)]: query(self.f.auth()+statement,'ORGANIZATION_ADMIN_REQUIRED')

    def test_missing_subject_denied(self):
        for statement in [self.record_sql(),self.reserve_sql()]: query(statement,'UNAUTHORIZED')

    def test_binding_shape_scope_and_secret_data_are_rejected(self):
        patches=[{'secret':'never-store-password'},{'privateKey':'never-store-key'},{'organizationId':str(uuid.uuid4())},
          {'environment':'PRODUCTION'},{'secretVersionId':'short'},{'certificateFingerprintSha256':'A'*64},
          {'includeSimplifiedQr':'false'},{'issuerChainDerBase64':[]},{'issuerChainDerBase64':[None]},
          {'policy':None},{'policy':{'identifier':'http://bad','digestSha256Base64':'A'*43+'='}},
          {'kmsKeyArn':self.binding['kmsKeyArn'].replace(':key/',':alias/')},
          {'secretArn':self.binding['secretArn'].replace(':123456789012:',':999999999999:')}]
        for patch in patches:
            query(self.f.auth()+self.record_sql({**self.binding,**patch},self.version['registry_id']),'SIGNER_BINDING_INVALID')

    def test_binding_must_match_saved_connection_references(self):
        b={**self.binding,'kmsKeyArn':self.binding['kmsKeyArn'][:-36]+str(uuid.uuid4())}
        query(self.f.auth()+self.record_sql(b,self.version['registry_id']),'SIGNER_CONNECTION_REFERENCE_MISMATCH')

    def test_concurrent_first_reservations_and_finalizers_have_one_binding(self):
        with ThreadPoolExecutor(max_workers=8) as pool: reservations=list(pool.map(lambda _:self.reserve(),range(8)))
        self.assertEqual(len({r['reservation_id'] for r in reservations}),1);e=reservations[0]
        with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:query(self.f.auth()+self.finalize_sql(e)),range(8)))
        self.assertEqual(len(set(results)),1);self.assertEqual(self.f.head(),'1')

    def test_connection_changed_while_waiting_for_parent_is_rejected(self):
        app='qa-signer-parent-'+self.f.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            edit=pool.submit(query,'set application_name='+sql(app)+';begin;update public.vat_einvoices set connection_id='+sql(str(uuid.uuid4()))+' where id='+sql(self.f.doc)+';select pg_sleep(0.8);commit;')
            self.f.wait_lock(app);query(self.f.auth()+self.reserve_sql(),'SAVED_SOURCE_CHANGED');edit.result()
        self.assertEqual(self.f.head(),'0')

    def test_rotation_before_finalize_lock_blocks_stale_worker(self):
        e=self.reserve();b={**self.binding,'secretVersionId':str(uuid.uuid4())};app='qa-signer-rotation-'+self.f.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            rotation=pool.submit(query,'set application_name='+sql(app)+';begin;'+self.f.auth()+self.record_sql(b,self.version['registry_id'])+'select pg_sleep(0.8);commit;')
            self.f.wait_lock(app);query(self.f.auth()+self.finalize_sql(e),'SIGNER_HEAD_CHANGED');rotation.result()
        self.assertEqual(self.f.head(),'0')

    def test_rotation_after_finalize_lock_applies_before_retry(self):
        e=self.reserve();b={**self.binding,'secretVersionId':str(uuid.uuid4())};app='qa-signer-finalize-'+self.f.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            finalize=pool.submit(query,'set application_name='+sql(app)+';begin;'+self.f.auth()+self.finalize_sql(e)+'select pg_sleep(0.8);commit;')
            self.f.wait_lock(app);self.record(b,self.version['registry_id']);finalize.result()
        query(self.f.auth()+self.finalize_sql(e),'SIGNER_HEAD_CHANGED');self.assertEqual(self.f.head(),'1')

if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':
        raise SystemExit('Disposable ledger QA database required')
    query(Path(__file__).with_name('fixtures').joinpath('zatca-signer-registry.sql').read_text())
    unittest.main(verbosity=2)
