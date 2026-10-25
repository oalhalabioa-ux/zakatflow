import { Pool } from 'pg';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifiedZatcaEnrollmentResponseStore } from './zatca-private-enrollment-response';
const enabled = process.env.ZATCA_PRIVATE_RESPONSE_SQL_QA === '1';
let pool: Pool;
async function fixture() {
  const f = JSON.parse(execFileSync('python3', ['-c', "import runpy,json; s=runpy.run_path('tests/zatca-enrollment-response-postgres.py'); f=s['Response'](); f.setUp(); print(json.dumps(dict(org=f.f.org,actor=f.f.actor,connection=f.f.connection,enrollment=f.enrollment,digest=f.original['enrollment_digest'],dispatch=f.dispatch,reference=f.reference)))"], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  const context = { organizationId: f.org, connectionId: f.connection, environment: 'SIMULATION', enrollmentId: f.enrollment, enrollmentDigest: f.digest, dispatchId: f.dispatch };
  const auth = { getUser: async () => ({ data: { user: { id: f.actor, aud: 'authenticated', is_anonymous: false } }, error: null }) };
  const store = createVerifiedZatcaEnrollmentResponseStore(auth as never, pool), record = () => store.recordResponseReference('SYNTHETIC.TOKEN', context, f.reference);
  const saved = async () => (await pool.query('select dispatch_id,recorded_by,recorded_at::text from zatca_preparation.enrollment_response_receipts where dispatch_id=$1', [f.dispatch])).rows;
  return { f, context, auth, store, record, saved };
}
async function clean() {
  const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
  try { for (const c of clients) expect(Object.values((await c.query("select auth.uid() as actor,nullif(current_setting('request.jwt.claims',true),'') as claims,nullif(current_setting('request.jwt.claim',true),'') as legacy,nullif(current_setting('request.jwt.claim.role',true),'') as role,nullif(current_setting('request.jwt.claim.email',true),'') as email")).rows[0])).toEqual([null,null,null,null,null]); }
  finally { clients.forEach(c => c.release()); }
}
beforeAll(async () => {
  if (!enabled) return;
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  pool = new Pool({ max: 4, connectionTimeoutMillis: 2000, query_timeout: 7000, application_name: 'zatca-private-response-qa' });
  expect((await pool.query('select current_database() as name')).rows[0].name).toBe('zatca_ledger_qa');
});
afterAll(async () => { if (pool) await pool.end(); });
describe.skipIf(!enabled)('private opaque response receipt real PostgreSQL integration', () => {
  it('preserves first actor/time on exact retry without activating the connection', async () => {
    const f = await fixture(), r = await f.record(); expect(await f.record()).toEqual(r);
    expect((await pool.query('select status,credentials_secret_arn from public.vat_einvoice_connections where id=$1', [f.f.connection])).rows[0]).toEqual({ status: 'KEY_READY', credentials_secret_arn: null }); await clean();
  });
  it('deduplicates eight simultaneous records', async () => {
    const f = await fixture(), rows = await Promise.all(Array.from({ length: 8 }, f.record)); rows.forEach(r => expect(r).toEqual(rows[0])); expect(await f.saved()).toHaveLength(1); await clean();
  });
  it.each(['commit','cleanup'])('reconciles a real committed receipt after injected lost %s acknowledgement', async step => {
    const f = await fixture(); let injected = false;
    const uncertainPool = { connect: async () => {
      const c = await pool.connect(); let committed = false;
      return new Proxy(c, { get(target,key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => {
          const r = await target.query(sql, params); if (sql === 'COMMIT') committed = true;
          if (!injected && committed && ((step === 'commit' && sql === 'COMMIT') || (step === 'cleanup' && sql.includes("claim.sub','',false")))) { injected = true; throw new Error('SYNTHETIC_LOST_ACK'); } return r;
        };
        const v = Reflect.get(target,key); return typeof v === 'function' ? v.bind(target) : v;
      } });
    } };
    await expect(createVerifiedZatcaEnrollmentResponseStore(f.auth as never, uncertainPool as never).recordResponseReference('SYNTHETIC.TOKEN', f.context, f.f.reference)).rejects.toThrow(/ENROLLMENT_DATABASE_(RESPONSE_FAILED|CLEANUP_FAILED)/);
    const first = await f.saved(); expect(first).toHaveLength(1); const retry = await f.record(); expect(retry.recordedAt).toBe(first[0].recorded_at); expect(await f.saved()).toEqual(first); await clean();
  });
  it('rolls back the real insert when its returned receipt is inconsistent', async () => {
    const f = await fixture(); const corruptPool = { connect: async () => {
      const c = await pool.connect(); return new Proxy(c, { get(target,key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => { const r = await target.query(sql, params); if (sql.includes('record_enrollment_response_reference')) r.rows[0].integrity_valid = false; return r; };
        const v = Reflect.get(target,key); return typeof v === 'function' ? v.bind(target) : v;
      } });
    } };
    await expect(createVerifiedZatcaEnrollmentResponseStore(f.auth as never, corruptPool as never).recordResponseReference('SYNTHETIC.TOKEN', f.context, f.f.reference)).rejects.toThrow('ENROLLMENT_RESPONSE_RECEIPT_INVALID'); expect(await f.saved()).toHaveLength(0); await clean();
  });
  it('waits for committed membership revocation before writing a receipt', async () => {
    const f = await fixture(), admin = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000 });
    try {
      await admin.query('begin'); await admin.query("update public.organization_members set status='INACTIVE' where organization_id=$1", [f.f.org]);
      const pending = f.record().then(value => ({ value }), error => ({ error })); let waiting = false;
      for (let i = 0; i < 30; i++) {
        await admin.query('select pg_stat_clear_snapshot()'); const r = await admin.query("select exists(select 1 from pg_stat_activity where application_name='zatca-private-response-qa' and wait_event_type='Lock') as waiting");
        if (r.rows[0].waiting) { waiting = true; break; } await new Promise(r => setTimeout(r,25));
      }
      expect(waiting).toBe(true); await admin.query('commit'); const r = await pending; expect('error' in r ? r.error.message : 'unexpected success').toBe('ORGANIZATION_ADMIN_REQUIRED'); expect(await f.saved()).toHaveLength(0);
    } finally { await admin.query('rollback'); await admin.end(); }
    await clean();
  });
});
