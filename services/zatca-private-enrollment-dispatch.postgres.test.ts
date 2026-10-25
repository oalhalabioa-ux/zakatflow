import { Pool } from 'pg';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifiedZatcaEnrollmentDispatch } from './zatca-private-enrollment-dispatch';

const enabled = process.env.ZATCA_PRIVATE_DISPATCH_SQL_QA === '1';
let pool: Pool;
async function fixture() {
  const f = JSON.parse(execFileSync('python3', ['-c', "import runpy,json; s=runpy.run_path('tests/zatca-source-freeze-postgres.py'); f=s['SourceFreeze'](); f.setUp(); print(json.dumps(dict(org=f.org,actor=f.actor,connection=f.connection)))"], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  await pool.query("update public.vat_einvoice_connections set status='KEY_READY',credentials_secret_arn=null where id=$1", [f.connection]);
  const client = await pool.connect(); let original;
  try {
    await client.query('begin'); await client.query("select set_config('request.jwt.claim.sub',$1,true)", [f.actor]);
    // Persistence fixture only. Actual CSR verification is the separate native round trip.
    original = (await client.query("select r.enrollment_id,r.enrollment_digest from zatca_preparation.begin_initial_enrollment($1,'SIMULATION',$2,$3,'MAA=','MAA=','qa@example.invalid') r", [f.org,f.connection,randomUUID()])).rows[0];
    await client.query('commit');
  } finally { await client.query('rollback'); client.release(); }
  const input = { organizationId: f.org, environment: 'SIMULATION', connectionId: f.connection, enrollmentId: original.enrollment_id,
    enrollmentDigest: original.enrollment_digest, dispatchId: randomUUID() };
  const auth = { getUser: async () => ({ data: { user: { id: f.actor, aud: 'authenticated', is_anonymous: false } }, error: null }) };
  const store = createVerifiedZatcaEnrollmentDispatch(auth as never, pool);
  const claim = () => store.claimInitialDispatch('SYNTHETIC.TOKEN', input);
  const saved = async () => (await pool.query('select dispatch_id,recorded_by,recorded_at::text from zatca_preparation.enrollment_dispatch_intents where enrollment_id=$1', [input.enrollmentId])).rows;
  return { f, input, auth, store, claim, saved };
}
async function clean() {
  const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
  try {
    for (const c of clients) expect(Object.values((await c.query("select auth.uid() as actor,nullif(current_setting('request.jwt.claims',true),'') as claims,"
      + "nullif(current_setting('request.jwt.claim',true),'') as legacy_jwt,nullif(current_setting('request.jwt.claim.role',true),'') as role,"
      + "nullif(current_setting('request.jwt.claim.email',true),'') as email")).rows[0])).toEqual([null,null,null,null,null]);
  } finally { clients.forEach(c => c.release()); }
}
beforeAll(async () => {
  if (!enabled) return;
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  pool = new Pool({ max: 4, connectionTimeoutMillis: 2000, query_timeout: 7000, application_name: 'zatca-private-dispatch-qa' });
  expect((await pool.query('select current_database() as name')).rows[0].name).toBe('zatca_ledger_qa');
});
afterAll(async () => { if (pool) await pool.end(); });
describe.skipIf(!enabled)('private dispatch fence real PostgreSQL ambiguity handling', () => {
  it('commits one first intent and always requests reconciliation on replay', async () => {
    const f = await fixture(), first = await f.claim(); expect(first.decision).toBe('FIRST_INTENT_RECORDED');
    expect(await f.claim()).toEqual({ ...first, decision: 'RECONCILIATION_REQUIRED' }); expect(await f.saved()).toHaveLength(1); await clean();
  });
  it('allows only one first decision across eight simultaneous committed clients', async () => {
    const f = await fixture(), rows = await Promise.all(Array.from({ length: 8 }, f.claim));
    expect(rows.filter(r => r.decision === 'FIRST_INTENT_RECORDED')).toHaveLength(1);
    expect(rows.filter(r => r.decision === 'RECONCILIATION_REQUIRED')).toHaveLength(7); expect(await f.saved()).toHaveLength(1); await clean();
  });
  it.each(['commit','cleanup'])('does not reacquire after a real committed intent with an injected lost %s acknowledgement', async step => {
    const f = await fixture(); let injected = false;
    const uncertainPool = { connect: async () => {
      const c = await pool.connect(); let committed = false;
      return new Proxy(c, { get(target, key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => {
          const r = await target.query(sql, params); if (sql === 'COMMIT') committed = true;
          if (!injected && committed && ((step === 'commit' && sql === 'COMMIT') || (step === 'cleanup' && sql.includes("claim.sub','',false")))) {
            injected = true; throw new Error('SYNTHETIC_LOST_ACK');
          } return r;
        };
        const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v;
      } });
    } };
    await expect(createVerifiedZatcaEnrollmentDispatch(f.auth as never, uncertainPool as never).claimInitialDispatch('SYNTHETIC.TOKEN', f.input))
      .rejects.toThrow(/ENROLLMENT_DATABASE_(DISPATCH_FAILED|CLEANUP_FAILED)/);
    const saved = await f.saved(); expect(saved).toHaveLength(1);
    const retry = await f.claim(); expect(retry.decision).toBe('RECONCILIATION_REQUIRED'); expect(retry.recordedAt).toBe(saved[0].recorded_at);
    expect(await f.saved()).toEqual(saved); await clean();
  });
  it('rolls back a new intent when the adapter rejects its returned receipt', async () => {
    const f = await fixture();
    const corruptPool = { connect: async () => {
      const c = await pool.connect(); return new Proxy(c, { get(target, key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => {
          const r = await target.query(sql, params); if (sql.includes('claim_initial_enrollment_dispatch')) r.rows[0].enrollment_digest = '0'.repeat(64); return r;
        };
        const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v;
      } });
    } };
    await expect(createVerifiedZatcaEnrollmentDispatch(f.auth as never, corruptPool as never).claimInitialDispatch('SYNTHETIC.TOKEN', f.input)).rejects.toThrow('ENROLLMENT_DISPATCH_RECEIPT_INVALID');
    expect(await f.saved()).toHaveLength(0); expect((await f.claim()).decision).toBe('FIRST_INTENT_RECORDED'); await clean();
  });
  it('denies a revoked actor on replay without deleting or reacquiring the prior intent', async () => {
    const f = await fixture(); await f.claim(); await pool.query("update public.organization_members set status='INACTIVE' where organization_id=$1", [f.f.org]);
    await expect(f.claim()).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED'); expect(await f.saved()).toHaveLength(1); await clean();
  });
  it('waits for a pending revocation and does not grant a first intent using stale membership', async () => {
    const f = await fixture(), admin = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000 });
    try {
      await admin.query('begin'); await admin.query("update public.organization_members set status='INACTIVE' where organization_id=$1", [f.f.org]);
      const pending = f.claim().then(value => ({ value }), error => ({ error })); let waiting = false;
      for (let i = 0; i < 30; i++) {
        await admin.query('select pg_stat_clear_snapshot()');
        const r = await admin.query("select exists(select 1 from pg_stat_activity where application_name='zatca-private-dispatch-qa' and wait_event_type='Lock') as waiting");
        if (r.rows[0].waiting) { waiting = true; break; } await new Promise(r => setTimeout(r, 25));
      }
      expect(waiting).toBe(true); await admin.query('commit'); const result = await pending;
      expect('error' in result ? result.error.message : 'unexpected success').toBe('ORGANIZATION_ADMIN_REQUIRED'); expect(await f.saved()).toHaveLength(0);
    } finally { await admin.query('rollback'); await admin.end(); }
    await clean();
  });
});
