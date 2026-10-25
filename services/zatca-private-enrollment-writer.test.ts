import type { Pool, PoolClient } from 'pg';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createZatcaCsr } from '../lib/vat-zatca-csr';
import { createVerifiedZatcaEnrollmentWriter } from './zatca-private-enrollment-writer';

const org = randomUUID(), connectionId = randomUUID(), actor = randomUUID();
const target = { organizationId: org, connectionId, environment: 'SIMULATION' };
const token = 'SYNTHETIC.ACCESS.TOKEN', marker = 'PRIVATE_DATABASE_PASSWORD';
async function fixture() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const spki = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const c = { id: connectionId, organization_id: org, environment: 'SIMULATION',
    kms_key_arn: 'arn:aws:kms:me-south-1:123456789012:key/' + randomUUID(), taxpayer_vat_number: '312345678901233',
    common_name: 'Saved unit', branch_name: 'فرع الرياض', legal_name: 'شركة اختبار', egs_serial_number: '1-QA|2-1|3-unit',
    invoice_type: '1100', branch_location: 'الرياض', industry: 'البرمجيات' };
  const csrPem = await createZatcaCsr({ environment: 'SIMULATION', commonName: c.common_name, taxpayerVatNumber: c.taxpayer_vat_number,
    branchName: c.branch_name, organizationName: c.legal_name, serialNumber: c.egs_serial_number, invoiceType: '1100',
    registeredAddress: c.branch_location, businessCategory: c.industry, email: 'qa@example.invalid' }, Buffer.from(spki, 'base64'), async bytes => sign('sha256', bytes, keys.privateKey));
  const original = { enrollmentId: randomUUID() as string, csrPem, kmsKeyArn: c.kms_key_arn, kmsPublicKeySpkiBase64: spki, email: 'qa@example.invalid' };
  const csr = csrPem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, '');
  const expected = { ...target, unitId: connectionId, profile: 'ZAKATFLOW_SAN_DIRECTORY_V1', csrSha256: createHash('sha256').update(Buffer.from(csr, 'base64')).digest('hex'),
    kmsPublicKeySpkiBase64: spki, taxpayerVatNumber: c.taxpayer_vat_number, commonName: c.common_name, branchName: c.branch_name,
    legalName: c.legal_name, egsSerialNumber: c.egs_serial_number, invoiceType: c.invoice_type, branchLocation: c.branch_location, industry: c.industry, email: original.email };
  const receipt = { enrollment_id: original.enrollmentId, enrollment_digest: 'a'.repeat(64), organization_id: org, connection_id: connectionId,
    environment: 'SIMULATION', csr_der_base64: csr, expected_identity: expected, recorded_by: actor, recorded_at: '2026-10-25 10:00:00+00', integrity_valid: true };
  const state = { member: { role: 'ADMIN', status: 'ACTIVE' }, connection: c, receipt, memberCount: 1, connectionCount: 1 };
  const client = Object.assign(new EventEmitter(), { query: vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('from public.organization_members')) return { rows: [structuredClone(state.member)], rowCount: state.memberCount };
    if (sql.includes('from public.vat_einvoice_connections')) return { rows: [structuredClone(state.connection)], rowCount: state.connectionCount };
    if (sql.includes('from zatca_preparation.begin_initial_enrollment')) return { rows: [structuredClone(state.receipt)], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }), release: vi.fn(), end: vi.fn(async () => {}) });
  const auth = { getUser: vi.fn(async (_token?: string) => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false,
    user_metadata: { role: 'OWNER' } } }, error: null })) };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) };
  const writer = createVerifiedZatcaEnrollmentWriter(auth as never, pool as unknown as Pick<Pool, 'connect'>);
  const write = () => writer.preserveOriginalEnrollment(token, target, original);
  return { keys, original, state, client, auth, pool, writer, write };
}
const written = (f: Awaited<ReturnType<typeof fixture>>) => f.client.query.mock.calls.filter(([sql]) => sql.includes('begin_initial_enrollment'));

