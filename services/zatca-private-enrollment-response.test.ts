import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentResponseStore } from './zatca-private-enrollment-response';

function fixture() {
  const context = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION', enrollmentId: randomUUID(), enrollmentDigest: 'a'.repeat(64), dispatchId: randomUUID() };
  const actor = randomUUID(), reference = { version: 'ZATCA_ENROLLMENT_QUARANTINE_V1', secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:quarantine-ABC123',
    secretVersionId: context.dispatchId, encryptionKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID(), responseSha256: 'b'.repeat(64), binarySecurityTokenSha256: 'c'.repeat(64) };
  const row = { dispatch_id: context.dispatchId, enrollment_id: context.enrollmentId, enrollment_digest: context.enrollmentDigest, reference,
    receipt_digest: 'd'.repeat(64), recorded_by: actor, recorded_at: '2026-10-25 13:00:00+00', integrity_valid: true };
  const state = { row, count: 1 };
  const client = Object.assign(new EventEmitter(), { query: vi.fn(async (sql: string, _params?: unknown[]) => sql.includes('record_enrollment_response_reference') ? { rows: [structuredClone(state.row)], rowCount: state.count } : { rows: [], rowCount: 0 }), release: vi.fn(), end: vi.fn(async () => {}) });
  const auth = { getUser: vi.fn(async (_jwt?: string) => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null })) };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) }, store = createVerifiedZatcaEnrollmentResponseStore(auth as never, { connect: async () => client } as never);
  const record = () => store.recordResponseReference('SYNTHETIC.TOKEN', context, reference);
  return { context, reference, state, actor, client, auth, pool, store, record };
}
describe('private unverified response reference persistence', () => {
  it('records only the exact opaque reference and validates receipt before COMMIT/cleanup', async () => {
    const f = fixture(), r = await f.record(); expect(r.stage).toBe('ENROLLMENT_RESPONSE_REFERENCE_RECORDED_ONLY'); expect(r.reference).toEqual(f.reference);
    const call = f.client.query.mock.calls.find(([sql]) => sql.includes('record_enrollment_response_reference'))!;
    expect(call[1]).toEqual([f.context.organizationId,'SIMULATION',f.context.connectionId,f.context.enrollmentId,f.context.enrollmentDigest,f.context.dispatchId,JSON.stringify(f.reference)]);
    expect(f.client.query.mock.calls.at(-2)?.[0]).toBe('COMMIT'); expect(f.client.query.mock.calls.at(-1)?.[0]).toContain("claim.email','',false");
  });
  it.each(['secret','binarySecurityToken','otp','certificate','actorId'])('rejects extra %s in reference before Auth', async field => {
    const f = fixture(); await expect(f.store.recordResponseReference('SYNTHETIC.TOKEN', f.context, { ...f.reference, [field]: 'PRIVATE' })).rejects.toThrow('ENROLLMENT_RESPONSE_REFERENCE_INPUT_INVALID'); expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it('requires VersionId to equal the saved dispatch ID before Auth', async () => {
    const f = fixture(); f.reference.secretVersionId = randomUUID(); await expect(f.record()).rejects.toThrow('ENROLLMENT_RESPONSE_REFERENCE_INPUT_INVALID'); expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it('denies unverified Auth before attempting persistence', async () => {
    const f = fixture(); f.auth.getUser.mockRejectedValue(new Error('PRIVATE_PASSWORD')); await expect(f.record()).rejects.toThrow('UNAUTHORIZED'); expect(f.client.query).not.toHaveBeenCalled();
  });
  it.each(['dispatch_id','enrollment_id','enrollment_digest','reference','integrity_valid','recorded_at'])('rolls back a wrong %s receipt', async field => {
    const f = fixture(); Object.assign(f.state.row, { [field]: field === 'reference' ? { ...f.reference, responseSha256: '0'.repeat(64) } : field === 'integrity_valid' ? false : field === 'recorded_at' ? 'bad' : field === 'enrollment_digest' ? '0'.repeat(64) : randomUUID() });
    await expect(f.record()).rejects.toThrow('ENROLLMENT_RESPONSE_RECEIPT_INVALID'); expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
  });
  it('rejects no receipt without committing', async () => {
    const f = fixture(); f.state.count = 0; await expect(f.record()).rejects.toThrow('ENROLLMENT_RESPONSE_RECEIPT_INVALID');
  });
  it('preserves a prior original actor on a currently authorized retry', async () => {
    const f = fixture(); f.state.row.recorded_by = randomUUID(); expect((await f.record()).recordedBy).toBe(f.state.row.recorded_by);
  });
  it.each(['ENROLLMENT_DISPATCH_REQUIRED','ENROLLMENT_RESPONSE_REFERENCE_CHANGED','ORGANIZATION_ADMIN_REQUIRED'])('returns exact private denial %s', async message => {
    const f = fixture(), base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql,params) => { if (sql.includes('record_enrollment_response_reference')) throw Object.assign(new Error(message), { code: 'P0001' }); return base(sql,params); });
    await expect(f.record()).rejects.toThrow(message); expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it('sanitizes an unknown SQL error and discards the failed connection', async () => {
    const f = fixture(), base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql,params) => { if (sql.includes('record_enrollment_response_reference')) throw Object.assign(new Error('PRIVATE_PASSWORD'), { code: 'P0001' }); return base(sql,params); });
    await expect(f.record()).rejects.toThrow('ENROLLMENT_DATABASE_RESPONSE_FAILED'); expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('captures the reference before asynchronous Auth', async () => {
    const f = fixture(); let resume!: () => void; const original = structuredClone(f.reference);
    f.auth.getUser.mockImplementationOnce(async () => { await new Promise<void>(r => { resume = r; }); return { data: { user: { id: f.actor, aud: 'authenticated', is_anonymous: false } }, error: null } as never; });
    const pending = f.record(); f.reference.responseSha256 = '0'.repeat(64); f.state.row.reference = original; resume(); expect((await pending).reference).toEqual(original);
  });
});
