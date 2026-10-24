"""Disposable PostgreSQL authorization/freeze contract; NOT live Supabase/JWT QA.
Run after zatca-ledger-postgres.py on the SAME new disposable database.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import time
import unittest
import uuid


def sql(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def query(statement, error=None):
    r = subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=20)
    if error:
        if r.returncode == 0 or error not in r.stderr:
            raise AssertionError(r.stderr or 'Expected failure: '+error)
    elif r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


class SourceFreeze(unittest.TestCase):
    def setUp(self):
        self.org,self.actor,self.doc,self.connection,self.invoice = [str(uuid.uuid4()) for _ in range(5)]
        nullable='buyer_contact_id due_date buyer_name buyer_vat_number buyer_address buyer_city buyer_building_number buyer_district buyer_additional_number buyer_postal_code billing_reference preceding_invoice_id note_reason'.split()
        self.draft={k:None for k in nullable}
        self.draft.update(organization_id=self.org,connection_id=self.connection,invoice_number='SYNTHETIC-1',
          document_type='INVOICE',invoice_category='SIMPLIFIED',issue_date='2026-10-24',issue_time='12:00:00',
          currency='SAR',exchange_rate=1,seller_name='Synthetic seller',seller_vat_number='312345678901233',
          seller_address='Synthetic street',seller_city='Riyadh',seller_building_number='1234',seller_district='Olaya',
          seller_additional_number='5678',seller_postal_code='12345',seller_country_code='SA',buyer_country_code='SA',payment_means_code='30')
        self.line=dict(item_name='Service',description=None,quantity=1,unit_code='PCE',unit_price=100,discount_amount=0,
          tax_category='S',tax_rate=15,tax_exemption_reason_code=None,tax_exemption_reason=None)
        self.totals=dict(line_extension_amount='100.00',allowance_total_amount='0.00',tax_exclusive_amount='100.00',
          tax_total_amount='15.00',tax_inclusive_amount='115.00',payable_amount='115.00')
        self.amounts=dict(line_number=1,line_extension_amount='100.00',tax_amount='15.00',gross_amount='115.00')
        self.ctx=dict(supplyDate='2026-10-24',sellerId=dict(scheme='CRN',value='1010000000'),paymentMeansCode='30')
        header={**self.draft,**self.totals,'id':self.doc,'invoice_uuid':self.invoice,'status':'DRAFT','updated_at':'2026-10-24T00:00:00Z'}
        line={**self.line,**self.amounts,'id':str(uuid.uuid4()),'invoice_id':self.doc}
        query('insert into public.organization_members values('+','.join(map(sql,[self.org,self.actor,'ADMIN','ACTIVE']))+');'+
          'insert into public.vat_einvoice_connections values('+','.join(map(sql,[self.connection,self.org,'SIMULATION','COMPLIANCE_PASSED','312345678901233','TEST-EGS','1100']))+');'+
          'insert into public.vat_einvoices select * from jsonb_populate_record(null::public.vat_einvoices,'+sql(json.dumps(header))+');'+
          'insert into public.vat_einvoice_lines select * from jsonb_populate_record(null::public.vat_einvoice_lines,'+sql(json.dumps(line))+');'+
          'insert into zatca_preparation.units(organization_id,environment,unit_id) values('+','.join(map(sql,[self.org,'SIMULATION',self.connection]))+');'+
          'insert into zatca_preparation.document_context values('+','.join(map(sql,[self.doc,self.org,json.dumps(self.ctx)]))+');')
        self.snapshot=dict(version='ZATCA_PREPARATION_V1',scope=dict(organizationId=self.org,environment='SIMULATION',
          unitId=self.connection,connectionId=self.connection,documentId=self.doc,invoiceUuid=self.invoice),
          draft={**self.draft,'lines':[self.line]},context=self.ctx,savedTotals=self.totals,savedLineAmounts=[self.amounts])

    def auth(self):
        return 'select set_config(\'request.jwt.claim.sub\','+sql(self.actor)+',false);'

    def reserve(self, snapshot=None):
        args=[self.org,self.doc,'SIMULATION',json.dumps(self.snapshot if snapshot is None else snapshot)]
        return 'select row_to_json(r) from zatca_preparation.reserve_saved('+','.join(map(sql,args))+') r;'

    def frozen(self):
        return query('select count(*) from zatca_preparation.entries where document_id='+sql(self.doc))

    def test_reserves_exact_saved_snapshot_and_retry(self):
        a=json.loads(query(self.auth()+self.reserve()).splitlines()[-1])
        b=json.loads(query(self.auth()+self.reserve()).splitlines()[-1])
        self.assertEqual(a,b); self.assertEqual(a['snapshot'],self.snapshot); self.assertEqual(a['counter'],1)
        self.assertEqual(query('select status from public.vat_einvoices where id='+sql(self.doc)),'DRAFT')

    def test_rejects_missing_actor_revoked_and_non_admin_membership(self):
        query(self.reserve(),'UNAUTHORIZED')
        for role,status in [('VIEWER','ACTIVE'),('OWNER','INACTIVE'),(None,'ACTIVE'),('ADMIN',None)]:
            query('update public.organization_members set role='+sql(role)+',status='+sql(status)+' where user_id='+sql(self.actor))
            query(self.auth()+self.reserve(),'ORGANIZATION_ADMIN_REQUIRED')
        self.assertEqual(self.frozen(),'0')

    def test_changed_header_line_context_or_expected_snapshot_consumes_nothing(self):
        bad=json.loads(json.dumps(self.snapshot));bad['savedTotals']['payable_amount']='116.00'
        query(self.auth()+self.reserve(bad),'SAVED_SOURCE_CHANGED')
        query('update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc))
        query(self.auth()+self.reserve(),'SAVED_SOURCE_CHANGED')
        self.assertEqual(self.frozen(),'0')
        self.assertEqual(query('select last_counter from zatca_preparation.units where unit_id='+sql(self.connection)),'0')

    def test_changed_saved_header_and_context_are_rejected(self):
        for edit in [
          "update public.vat_einvoices set invoice_number='CHANGED' where id="+sql(self.doc),
          "update zatca_preparation.document_context set context=jsonb_set(context,'{supplyDate}','\"2026-10-25\"') where invoice_id="+sql(self.doc),
        ]: query('begin;'+edit+';'+self.auth()+self.reserve(),'SAVED_SOURCE_CHANGED')
        self.assertEqual(self.frozen(),'0')

    def test_missing_context_lines_and_non_draft_fail_before_allocating(self):
        for edit,error in [
          ('delete from zatca_preparation.document_context where invoice_id='+sql(self.doc),'SAVED_XML_CONTEXT_REQUIRED'),
          ('delete from public.vat_einvoice_lines where invoice_id='+sql(self.doc),'SAVED_LINES_REQUIRED'),
          ("update public.vat_einvoices set status='ISSUED' where id="+sql(self.doc),'EINVOICE_DRAFT_LOCKED'),
        ]: query('begin;'+edit+';'+self.auth()+self.reserve(),error)
        self.assertEqual(self.frozen(),'0')

    def test_unprivileged_role_cannot_invoke_private_reservation(self):
        query('set role zatca_ledger_client;'+self.reserve(),'permission denied')
        self.assertEqual(self.frozen(),'0')

    def test_frozen_header_lines_and_context_reject_all_mutations(self):
        query(self.auth()+self.reserve())
        for statement in [
          'update public.vat_einvoices set status=\'ISSUED\' where id='+sql(self.doc),
          'update public.vat_einvoices set organization_id='+sql(str(uuid.uuid4()))+' where id='+sql(self.doc),
          'delete from public.vat_einvoices where id='+sql(self.doc),
          'update public.vat_einvoice_lines set unit_price=999 where invoice_id='+sql(self.doc),
          'delete from public.vat_einvoice_lines where invoice_id='+sql(self.doc),
          'insert into public.vat_einvoice_lines(invoice_id,line_number) values('+sql(self.doc)+',2)',
          'update zatca_preparation.document_context set context=\'{}\' where invoice_id='+sql(self.doc),
          'delete from zatca_preparation.document_context where invoice_id='+sql(self.doc),
        ]: query(statement,'EINVOICE_SOURCE_FROZEN')

    def test_moving_lines_into_or_out_of_frozen_parent_is_rejected(self):
        second,second_line=str(uuid.uuid4()),str(uuid.uuid4())
        query('insert into public.vat_einvoices select * from jsonb_populate_record(null::public.vat_einvoices,(select to_jsonb(h)||jsonb_build_object(\'id\','+sql(second)+',\'invoice_uuid\','+sql(str(uuid.uuid4()))+') from public.vat_einvoices h where id='+sql(self.doc)+'));'+
          'insert into public.vat_einvoice_lines select * from jsonb_populate_record(null::public.vat_einvoice_lines,(select to_jsonb(l)||jsonb_build_object(\'id\','+sql(second_line)+',\'invoice_id\','+sql(second)+') from public.vat_einvoice_lines l where invoice_id='+sql(self.doc)+'));')
        query(self.auth()+self.reserve())
        query('update public.vat_einvoice_lines set invoice_id='+sql(second)+' where invoice_id='+sql(self.doc),'EINVOICE_SOURCE_FROZEN')
        query('update public.vat_einvoice_lines set invoice_id='+sql(self.doc)+' where id='+sql(second_line),'EINVOICE_SOURCE_FROZEN')

    def test_rollback_releases_freeze_and_restores_source_touch(self):
        before=query('select updated_at from public.vat_einvoices where id='+sql(self.doc))
        query('begin;'+self.auth()+self.reserve()+'select 1/0;commit;','division by zero')
        self.assertEqual(self.frozen(),'0')
        self.assertEqual(query('select updated_at from public.vat_einvoices where id='+sql(self.doc)),before)
        query('update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc))

    def test_wrong_company_environment_status_vat_and_unit_type(self):
        for field,value,error in [('organization_id',str(uuid.uuid4()),'EINVOICE_CONNECTION_NOT_FOUND'),
          ('environment','PRODUCTION','EINVOICE_CONNECTION_NOT_FOUND'),('status','KEY_READY','EINVOICE_CONNECTION_NOT_READY'),
          ('taxpayer_vat_number','399999999999993','SELLER_VAT_MISMATCH'),('invoice_type','1000','EINVOICE_UNIT_CATEGORY_MISMATCH')]:
            query('begin;update public.vat_einvoice_connections set '+field+'='+sql(value)+' where id='+sql(self.connection)+';'+self.auth()+self.reserve(),error)
        self.assertEqual(self.frozen(),'0')

    def wait_lock(self, application):
        for _ in range(100):
            if query('select count(*) from pg_stat_activity where application_name='+sql(application)+" and wait_event='PgSleep'")=='1':
                return
            time.sleep(.02)
        raise AssertionError('Transaction did not reach held-lock barrier')

    def test_edit_before_reserve_wins_and_stale_expected_snapshot_is_rejected(self):
        app='zatca-edit-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            writer=pool.submit(query,'set application_name='+sql(app)+';begin;update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc)+';select pg_sleep(0.8);commit;')
            self.wait_lock(app)
            query(self.auth()+self.reserve(),'SAVED_SOURCE_CHANGED');writer.result()
        self.assertEqual(self.frozen(),'0')

    def test_reserve_before_edit_blocks_header_and_line_changes(self):
        app='zatca-reserve-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            reserving=pool.submit(query,'set application_name='+sql(app)+';begin;'+self.auth()+self.reserve()+'select pg_sleep(0.8);commit;')
            self.wait_lock(app)
            query('update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc),'EINVOICE_SOURCE_FROZEN');reserving.result()
        self.assertEqual(self.frozen(),'1')

    def test_context_writer_waiting_on_parent_cannot_deadlock_reservation(self):
        app='zatca-context-lock-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            reserve=pool.submit(query,'set application_name='+sql(app)+';begin;select id from public.vat_einvoices where id='+sql(self.doc)+' for update;select pg_sleep(0.8);'+self.auth()+self.reserve()+'commit;')
            self.wait_lock(app)
            query("update zatca_preparation.document_context set context='{}' where invoice_id="+sql(self.doc),'EINVOICE_SOURCE_FROZEN')
            reserve.result()
        self.assertEqual(self.frozen(),'1')

    def test_repeatable_read_reservation_cannot_freeze_old_child_data(self):
        app='zatca-stale-reserve-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            reserve=pool.submit(query,'set application_name='+sql(app)+';begin isolation level repeatable read;select count(*) from public.vat_einvoice_lines;select pg_sleep(0.8);'+self.auth()+self.reserve()+'commit;','could not serialize access')
            self.wait_lock(app)
            query('update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc))
            reserve.result()
        self.assertEqual(self.frozen(),'0')

    def test_repeatable_read_old_snapshot_cannot_bypass_freeze(self):
        # Start a stale RR snapshot, then reserve in a separate transaction while
        # the stale session sleeps. The parent's reservation touch forces 40001.
        app='zatca-stale-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            stale=pool.submit(query,'set application_name='+sql(app)+';begin isolation level repeatable read;select count(*) from public.vat_einvoice_lines;select pg_sleep(0.8);update public.vat_einvoice_lines set unit_price=101 where invoice_id='+sql(self.doc)+';commit;','could not serialize access')
            self.wait_lock(app);query(self.auth()+self.reserve());stale.result()
        self.assertEqual(self.frozen(),'1')

    def test_revocation_before_reservation_wins(self):
        app='zatca-revoke-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            revoke=pool.submit(query,'set application_name='+sql(app)+";begin;update public.organization_members set status='INACTIVE' where user_id="+sql(self.actor)+';select pg_sleep(0.8);commit;')
            self.wait_lock(app);query(self.auth()+self.reserve(),'ORGANIZATION_ADMIN_REQUIRED');revoke.result()
        self.assertEqual(self.frozen(),'0')

    def test_revocation_after_membership_lock_applies_after_reservation_commit(self):
        app='zatca-held-member-'+self.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            reserve=pool.submit(query,'set application_name='+sql(app)+';begin;'+self.auth()+self.reserve()+'select pg_sleep(0.8);commit;')
            self.wait_lock(app)
            query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.actor));reserve.result()
        query(self.auth()+self.reserve(),'ORGANIZATION_ADMIN_REQUIRED')
        self.assertEqual(self.frozen(),'1')


if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':
        raise SystemExit('Disposable ledger QA database required')
    directory=Path(__file__).with_name('fixtures')
    query('begin;'+directory.joinpath('zatca-source-freeze-harness.sql').read_text()+directory.joinpath('zatca-source-freeze.sql').read_text()+'commit;')
    unittest.main(verbosity=2)
