import { Pool } from 'pg';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';

const enabled = process.env.ZATCA_PRIVATE_READER_SQL_QA === '1';
let pool: Pool, actorA: Record<string, string>, actorB: Record<string, string>;
const target = (f: Record<string, string>) => ({ organizationId: f.org, connectionId: f.connection, environment: 'SIMULATION' });
function source() {
  return JSON.parse(execFileSync('python3', ['-c', "import runpy,json; s=runpy.run_path('tests/zatca-source-freeze-postgres.py'); f=s['SourceFreeze'](); f.setUp(); print(json.dumps(dict(org=f.org,actor=f.actor,connection=f.connection)))"],
    { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
}
function auth() {
  return { getUser: vi.fn(async (token?: string) => ({ data: { user: { id: token === 'SYNTHETIC.A' ? actorA.actor : actorB.actor,
    aud: 'authenticated', is_anonymous: false, user_metadata: { role: 'OWNER' } } }, error: null })) };
}
function reader() { return createVerifiedZatcaEnrollmentReader(auth() as never, pool); }
async function cleanContext() {
  const row = (await pool.query("select nullif(current_setting('request.jwt.claim.sub',true),'') as subject,"
    + "nullif(current_setting('request.jwt.claims',true),'') as claims,auth.uid() as actor,pg_backend_pid() as pid")).rows[0];
  expect(row.subject).toBeNull(); expect(row.claims).toBeNull(); expect(row.actor).toBeNull(); return row.pid;
}
beforeAll(async () => {
  if (!enabled) return;
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  pool = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000, application_name: 'zatca-private-reader-qa' });
  expect((await pool.query('select current_database() as name')).rows[0].name).toBe('zatca_ledger_qa');
  actorA = source(); actorB = source();
  for (const f of [actorA, actorB]) {
    // SQL storage fixture only: native CSR/certificate validation has its own suite.
    await pool.query("update public.vat_einvoice_connections set status='KEY_READY',credentials_secret_arn=null,egs_serial_number='1-QA|2-1|3-unit' where id=$1", [f.connection]);
    await pool.query('begin');
    await pool.query("select set_config('request.jwt.claim.sub',$1,true)", [f.actor]);
    const e = await pool.query("select row_to_json(r) as row from zatca_preparation.begin_initial_enrollment($1,'SIMULATION',$2,gen_random_uuid(),'MAA=','MAA=','qa@example.invalid') r", [f.org, f.connection]);
    f.enrollment = e.rows[0].row.enrollment_id;
    await pool.query('commit');
  }
});
afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!enabled)('private pg reader disposable session and revocation integration', () => {
  it('uses the verified actor even on a pre-poisoned pooled session, then leaves no JWT identity behind', async () => {
    const pid = (await pool.query('select pg_backend_pid() as pid')).rows[0].pid;
    await pool.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [actorB.actor, JSON.stringify({ sub: actorB.actor, role: 'service_role' })]);
    const result = await reader().loadOriginalEnrollment('SYNTHETIC.A', target(actorA));
    expect(result.actorId).toBe(actorA.actor); expect(result.enrollmentId).toBe(actorA.enrollment);
    expect(result.csrPem).toBe('-----BEGIN CERTIFICATE REQUEST-----\nMAA=\n-----END CERTIFICATE REQUEST-----\n');
    expect(await cleanContext()).toBe(pid);
  });
  it('rolls back an unfinished released transaction before reading the original saved identity', async () => {
    const client = await pool.connect();
    await client.query('begin'); await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actorB.actor]);
    await client.query("update public.vat_einvoice_connections set legal_name='UNCOMMITTED_TEST_VALUE' where id=$1", [actorA.connection]);
    client.release();
    const result = await reader().loadOriginalEnrollment('SYNTHETIC.A', target(actorA));
    expect(result.actorId).toBe(actorA.actor); expect(result.savedUnit.legalName).not.toBe('UNCOMMITTED_TEST_VALUE');
    expect((await pool.query('select legal_name from public.vat_einvoice_connections where id=$1', [actorA.connection])).rows[0].legal_name).toBe(result.savedUnit.legalName);
    await cleanContext();
  });
  it('isolates two authorized actors and denies cross-company reads on the same physical connection', async () => {
    const r = reader(), pid = await cleanContext();
    expect((await r.loadOriginalEnrollment('SYNTHETIC.B', target(actorB))).savedUnit.organizationId).toBe(actorB.org);
    await expect(r.loadOriginalEnrollment('SYNTHETIC.A', target(actorB))).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
    expect((await r.loadOriginalEnrollment('SYNTHETIC.A', target(actorA))).savedUnit.organizationId).toBe(actorA.org);
    expect(await cleanContext()).toBe(pid);
  });
  it('keeps concurrent requests scoped while sharing a one-connection pool', async () => {
    const r = reader(); const requests = Array.from({ length: 8 }, (_, i) => i % 2 ? actorA : actorB);
    const results = await Promise.all(requests.map(f => r.loadOriginalEnrollment(f === actorA ? 'SYNTHETIC.A' : 'SYNTHETIC.B', target(f))));
    results.forEach((result, i) => { expect(result.actorId).toBe(requests[i].actor); expect(result.savedUnit.organizationId).toBe(requests[i].org); });
    await cleanContext();
  });
  it('rechecks membership after waiting for a revocation transaction instead of using a stale preflight role', async () => {
    const admin = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000 });
    try {
      await admin.query('begin');
      await admin.query("update public.organization_members set status='INACTIVE' where organization_id=$1 and user_id=$2", [actorA.org, actorA.actor]);
      const pending = reader().loadOriginalEnrollment('SYNTHETIC.A', target(actorA)).then(value => ({ value }), error => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const row = await admin.query("select exists(select 1 from pg_stat_activity where application_name='zatca-private-reader-qa' and wait_event_type='Lock') as waiting");
        if (row.rows[0].waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true); await admin.query('commit');
      const result = await pending; expect('error' in result ? result.error.message : 'unexpected success').toBe('ORGANIZATION_ADMIN_REQUIRED');
      await cleanContext();
    } finally {
      await admin.query('rollback');
      await admin.query("update public.organization_members set status='ACTIVE' where organization_id=$1 and user_id=$2", [actorA.org, actorA.actor]);
      await admin.end();
    }
  });
});