describe('private verified initial enrollment preservation', () => {
  it('verifies an actual signed Arabic CSR against saved data, writes exact parameters and returns a minimal receipt', async () => {
    const f = await fixture(), result = await f.write();
    expect(result).toEqual({ stage: 'ORIGINAL_ENROLLMENT_PRESERVED_ONLY', enrollmentId: f.original.enrollmentId,
      enrollmentDigest: 'a'.repeat(64), recordedBy: actor, recordedAt: f.state.receipt.recorded_at });
    expect(f.auth.getUser).toHaveBeenCalledWith(token); expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(written(f)[0][1]).toEqual([org, 'SIMULATION', connectionId, f.original.enrollmentId, f.state.receipt.csr_der_base64, f.original.kmsPublicKeySpkiBase64, f.original.email]);
    const sql = f.client.query.mock.calls.map(([sql]) => sql);
    expect(sql.find(x => x.includes('vat_einvoice_connections'))).toContain('for update');
    expect(sql.indexOf('COMMIT')).toBeGreaterThan(sql.findIndex(x => x.includes('begin_initial_enrollment')));
    expect(sql.at(-1)).toContain("claim.email','',false"); expect(f.client.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(result)).not.toContain(f.original.email); expect(JSON.stringify(result)).not.toContain('CERTIFICATE REQUEST');
  });
  it.each(['actorId','role','expectedIdentity','sql','certificate'])('rejects extra %s input without contacting Auth or SQL', async field => {
    const f = await fixture(); await expect(f.writer.preserveOriginalEnrollment(token, target, { ...f.original, [field]: actor })).rejects.toThrow('ENROLLMENT_WRITE_INPUT_INVALID');
    expect(f.auth.getUser).not.toHaveBeenCalled(); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['target','token','email','operation','keyAlias'])('rejects malformed %s before Auth', async mode => {
    const f = await fixture();
    if (mode === 'email') f.original.email = 'qa@example.invalid\n';
    if (mode === 'operation') f.original.enrollmentId = 'invalid';
    if (mode === 'keyAlias') f.original.kmsKeyArn = f.original.kmsKeyArn.replace('key/', 'alias/');
    await expect(f.writer.preserveOriginalEnrollment(mode === 'token' ? 'bad token' : token,
      mode === 'target' ? { ...target, userId: actor } : target, f.original)).rejects.toThrow('ENROLLMENT_WRITE_INPUT_INVALID');
    expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it('rejects unverified Auth before pool acquisition', async () => {
    const f = await fixture(); f.auth.getUser.mockRejectedValue(new Error(marker));
    await expect(f.write()).rejects.toThrow('UNAUTHORIZED'); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['inactive','viewer','missing'])('rechecks %s membership and never attempts a write', async mode => {
    const f = await fixture(); if (mode === 'inactive') f.state.member.status = 'INACTIVE';
    if (mode === 'viewer') f.state.member.role = 'VIEWER'; if (mode === 'missing') f.state.memberCount = 0;
    await expect(f.write()).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED'); expect(written(f)).toHaveLength(0);
  });
  it.each(['missing','scope','key','savedIdentity'])('rejects %s saved connection before writing', async mode => {
    const f = await fixture(); if (mode === 'missing') f.state.connectionCount = 0;
    if (mode === 'scope') f.state.connection.organization_id = randomUUID();
    if (mode === 'key') f.state.connection.kms_key_arn += 'changed';
    if (mode === 'savedIdentity') f.state.connection.taxpayer_vat_number = 'invalid';
    await expect(f.write()).rejects.toThrow(/EINVOICE_CONNECTION_NOT_FOUND|ENROLLMENT_(WRITE_SCOPE_MISMATCH|KEY_CHANGED|SAVED_UNIT_INVALID)/);
    expect(written(f)).toHaveLength(0);
  });
  it.each(['signature','key','savedName','email','malformed'])('rejects %s CSR discrepancy without persisting', async mode => {
    const f = await fixture();
    if (mode === 'signature') { const der = Buffer.from(f.state.receipt.csr_der_base64, 'base64'); der[der.length - 1] ^= 1;
      f.original.csrPem = '-----BEGIN CERTIFICATE REQUEST-----\n' + der.toString('base64') + '\n-----END CERTIFICATE REQUEST-----\n'; }
    if (mode === 'key') f.original.kmsPublicKeySpkiBase64 = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    if (mode === 'savedName') f.state.connection.legal_name += ' modified';
    if (mode === 'email') f.original.email = 'other@example.invalid';
    if (mode === 'malformed') f.original.csrPem = 'not a CSR';
    await expect(f.write()).rejects.toThrow('ORIGINAL_CSR_INVALID'); expect(written(f)).toHaveLength(0);
  });
  it.each(['scope','operation','identity','csr','checksum','time'])('rolls back an inconsistent %s persistence receipt', async mode => {
    const f = await fixture();
    if (mode === 'scope') f.state.receipt.organization_id = randomUUID();
    if (mode === 'operation') f.state.receipt.enrollment_id = randomUUID();
    if (mode === 'identity') f.state.receipt.expected_identity.commonName += 'changed';
    if (mode === 'csr') f.state.receipt.csr_der_base64 = 'MAA=';
    if (mode === 'checksum') f.state.receipt.integrity_valid = false;
    if (mode === 'time') f.state.receipt.recorded_at = 'invalid';
    await expect(f.write()).rejects.toThrow('ENROLLMENT_WRITE_INTEGRITY_INVALID');
    expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT'); expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it('preserves the original actor/time on exact retries by another authorized admin', async () => {
    const f = await fixture(); f.state.receipt.recorded_by = randomUUID();
    expect((await f.write()).recordedBy).toBe(f.state.receipt.recorded_by);
  });
  it.each(['ORIGINAL_ENROLLMENT_CHANGED','INITIAL_ENROLLMENT_STATE_REQUIRED'])('returns only the contract denial %s after rollback', async message => {
    const f = await fixture(), base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql, params) => { if (sql.includes('begin_initial_enrollment')) throw Object.assign(new Error(message), { code: 'P0001' }); return base(sql, params); });
    await expect(f.write()).rejects.toThrow(message); expect(f.client.release).toHaveBeenCalledWith(false);
    expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
  });
  it.each(['sql','commit','cleanup','release'])('redacts %s failure, discards the client and returns no receipt', async step => {
    const f = await fixture(), base = f.client.query.getMockImplementation()!;
    if (step === 'release') f.client.release.mockImplementation(() => { throw new Error(marker); });
    else f.client.query.mockImplementation(async (sql, params) => {
      if ((step === 'sql' && sql.includes('begin_initial_enrollment')) || (step === 'commit' && sql === 'COMMIT')
        || (step === 'cleanup' && sql.includes("claim.sub','',false") && f.client.query.mock.calls.length > 3)) throw Object.assign(new Error(marker), { code: 'P0001' });
      return base(sql, params);
    });
    const error = await f.write().catch(error => error);
    expect(error.message).toMatch(/^ENROLLMENT_DATABASE_(WRITE_FAILED|CLEANUP_FAILED)$/); expect(String(error)).not.toContain(marker);
    if (step !== 'release') expect(f.client.release).toHaveBeenCalledWith(true); else expect(f.client.end).toHaveBeenCalled();
  });
  it('captures original inputs before asynchronous authentication', async () => {
    const f = await fixture(); let resume!: () => void;
    f.auth.getUser.mockImplementationOnce(async () => { await new Promise<void>(resolve => { resume = resolve; }); return { data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null } as never; });
    const pending = f.write(); f.original.email = 'changed@example.invalid'; f.original.enrollmentId = randomUUID(); resume();
    expect((await pending).enrollmentId).toBe(f.state.receipt.enrollment_id);
  });
});
