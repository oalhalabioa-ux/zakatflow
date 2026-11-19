import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentResponseStore } from './zatca-private-enrollment-response';
const input = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION', enrollmentId: randomUUID(), dispatchId: randomUUID() };
function fixture() {
  const actor = randomUUID(), stamp = 'a'.repeat(64), digest = 'b'.repeat(64), key = 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID();
  const state = { member: { role: 'ADMIN', status: 'ACTIVE' }, memberCount: 1, connectionCount: 1, receiptCount: 1,
    connection: { id: input.connectionId, organization_id: input.organizationId, environment: 'SIMULATION', kms_key_arn: key, status: 'KEY_READY', credentials_secret_arn: null as string|null, unit_stamp: stamp },
    receipt: { organization_id: input.organizationId, connection_id: input.connectionId, environment: 'SIMULATION', unit_stamp: stamp,
      enrollment_id: input.enrollmentId, enrollment_digest: digest, dispatch_id: input.dispatchId, dispatch_digest: digest,
      reference: { version: 'ZATCA_ENROLLMENT_QUARANTINE_V1', secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:synthetic-ABC123', secretVersionId: input.dispatchId,
        encryptionKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID(), responseSha256: 'c'.repeat(64), binarySecurityTokenSha256: 'd'.repeat(64) },
      receipt_digest: 'e'.repeat(64), recorded_by: actor, recorded_at: '2026-10-25 14:00:00+00', integrity_valid: true, original_integrity_valid: true } };
  const client = Object.assign(new EventEmitter(), { query: vi.fn(async (sql: string,_params?: unknown[]) => {
    if (sql.includes('from public.organization_members')) return { rows: [structuredClone(state.member)], rowCount: state.memberCount };
    if (sql.includes('from public.vat_einvoice_connections')) return { rows: [structuredClone(state.connection)], rowCount: state.connectionCount };
    if (sql.includes('from zatca_preparation.enrollment_requests')) return { rows: [structuredClone(state.receipt)], rowCount: state.receiptCount };
    return { rows: [], rowCount: 0 };
  }), release: vi.fn(), end: vi.fn(async () => {}) });
  const auth = { getUser: vi.fn(async (_token?: string) => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null })) };
  const pool = { connect: vi.fn(async () => client) }, store = createVerifiedZatcaEnrollmentResponseStore(auth as never,pool as never);
  const load = () => store.loadResponseForVerification('SYNTHETIC.TOKEN',input);
  return { state, actor, client, auth, pool, store, load };
}
describe('authorized original/dispatch response reference load', () => {
  it('reads the exact private original/dispatch/receipt with current locks, checksum checks and clean identity', async () => {
    const f = fixture(), r = await f.load(); expect(r).toEqual({ stage: 'AUTHORIZED_RESPONSE_REFERENCE_READ_ONLY', ...input,
      enrollmentDigest: f.state.receipt.enrollment_digest, kmsKeyArn: f.state.connection.kms_key_arn, reference: f.state.receipt.reference, receiptDigest: f.state.receipt.receipt_digest });
    const calls = f.client.query.mock.calls; expect(calls.filter(([sql]) => sql.includes('for share'))).toHaveLength(2);
    expect(calls.find(([sql]) => sql.includes('from zatca_preparation.enrollment_requests'))?.[1]).toEqual([input.organizationId,input.connectionId,'SIMULATION',input.enrollmentId,input.dispatchId]);
    expect(calls.at(-2)?.[0]).toBe('COMMIT'); expect(calls.at(-1)?.[0]).toContain("claim.email','',false");
  });
  it.each(['enrollmentDigest','secretArn','certificate','role','actorId'])('rejects caller %s before Auth', async field => {
    const f = fixture(); await expect(f.store.loadResponseForVerification('SYNTHETIC.TOKEN',{ ...input,[field]: 'override' })).rejects.toThrow('ENROLLMENT_RESPONSE_READ_INPUT_INVALID'); expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it.each(['missing','inactive','viewer'])('denies %s current membership before loading references', async mode => {
    const f = fixture(); if (mode === 'missing') f.state.memberCount = 0; if (mode === 'inactive') f.state.member.status = 'INACTIVE'; if (mode === 'viewer') f.state.member.role = 'VIEWER';
    await expect(f.load()).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED'); expect(f.client.query.mock.calls.some(([sql]) => sql.includes('vat_einvoice_connections'))).toBe(false);
  });
  it.each(['id','organization_id','environment'])('denies a wrong connection %s', async field => {
    const f = fixture(); Object.assign(f.state.connection,{ [field]: field === 'environment' ? 'PRODUCTION' : randomUUID() });
    await expect(f.load()).rejects.toThrow('ENROLLMENT_RESPONSE_READ_SCOPE_INVALID');
  });
  it.each(['organization_id','connection_id','environment','enrollment_id','dispatch_id'])('denies a wrong receipt %s', async field => {
    const f = fixture(); Object.assign(f.state.receipt,{ [field]: field === 'environment' ? 'PRODUCTION' : randomUUID() });
    await expect(f.load()).rejects.toThrow('ENROLLMENT_RESPONSE_READ_SCOPE_INVALID');
  });
  it.each(['integrity_valid','original_integrity_valid','dispatch_digest','versionId'])('rejects corrupt %s before returning a private reference', async field => {
    const f = fixture(); if (field === 'versionId') f.state.receipt.reference.secretVersionId = randomUUID();
    else Object.assign(f.state.receipt,{ [field]: field === 'dispatch_digest' ? '0'.repeat(64) : false });
    await expect(f.load()).rejects.toThrow('ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID'); expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
  });
  it('rejects missing connection/receipt and a changed unit', async () => {
    const f = fixture(); f.state.connectionCount = 0; await expect(f.load()).rejects.toThrow('EINVOICE_CONNECTION_NOT_FOUND');
    f.state.connectionCount = 1; f.state.receiptCount = 0; await expect(f.load()).rejects.toThrow('ENROLLMENT_RESPONSE_REFERENCE_REQUIRED');
    f.state.receiptCount = 1; f.state.connection.unit_stamp = '0'.repeat(64); await expect(f.load()).rejects.toThrow('ENROLLMENT_UNIT_CHANGED');
  });
  it.each(['status','credentials'])('refuses an already advanced connection %s', async mode => {
    const f = fixture(); if (mode === 'status') f.state.connection.status = 'COMPLIANCE_PASSED'; else f.state.connection.credentials_secret_arn = 'SYNTHETIC';
    await expect(f.load()).rejects.toThrow('INITIAL_ENROLLMENT_STATE_REQUIRED');
  });
  it('requires a canonical immutable KMS key reference', async () => {
    const f = fixture(); f.state.connection.kms_key_arn = 'alias/key'; await expect(f.load()).rejects.toThrow('ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID');
  });
  it('sanitizes unexpected SQL diagnostics', async () => {
    const f = fixture(); f.client.query.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD')); await expect(f.load()).rejects.toThrow('ENROLLMENT_DATABASE_RESPONSE_READ_FAILED'); expect(f.client.release).toHaveBeenCalledWith(true);
  });
});
