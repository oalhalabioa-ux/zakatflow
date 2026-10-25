"""Real PostgreSQL storage-contract QA. Requires a NEW disposable zatca_ledger_qa DB.
No Supabase credentials/production database, application roles or signing service.
Run: ZATCA_LEDGER_DISPOSABLE_QA=1 PGDATABASE=zatca_ledger_qa python3 tests/zatca-ledger-postgres.py
Use standard PGHOST/PGPORT/PGUSER/PGPASSWORD env vars; never log a connection URL.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import unittest
import uuid


def sql(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def query(statement, error=None):
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, text=True, capture_output=True, timeout=30)
    if error:
        assert result.returncode != 0 and error in result.stderr, result.stderr
        return None
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def record(statement):
    return json.loads(query('select row_to_json(r) from (' + statement + ') r;'))


class LedgerContract(unittest.TestCase):
    def setUp(self):
        self.org, self.unit, self.document, self.invoice = [str(uuid.uuid4()) for _ in range(4)]
        self.environment = 'SIMULATION'
        self.snapshot = {'invoice_number': 'TEST-1', 'total': '115.00', 'currency': 'SAR'}
        self.create_unit()

    def create_unit(self, org=None, unit=None, environment=None):
        query('insert into zatca_preparation.units(organization_id,environment,unit_id) values (' +
              ','.join(map(sql, [org or self.org, environment or self.environment, unit or self.unit])) + ');')

    def reserve_sql(self, document=None, invoice=None, snapshot=None, unit=None, org=None, environment=None):
        args = [org or self.org, environment or self.environment, unit or self.unit,
                document or self.document, invoice or self.invoice,
                json.dumps(self.snapshot if snapshot is None else snapshot)]
        return 'select * from zatca_preparation.reserve(' + ','.join(map(sql, args)) + ')'

    def reserve(self, **kwargs):
        return record(self.reserve_sql(**kwargs))

    def finalize_sql(self, entry, digest=None, payload='<synthetic-storage-fixture/>', hash_value=None, org=None):
        # Deliberately NOT a cryptographic/UBL fixture: this suite proves storage only.
        args = [org or self.org, self.environment, self.unit, entry['reservation_id'],
                entry['snapshot_digest'] if digest is None else digest,
                hash_value or base64.b64encode(hashlib.sha256(payload.encode()).digest()).decode(), payload]
        return 'select * from zatca_preparation.finalize(' + ','.join(map(sql, args)) + ')'

    def head(self):
        return record('select * from zatca_preparation.units where organization_id=' + sql(self.org) +
                      ' and environment=' + sql(self.environment) + ' and unit_id=' + sql(self.unit))

    def test_initial_hash_and_exact_snapshot(self):
        e = self.reserve()
        self.assertEqual(e['counter'], 1)
        self.assertEqual(base64.b64decode(e['previous_hash']).decode(), hashlib.sha256(b'0').hexdigest())
        self.assertEqual(e['snapshot'], self.snapshot)
        self.assertEqual(e['state'], 'RESERVED')
        self.assertEqual(self.head()['last_counter'], 0)
        self.assertEqual(self.reserve(), e)

    def test_identity_and_snapshot_conflicts(self):
        e = self.reserve()
        for args in [dict(snapshot={'total': '116.00'}), dict(invoice=str(uuid.uuid4()))]:
            query(self.reserve_sql(**args), 'RESERVATION_IDENTITY_CONFLICT')
        other = str(uuid.uuid4())
        self.create_unit(unit=other)
        query(self.reserve_sql(unit=other), 'RESERVATION_IDENTITY_CONFLICT')
        self.assertEqual(self.reserve(), e)

    def test_pending_blocks_next_but_other_unit_and_environment_continue(self):
        self.reserve()
        query(self.reserve_sql(document=str(uuid.uuid4()), invoice=str(uuid.uuid4())), 'UNIT_RESERVATION_PENDING')
        other = str(uuid.uuid4())
        self.create_unit(unit=other)
        self.assertEqual(self.reserve(document=str(uuid.uuid4()), invoice=str(uuid.uuid4()), unit=other)['counter'], 1)
        self.create_unit(environment='PRODUCTION')  # Synthetic partition; NOT real production.
        self.assertEqual(self.reserve(environment='PRODUCTION')['counter'], 1)

    def test_atomic_head_advance_and_old_retry_after_next_document(self):
        e = self.reserve()
        prepared = record(self.finalize_sql(e))
        self.assertEqual(prepared['state'], 'PREPARED')
        self.assertEqual(record(self.finalize_sql(e)), prepared)
        next_e = self.reserve(document=str(uuid.uuid4()), invoice=str(uuid.uuid4()))
        self.assertEqual(next_e['counter'], 2)
        self.assertEqual(next_e['previous_hash'], prepared['invoice_hash'])
        self.assertEqual(self.reserve(), prepared)
        self.assertEqual(record(self.finalize_sql(e)), prepared)
        self.assertEqual(self.head()['last_counter'], 1)

    def test_wrong_digest_and_changed_artifact_fail_closed(self):
        e = self.reserve()
        query(self.finalize_sql(e, digest='0'*64), 'SNAPSHOT_DIGEST_MISMATCH')
        self.assertEqual(self.head()['last_counter'], 0)
        record(self.finalize_sql(e))
        query(self.finalize_sql(e, payload='<changed/>'), 'PREPARED_ARTIFACT_CONFLICT')
        self.assertEqual(self.head()['last_counter'], 1)

    def test_transaction_failure_rolls_back_both_artifact_and_head(self):
        e = self.reserve()
        query('begin;' + self.finalize_sql(e) + '; select 1/0; commit;', 'division by zero')
        self.assertEqual(self.head()['last_counter'], 0)
        self.assertEqual(self.reserve()['state'], 'RESERVED')
        self.assertEqual(record(self.finalize_sql(e))['state'], 'PREPARED')

    def test_tenant_isolation_and_unknown_units(self):
        e = self.reserve()
        other = str(uuid.uuid4())
        self.create_unit(org=other)
        query(self.finalize_sql(e, org=other), 'RESERVATION_NOT_FOUND')
        query(self.reserve_sql(unit=str(uuid.uuid4())), 'UNIT_NOT_FOUND')
        self.assertEqual(self.reserve(org=other)['counter'], 1)

    def test_immutable_reservation_and_finalized_artifact(self):
        e = self.reserve()
        where = ' where reservation_id=' + sql(e['reservation_id'])
        query('update zatca_preparation.entries set snapshot=\'{"total":"1"}\'' + where, 'LEDGER_ENTRY_IMMUTABLE')
        query('delete from zatca_preparation.entries' + where, 'LEDGER_ENTRY_IMMUTABLE')
        record(self.finalize_sql(e))
        query("update zatca_preparation.entries set prepared_xml='<changed/>'" + where, 'LEDGER_ENTRY_IMMUTABLE')
        query('delete from zatca_preparation.entries' + where, 'LEDGER_ENTRY_IMMUTABLE')

    def test_invalid_payloads_and_counter_overflow(self):
        query(self.reserve_sql(snapshot={}), 'RESERVATION_INPUT_INVALID')
        e = self.reserve()
        for h in ['invalid', base64.b64encode(b'x'*64).decode(), 'A'*42+'B=']:
            query(self.finalize_sql(e, hash_value=h), 'ARTIFACT_INPUT_INVALID')
        query(self.finalize_sql(e, payload=''), 'ARTIFACT_INPUT_INVALID')
        other = str(uuid.uuid4())
        self.create_unit(unit=other)
        query('update zatca_preparation.units set last_counter=9223372036854775807 where unit_id=' + sql(other))
        query(self.reserve_sql(document=str(uuid.uuid4()), invoice=str(uuid.uuid4()), unit=other), 'COUNTER_EXHAUSTED')

    def test_duplicate_uuid_cannot_allocate_another_counter(self):
        e = self.reserve()
        record(self.finalize_sql(e))
        query(self.reserve_sql(document=str(uuid.uuid4())), 'duplicate key value')
        self.assertEqual(self.head()['last_counter'], 1)

    def test_sixteen_simultaneous_retries_share_one_reservation(self):
        barrier = threading.Barrier(16)
        def attempt(_):
            barrier.wait()
            return query('begin;' + self.reserve_sql() + '; select pg_sleep(0.025); commit;')
        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(attempt, range(16)))
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(self.head()['last_counter'], 0)
        self.assertEqual(query('select count(*) from zatca_preparation.entries where unit_id=' + sql(self.unit)), '1')

    def test_sixteen_different_concurrent_documents_cannot_fork_chain(self):
        barrier = threading.Barrier(16)
        def attempt(_):
            statement = self.reserve_sql(document=str(uuid.uuid4()), invoice=str(uuid.uuid4()))
            barrier.wait()
            result = subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'], input=statement,
                                    text=True, capture_output=True, timeout=30)
            if result.returncode:
                self.assertIn('UNIT_RESERVATION_PENDING', result.stderr)
                return 0
            return 1
        with ThreadPoolExecutor(max_workers=16) as pool:
            self.assertEqual(sum(pool.map(attempt, range(16))), 1)
        self.assertEqual(query('select count(*) from zatca_preparation.entries where unit_id=' + sql(self.unit)), '1')

    def test_simultaneous_finalization_is_idempotent(self):
        e = self.reserve()
        barrier = threading.Barrier(12)
        def attempt(_):
            barrier.wait()
            return record(self.finalize_sql(e))
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(attempt, range(12)))
        self.assertTrue(all(r == results[0] for r in results))
        self.assertEqual(self.head()['last_counter'], 1)

    def test_json_key_order_does_not_change_reservation(self):
        e = self.reserve()
        reordered = dict(reversed(list(self.snapshot.items())))
        self.assertEqual(self.reserve(snapshot=reordered), e)

    def test_head_conflict_does_not_finalize_or_clear_pending(self):
        e = self.reserve()
        query("update zatca_preparation.units set last_hash='operator-corrupted-head' where unit_id=" + sql(self.unit))
        query(self.finalize_sql(e), 'CHAIN_HEAD_CONFLICT')
        self.assertEqual(self.reserve()['state'], 'RESERVED')
        self.assertEqual(self.head()['last_counter'], 0)

    def test_competing_artifacts_preserve_one_exact_winner(self):
        e = self.reserve()
        barrier = threading.Barrier(2)
        def attempt(payload):
            barrier.wait()
            result = subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],
                                    input=self.finalize_sql(e, payload=payload), text=True,
                                    capture_output=True, timeout=30)
            if result.returncode:
                self.assertIn('PREPARED_ARTIFACT_CONFLICT', result.stderr)
                return None
            return payload
        with ThreadPoolExecutor(max_workers=2) as pool:
            winners = [x for x in pool.map(attempt, ['<first/>', '<second/>']) if x]
        self.assertEqual(len(winners), 1)
        self.assertEqual(self.reserve()['prepared_xml'], winners[0])
        self.assertEqual(self.head()['last_counter'], 1)

    def test_no_public_permissions_or_security_definer_functions(self):
        self.assertEqual(query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='zatca_preparation' and p.prosecdef"), '0')
        self.assertEqual(query("select count(*) from pg_tables where schemaname='zatca_preparation' and rowsecurity"), '2')
        query('set role zatca_ledger_client; select * from zatca_preparation.units;', 'permission denied')
        query('set role zatca_ledger_client;' + self.reserve_sql(), 'permission denied')


if __name__ == '__main__':
    if os.environ.get('ZATCA_LEDGER_DISPOSABLE_QA') != '1' or os.environ.get('PGDATABASE') != 'zatca_ledger_qa':
        raise SystemExit('Requires opt-in and a NEW disposable PGDATABASE=zatca_ledger_qa')
    if query('select current_database();') != 'zatca_ledger_qa':
        raise SystemExit('Unexpected database')
    query(Path(__file__).with_name('fixtures').joinpath('zatca-phase2-ledger.sql').read_text())
    query('create role zatca_ledger_client nologin;')
    unittest.main(verbosity=2)
