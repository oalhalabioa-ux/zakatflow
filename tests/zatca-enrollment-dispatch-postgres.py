"""Disposable one-shot enrollment dispatch fence; NO authority/AWS transport.
Run after enrollment QA and before native integration/application grants.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import runpy
import subprocess
import unittest
import uuid
support=runpy.run_path(str(Path(__file__).with_name('zatca-source-freeze-postgres.py')))
query,sql=support['query'],support['sql']

class Dispatch(unittest.TestCase):
    def setUp(self):
        self.f=support['SourceFreeze']();self.f.setUp();self.enrollment=str(uuid.uuid4());self.dispatch=str(uuid.uuid4())
        query("update public.vat_einvoice_connections set status='KEY_READY',credentials_secret_arn=null where id="+sql(self.f.connection))
        self.original=json.loads(query(self.f.auth()+"select row_to_json(r) from zatca_preparation.begin_initial_enrollment("
          +','.join(map(sql,[self.f.org,'SIMULATION',self.f.connection,self.enrollment,'MAA=','MAA=','qa@example.invalid']))+") r").splitlines()[-1])
    def claim_sql(self,**change):
        args=dict(org=self.f.org,environment='SIMULATION',connection=self.f.connection,enrollment=self.enrollment,
          digest=self.original['enrollment_digest'],dispatch=self.dispatch);args.update(change)
        return 'select row_to_json(r) from zatca_preparation.claim_initial_enrollment_dispatch('+','.join(map(sql,args.values()))+') r;'
    def claim(self,**change):
        return json.loads(query(self.f.auth()+self.claim_sql(**change)).splitlines()[-1])
    def count(self):
        return query('select count(*) from zatca_preparation.enrollment_dispatch_intents where enrollment_id='+sql(self.enrollment))
    def test_first_claim_and_replay_keep_original_actor_time_but_do_not_reacquire(self):
        first=self.claim();retry=self.claim()
        self.assertTrue(first['acquired']);self.assertFalse(retry['acquired'])
        self.assertEqual({**first,'acquired':False},retry);self.assertEqual(first['recorded_by'],self.f.actor)
        self.assertEqual(first['state'],'INTENT_RECORDED');self.assertEqual(self.count(),'1')
    def test_sixteen_simultaneous_retries_have_only_one_first_intent(self):
        with ThreadPoolExecutor(max_workers=8) as pool: rows=list(pool.map(lambda _:self.claim(),range(16)))
        self.assertEqual(sum(r['acquired'] for r in rows),1)
        self.assertEqual(len({r['recorded_at'] for r in rows}),1);self.assertEqual(self.count(),'1')
    def test_competing_operation_ids_have_one_winner(self):
        def attempt(_):
            r=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=self.f.auth()+self.claim_sql(dispatch=str(uuid.uuid4())),text=True,capture_output=True,timeout=10)
            if r.returncode: self.assertIn('ENROLLMENT_DISPATCH_CHANGED',r.stderr);return False
            return json.loads(r.stdout.strip().splitlines()[-1])['acquired']
        with ThreadPoolExecutor(max_workers=8) as pool: wins=list(pool.map(attempt,range(8)))
        self.assertEqual(sum(wins),1);self.assertEqual(self.count(),'1')
    def test_new_dispatch_id_cannot_reset_original_intent(self):
        self.claim();query(self.f.auth()+self.claim_sql(dispatch=str(uuid.uuid4())),'ENROLLMENT_DISPATCH_CHANGED');self.assertEqual(self.count(),'1')
    def test_another_current_admin_replay_preserves_first_actor(self):
        first=self.claim();actor=str(uuid.uuid4());query("insert into public.organization_members values("+','.join(map(sql,[self.f.org,actor,'OWNER','ACTIVE']))+')')
        retry=json.loads(query("select set_config('request.jwt.claim.sub',"+sql(actor)+",false);"+self.claim_sql()).splitlines()[-1])
        self.assertEqual(retry,{**first,'acquired':False})
    def test_missing_subject_and_non_admin_are_denied_without_intent(self):
        query(self.claim_sql(),'UNAUTHORIZED')
        query("update public.organization_members set role='VIEWER' where user_id="+sql(self.f.actor))
        query(self.f.auth()+self.claim_sql(),'ORGANIZATION_ADMIN_REQUIRED');self.assertEqual(self.count(),'0')
    def test_revocation_blocks_new_and_existing_intents(self):
        self.claim();query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        query(self.f.auth()+self.claim_sql(),'ORGANIZATION_ADMIN_REQUIRED');self.assertEqual(self.count(),'1')
    def test_scope_and_missing_original_are_rejected(self):
        query(self.f.auth()+self.claim_sql(connection=str(uuid.uuid4())),'EINVOICE_CONNECTION_NOT_FOUND')
        query(self.f.auth()+self.claim_sql(environment='PRODUCTION'),'EINVOICE_CONNECTION_NOT_FOUND')
        query(self.f.auth()+self.claim_sql(enrollment=str(uuid.uuid4())),'ORIGINAL_ENROLLMENT_REQUIRED');self.assertEqual(self.count(),'0')
    def test_missing_changed_and_malformed_digest_are_rejected(self):
        for digest,error in [(None,'ENROLLMENT_DISPATCH_INPUT_INVALID'),('bad','ENROLLMENT_DISPATCH_INPUT_INVALID'),('a'*64,'ENROLLMENT_DISPATCH_DIGEST_MISMATCH')]:
            query(self.f.auth()+self.claim_sql(digest=digest),error)
        query(self.f.auth()+self.claim_sql(dispatch=None),'ENROLLMENT_DISPATCH_INPUT_INVALID');self.assertEqual(self.count(),'0')
    def test_changed_saved_unit_blocks_first_and_replay(self):
        self.claim();query("update public.vat_einvoice_connections set legal_name='Changed saved identity' where id="+sql(self.f.connection))
        query(self.f.auth()+self.claim_sql(),'ENROLLMENT_UNIT_CHANGED');self.assertEqual(self.count(),'1')
    def test_existing_credentials_deny_first_intent_but_do_not_reacquire_old_intent(self):
        first=self.claim();query("update public.vat_einvoice_connections set status='COMPLIANCE_PASSED',credentials_secret_arn='SYNTHETIC' where id="+sql(self.f.connection))
        self.assertEqual(self.claim(),{**first,'acquired':False})
        f=Dispatch();f.setUp();query("update public.vat_einvoice_connections set credentials_secret_arn='SYNTHETIC' where id="+sql(f.f.connection))
        query(f.f.auth()+f.claim_sql(),'INITIAL_ENROLLMENT_STATE_REQUIRED');self.assertEqual(f.count(),'0')
    def test_not_key_ready_denies_first_intent(self):
        query("update public.vat_einvoice_connections set status='ERROR' where id="+sql(self.f.connection))
        query(self.f.auth()+self.claim_sql(),'INITIAL_ENROLLMENT_STATE_REQUIRED');self.assertEqual(self.count(),'0')
    def test_rollback_before_commit_does_not_consume_the_intent(self):
        query('begin;'+self.f.auth()+self.claim_sql()+'rollback;');self.assertEqual(self.count(),'0');self.assertTrue(self.claim()['acquired'])
    def test_original_checksum_corruption_is_rejected(self):
        query('begin;alter table zatca_preparation.enrollment_requests disable trigger immutable_enrollment_request;'
          +"update zatca_preparation.enrollment_requests set enrollment_digest='"+'0'*64+"' where enrollment_id="+sql(self.enrollment)+';'
          +self.f.auth()+self.claim_sql(digest='0'*64),'ENROLLMENT_DISPATCH_INTEGRITY_INVALID');self.assertEqual(self.count(),'0')
    def test_intent_cannot_be_updated_deleted_or_expired_automatically(self):
        self.claim();where=' where enrollment_id='+sql(self.enrollment)
        query("update zatca_preparation.enrollment_dispatch_intents set recorded_at=now()-interval '1 day'"+where,'PREPARATION_PROVENANCE_IMMUTABLE')
        query('delete from zatca_preparation.enrollment_dispatch_intents'+where,'PREPARATION_PROVENANCE_IMMUTABLE');self.assertFalse(self.claim()['acquired'])
    def test_private_invoker_rls_and_no_application_grants(self):
        self.assertEqual(query("select relrowsecurity from pg_class where oid='zatca_preparation.enrollment_dispatch_intents'::regclass"),'t')
        self.assertEqual(query("select prosecdef from pg_proc where oid='zatca_preparation.claim_initial_enrollment_dispatch(uuid,text,uuid,uuid,text,uuid)'::regprocedure"),'f')
        self.assertEqual(query("select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='zatca_preparation.claim_initial_enrollment_dispatch(uuid,text,uuid,uuid,text,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')"),'f')
        for role in ['anon','authenticated','service_role']:
            if query('select exists(select 1 from pg_roles where rolname='+sql(role)+')')=='t':
                self.assertEqual(query('select has_table_privilege('+sql(role)+",'zatca_preparation.enrollment_dispatch_intents','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')"),'f')
                self.assertEqual(query('select has_function_privilege('+sql(role)+",'zatca_preparation.claim_initial_enrollment_dispatch(uuid,text,uuid,uuid,text,uuid)','EXECUTE')"),'f')

if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':
        raise SystemExit('Disposable ledger QA database required')
    # Reproduce explicit Supabase-style application default grants, then verify
    # this fixture removes them. This is disposable PostgreSQL, never managed QA.
    query("""do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    grant usage on schema zatca_preparation to anon,authenticated,service_role;
    alter default privileges in schema zatca_preparation grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema zatca_preparation grant execute on functions to anon,authenticated,service_role;
    """)
    query(Path(__file__).with_name('fixtures').joinpath('zatca-enrollment-dispatch.sql').read_text())
    query("""alter default privileges in schema zatca_preparation revoke all on tables from anon,authenticated,service_role;
      alter default privileges in schema zatca_preparation revoke all on functions from anon,authenticated,service_role;""")
    unittest.main(verbosity=2)
