import { Pool } from 'pg';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createZatcaCsr } from '../lib/vat-zatca-csr';
import { createVerifiedZatcaEnrollmentWriter } from './zatca-private-enrollment-writer';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';

const enabled = process.env.ZATCA_PRIVATE_WRITER_SQL_QA === '1';
let pool: Pool;
const fields = { environment: 'SIMULATION' as const, commonName: 'Saved EGS', taxpayerVatNumber: '312345678901233', branchName: 'فرع الرياض',
  organizationName: 'شركة اختبار', serialNumber: '1-QA|2-1|3-unit', invoiceType: '1100' as const, registeredAddress: 'الرياض', businessCategory: 'البرمجيات', email: 'qa@example.invalid' };
async function fixture() {
  const f = JSON.parse(execFileSync('python3', ['-c', "import runpy,json; s=runpy.run_path('tests/zatca-source-freeze-postgres.py'); f=s['SourceFreeze'](); f.setUp(); print(json.dumps(dict(org=f.org,actor=f.actor,connection=f.connection)))"], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  const kms = 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID();
  await pool.query("update public.vat_einvoice_connections set status='KEY_READY',credentials_secret_arn=null,kms_key_arn=$2,common_name=$3,"
    + 'legal_name=$4,branch_name=$5,branch_location=$6,industry=$7,egs_serial_number=$8 where id=$1',
  [f.connection,kms,fields.commonName,fields.organizationName,fields.branchName,fields.registeredAddress,fields.businessCategory,fields.serialNumber]);
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const spki = keys.publicKey.export({ type: 'spki', format: 'der' });
  const csr = (email = fields.email) => createZatcaCsr({ ...fields, email }, spki, async bytes => sign('sha256', bytes, keys.privateKey));
  const original = { enrollmentId: randomUUID(), csrPem: await csr(), kmsKeyArn: kms, kmsPublicKeySpkiBase64: spki.toString('base64'), email: fields.email };
  const auth = { getUser: async () => ({ data: { user: { id: f.actor, aud: 'authenticated', is_anonymous: false } }, error: null }) };
  const target = { organizationId: f.org, connectionId: f.connection, environment: 'SIMULATION' };
  const writer = createVerifiedZatcaEnrollmentWriter(auth as never, pool);
  const write = () => writer.preserveOriginalEnrollment('SYNTHETIC.TOKEN', target, original);
  const saved = async () => (await pool.query('select enrollment_id,recorded_by,recorded_at::text from zatca_preparation.enrollment_requests where connection_id=$1', [f.connection])).rows;
  return { f, auth, target, original, writer, write, saved, csr };
}
async function cleanContexts() {
  const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
  try {
    for (const c of clients) {
      const r = (await c.query("select auth.uid() as actor,nullif(current_setting('request.jwt.claims',true),'') as claims,"
        + "nullif(current_setting('request.jwt.claim',true),'') as legacy_jwt,nullif(current_setting('request.jwt.claim.role',true),'') as role,"
        + "nullif(current_setting('request.jwt.claim.email',true),'') as email")).rows[0];
      expect(Object.values(r)).toEqual([null,null,null,null,null]);
    }
  } finally { clients.forEach(c => c.release()); }
}
beforeAll(async () => {
  if (!enabled) return;
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  pool = new Pool({ max: 4, connectionTimeoutMillis: 2000, query_timeout: 7000, application_name: 'zatca-private-writer-qa' });
  expect((await pool.query('select current_database() as name')).rows[0].name).toBe('zatca_ledger_qa');
});
afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!enabled)('private writer real PostgreSQL preservation and retry integration', () => {
  it('preserves a real signed CSR under the verified actor, reads that exact request and leaves clean pooled contexts', async () => {
    const f = await fixture(), receipt = await f.write();
    const read = await createVerifiedZatcaEnrollmentReader(f.auth as never, pool).loadOriginalEnrollment('SYNTHETIC.TOKEN', f.target);
    expect(read.enrollmentId).toBe(receipt.enrollmentId); expect(read.enrollmentDigest).toBe(receipt.enrollmentDigest);
    expect(read.csrPem).toBe(f.original.csrPem); expect(read.savedUnit.legalName).toBe(fields.organizationName);
    expect(await f.saved()).toEqual([{ enrollment_id: receipt.enrollmentId, recorded_by: f.f.actor, recorded_at: receipt.recordedAt }]);
    await cleanContexts();
  });
  it('serializes eight concurrent exact retries into one immutable row with the first actor/time', async () => {
    const f = await fixture(); const results = await Promise.all(Array.from({ length: 8 }, f.write));
    results.forEach(r => expect(r).toEqual(results[0])); expect(await f.saved()).toHaveLength(1); await cleanContexts();
  });
  it('rejects a replacement operation identifier and retains the first saved row', async () => {
    const f = await fixture(), first = await f.write(); f.original.enrollmentId = randomUUID();
    await expect(f.write()).rejects.toThrow('ORIGINAL_ENROLLMENT_CHANGED');
    expect((await f.saved())[0].enrollment_id).toBe(first.enrollmentId); await cleanContexts();
  });
  it('rejects a different valid same-key signed CSR rather than silently replacing the original', async () => {
    const f = await fixture(), first = await f.write(); f.original.email = 'other@example.invalid'; f.original.csrPem = await f.csr(f.original.email);
    await expect(f.write()).rejects.toThrow('ORIGINAL_ENROLLMENT_CHANGED');
    expect((await f.saved())[0].enrollment_id).toBe(first.enrollmentId);
  });
  it('denies cross-company or revoked membership before inserting any request', async () => {
    const f = await fixture(), other = await fixture();
    await expect(f.writer.preserveOriginalEnrollment('SYNTHETIC.TOKEN', other.target, other.original)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
    await pool.query("update public.organization_members set status='INACTIVE' where organization_id=$1", [f.f.org]);
    await expect(f.write()).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED'); expect(await f.saved()).toHaveLength(0); expect(await other.saved()).toHaveLength(0);
    await cleanContexts();
  });
  it('fails closed on a changed saved KMS reference or legal identity without leaving a request', async () => {
    const f = await fixture(); await pool.query('update public.vat_einvoice_connections set kms_key_arn=$2 where id=$1', [f.f.connection, f.original.kmsKeyArn + 'changed']);
    await expect(f.write()).rejects.toThrow('ENROLLMENT_KEY_CHANGED');
    await pool.query("update public.vat_einvoice_connections set kms_key_arn=$2,legal_name='Other saved company' where id=$1", [f.f.connection, f.original.kmsKeyArn]);
    await expect(f.write()).rejects.toThrow('ORIGINAL_CSR_INVALID'); expect(await f.saved()).toHaveLength(0);
  });
  it('permits an exact retry after credentials appear but never backfills an already-onboarded connection', async () => {
    const f = await fixture(), first = await f.write(), other = await fixture();
    for (const id of [f.f.connection, other.f.connection]) await pool.query("update public.vat_einvoice_connections set status='COMPLIANCE_PASSED',credentials_secret_arn='SYNTHETIC-CREDENTIAL-REFERENCE' where id=$1", [id]);
    expect(await f.write()).toEqual(first); await expect(other.write()).rejects.toThrow('INITIAL_ENROLLMENT_STATE_REQUIRED'); expect(await other.saved()).toHaveLength(0);
  });
  it('recovers an ambiguous COMMIT acknowledgement through the exact original operation without a second row', async () => {
    const f = await fixture(); let once = true;
    const uncertainPool = { connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => {
          const result = await target.query(sql, params);
          if (sql === 'COMMIT' && once) { once = false; throw new Error('SYNTHETIC_LOST_COMMIT_ACK'); } return result;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    const writer = createVerifiedZatcaEnrollmentWriter(f.auth as never, uncertainPool as never);
    await expect(writer.preserveOriginalEnrollment('SYNTHETIC.TOKEN', f.target, f.original)).rejects.toThrow('ENROLLMENT_DATABASE_WRITE_FAILED');
    const before = await f.saved(); expect(before).toHaveLength(1);
    const retry = await f.write(); expect(retry.enrollmentId).toBe(before[0].enrollment_id); expect(retry.recordedAt).toBe(before[0].recorded_at);
    expect(await f.saved()).toEqual(before); await cleanContexts();
  });
  it('keeps the first actor/time when another active company admin retries the exact original operation', async () => {
    const f = await fixture(), first = await f.write(), actor = randomUUID();
    await pool.query("insert into public.organization_members values($1,$2,'OWNER','ACTIVE')", [f.f.org, actor]);
    const auth = { getUser: async () => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null }) };
    const retry = await createVerifiedZatcaEnrollmentWriter(auth as never, pool).preserveOriginalEnrollment('SYNTHETIC.TOKEN', f.target, f.original);
    expect(retry).toEqual(first); expect(retry.recordedBy).toBe(f.f.actor);
  });
  it('allows one original operation to win competing simultaneous identifiers without a duplicate record', async () => {
    const f = await fixture(), other = { ...f.original, enrollmentId: randomUUID() };
    const results = await Promise.allSettled([f.write(), f.writer.preserveOriginalEnrollment('SYNTHETIC.TOKEN', f.target, other)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => r.status === 'rejected' ? r.reason.message : '')).toEqual(['ORIGINAL_ENROLLMENT_CHANGED']);
    expect(await f.saved()).toHaveLength(1); await cleanContexts();
  });
  it('rolls back the actual insert if the returned persistence receipt fails validation', async () => {
    const f = await fixture();
    const corruptedPool = { connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, params?: unknown[]) => {
          const result = await target.query(sql, params);
          if (sql.includes('begin_initial_enrollment')) result.rows[0].integrity_valid = false;
          return result;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    await expect(createVerifiedZatcaEnrollmentWriter(f.auth as never, corruptedPool as never)
      .preserveOriginalEnrollment('SYNTHETIC.TOKEN', f.target, f.original)).rejects.toThrow('ENROLLMENT_WRITE_INTEGRITY_INVALID');
    expect(await f.saved()).toHaveLength(0); await cleanContexts();
  });
  it('waits for membership revocation and authorizes from the committed current row', async () => {
    const f = await fixture(), admin = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000 });
    try {
      await admin.query('begin'); await admin.query("update public.organization_members set status='INACTIVE' where organization_id=$1", [f.f.org]);
      const pending = f.write().then(value => ({ value }), error => ({ error }));
      let waiting = false;
      for (let i = 0; i < 30; i++) {
        await admin.query('select pg_stat_clear_snapshot()');
        const r = await admin.query("select exists(select 1 from pg_stat_activity where application_name='zatca-private-writer-qa' and wait_event_type='Lock') as waiting");
        if (r.rows[0].waiting) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true); await admin.query('commit'); const result = await pending;
      expect('error' in result ? result.error.message : 'unexpected success').toBe('ORGANIZATION_ADMIN_REQUIRED'); expect(await f.saved()).toHaveLength(0);
    } finally { await admin.query('rollback'); await admin.end(); }
    await cleanContexts();
  });
});
