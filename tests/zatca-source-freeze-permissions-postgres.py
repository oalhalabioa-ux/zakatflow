"""Isolated permission-adapter regression QA, run LAST after source/signature tests.
This uses a minimal permission fixture, not the actual Supabase JWT/role model.
Actual Supabase compatibility is tested separately by the rollback-only SQL script.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import runpy
import unittest
import uuid

support=runpy.run_path(str(Path(__file__).with_name('zatca-source-freeze-postgres.py')))
query,sql=support['query'],support['sql']


class Permissions(unittest.TestCase):
    def setUp(self):
        self.f=support['SourceFreeze']();self.f.setUp()

    def authenticated(self,statement,actor=None,error=None):
        return query('select set_config(\'request.jwt.claim.sub\','+sql(actor or self.f.actor)+',false);set role authenticated;'+statement,error)

    def test_editor_can_edit_unreserved_source_without_private_ledger_access(self):
        self.authenticated("update public.vat_einvoices set note_reason='QA' where id="+sql(self.f.doc))
        self.authenticated("update public.vat_einvoice_lines set description='QA' where invoice_id="+sql(self.f.doc))
        self.authenticated('select * from zatca_preparation.entries;',error='permission denied')
        self.authenticated(self.f.reserve(),error='permission denied')

    def test_frozen_header_and_child_edits_are_denied_to_authenticated_editor(self):
        query(self.f.auth()+self.f.reserve())
        self.authenticated("update public.vat_einvoices set status='ISSUED' where id="+sql(self.f.doc),error='EINVOICE_SOURCE_FROZEN')
        self.authenticated('update public.vat_einvoice_lines set unit_price=999 where invoice_id='+sql(self.f.doc),error='EINVOICE_SOURCE_FROZEN')

    def test_missing_subject_and_outsider_cannot_probe_freeze_lookup(self):
        query('set role authenticated;select zatca_preparation.source_is_frozen('+sql(self.f.org)+','+sql(self.f.doc)+');','UNAUTHORIZED')
        self.authenticated('select zatca_preparation.source_is_frozen('+sql(self.f.org)+','+sql(self.f.doc)+');',actor=str(uuid.uuid4()),error='VAT_FREEZE_ACCESS_DENIED')
        query('set role anon;select zatca_preparation.source_is_frozen('+sql(self.f.org)+','+sql(self.f.doc)+');','permission denied')

    def test_null_permission_result_fails_closed(self):
        self.authenticated('select zatca_preparation.source_is_frozen(null,'+sql(self.f.doc)+');',error='VAT_FREEZE_ACCESS_DENIED')

    def test_outsider_rls_hides_source_and_prevents_changes(self):
        outsider=str(uuid.uuid4())
        self.assertEqual(self.authenticated('select count(*) from public.vat_einvoices where id='+sql(self.f.doc),actor=outsider).splitlines()[-1],'0')
        self.authenticated('update public.vat_einvoice_lines set unit_price=999 where invoice_id='+sql(self.f.doc),actor=outsider)
        self.assertEqual(query('select unit_price from public.vat_einvoice_lines where invoice_id='+sql(self.f.doc)),'100.000000')

    def test_default_explicit_role_grants_are_revoked_not_just_public(self):
        for role in ['anon','authenticated','service_role']:
            self.assertEqual(query('select has_function_privilege('+sql(role)+",'zatca_preparation.finalize_saved(uuid,text,uuid,uuid,text,text,text)','EXECUTE')"),'f')
            for table in ['reservation_config','finalization_audit']:
                self.assertEqual(query('select has_table_privilege('+sql(role)+",'zatca_preparation."+table+"','SELECT')"),'f')
                self.assertEqual(query('select has_table_privilege('+sql(role)+",'zatca_preparation."+table+"','TRUNCATE')"),'f')
            for privilege in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']:
                self.assertEqual(query('select has_table_privilege('+sql(role)+",'zatca_preparation.entries',"+sql(privilege)+')'),'f')
            self.assertEqual(query('select has_function_privilege('+sql(role)+",'zatca_preparation.reserve_saved(uuid,uuid,text,jsonb)','EXECUTE')"),'f')
        self.assertEqual(query("select has_function_privilege('authenticated','zatca_preparation.source_is_frozen(uuid,uuid)','EXECUTE')"),'t')
        self.assertEqual(query("select prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='zatca_preparation.source_is_frozen(uuid,uuid)'::regprocedure"),'t')

    def test_lookups_reflect_reservation_after_parent_lock_wait(self):
        app='qa-permission-reserve-'+self.f.doc
        with ThreadPoolExecutor(max_workers=1) as pool:
            reservation=pool.submit(query,'set application_name='+sql(app)+';begin;'+self.f.auth()+self.f.reserve()+'select pg_sleep(0.8);commit;')
            self.f.wait_lock(app)
            self.authenticated('update public.vat_einvoice_lines set unit_price=999 where invoice_id='+sql(self.f.doc),error='EINVOICE_SOURCE_FROZEN')
            reservation.result()

    def test_revoked_membership_denies_boolean_lookup(self):
        query("update public.organization_members set status='INACTIVE' where user_id="+sql(self.f.actor))
        self.authenticated('select zatca_preparation.source_is_frozen('+sql(self.f.org)+','+sql(self.f.doc)+');',error='VAT_FREEZE_ACCESS_DENIED')


if __name__=='__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA')!='1' or os.environ.get('PGDATABASE')!='zatca_ledger_qa' or query('select current_database()')!='zatca_ledger_qa':
        raise SystemExit('Disposable ledger QA database required')
    # Minimal role-policy fixture only; the real policy/RPC proof is the separate QA script.
    query("""do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    grant usage on schema public,auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create or replace function public.has_organization_permission(p_org uuid,p_permission text) returns boolean
    language sql stable security definer set search_path=pg_catalog as $$
      select case when p_org is null then null else exists(select 1 from public.organization_members
        where organization_id=p_org and user_id=auth.uid() and role in ('OWNER','ADMIN') and status='ACTIVE') end
    $$;
    grant select,update on public.vat_einvoices,public.vat_einvoice_lines to authenticated;
    alter table public.vat_einvoices enable row level security;
    alter table public.vat_einvoice_lines enable row level security;
    create policy test_source_read on public.vat_einvoices for select to authenticated using(public.has_organization_permission(organization_id,'vat.view'));
    create policy test_source_edit on public.vat_einvoices for update to authenticated using(public.has_organization_permission(organization_id,'vat.edit')) with check(public.has_organization_permission(organization_id,'vat.edit'));
    create policy test_line_read on public.vat_einvoice_lines for select to authenticated using(exists(select 1 from public.vat_einvoices where id=invoice_id));
    create policy test_line_edit on public.vat_einvoice_lines for update to authenticated using(exists(select 1 from public.vat_einvoices where id=invoice_id)) with check(exists(select 1 from public.vat_einvoices where id=invoice_id));
    -- Reproduce broad explicit default grants to ensure the adapter removes them.
    grant usage on schema zatca_preparation to anon,authenticated,service_role;
    grant all on all tables in schema zatca_preparation to anon,authenticated,service_role;
    grant execute on all functions in schema zatca_preparation to anon,authenticated,service_role;
    """)
    query(Path(__file__).with_name('fixtures').joinpath('zatca-source-freeze-permissions.sql').read_text())
    unittest.main(verbosity=2)
