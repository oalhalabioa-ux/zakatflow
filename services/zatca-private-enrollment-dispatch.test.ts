import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentDispatch } from './zatca-private-enrollment-dispatch';

const input = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION',
  enrollmentId: randomUUID(), enrollmentDigest: 'a'.repeat(64), dispatchId: randomUUID() };
const actor = randomUUID(), token = 'SYNTHETIC.TOKEN', marker = 'PRIVATE_OTP_SECRET_DATABASE_PASSWORD';
function fixture() {
  const row = { acquired: true, dispatch_id: input.dispatchId, enrollment_id: input.enrollmentId,
    enrollment_digest: input.enrollmentDigest, organization_id: input.organizationId, connection_id: input.connectionId,
    environment: input.environment, state: 'INTENT_RECORDED', recorded_by: actor, recorded_at: '2026-10-25 12:00:00+00' };
  const state = { row, count: 1 };
  const client = Object.assign(new EventEmitter(), { query: vi.fn(async (sql: string, _params?: unknown[]) =>
    sql.includes('claim_initial_enrollment_dispatch') ? { rows: [structuredClone(state.row)], rowCount: state.count } : { rows: [], rowCount: 0 }),
  release: vi.fn(), end: vi.fn(async () => {}) });
  const auth = { getUser: vi.fn(async (_jwt?: string) => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null })) };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) };
  const store = createVerifiedZatcaEnrollmentDispatch(auth as never, pool as never);
  const claim = () => store.claimInitialDispatch(token, input);
  return { state, client, auth, pool, store, claim };
}
describe('private committed one-shot dispatch intent adapter', () => {
  it('commits one verified scoped intent before returning an internal first-intent decision', async () => {
    const f = fixture(), result = await f.claim();
    expect(result).toEqual({ stage: 'ENROLLMENT_DISPATCH_INTENT_ONLY', decision: 'FIRST_INTENT_RECORDED',
      dispatchId: input.dispatchId, enrollmentId: input.enrollmentId, enrollmentDigest: input.enrollmentDigest, recordedBy: actor, recordedAt: f.state.row.recorded_at });
    expect(f.auth.getUser).toHaveBeenCalledWith(token);
    expect(f.client.query.mock.calls.find(([sql]) => sql.includes('claim_initial_enrollment_dispatch'))?.[1])
      .toEqual([input.organizationId,input.environment,input.connectionId,input.enrollmentId,input.enrollmentDigest,input.dispatchId]);
    const calls = f.client.query.mock.calls.map(([sql]) => sql); expect(calls.at(-2)).toBe('COMMIT');
    expect(calls.at(-1)).toContain("claim.email','',false"); expect(f.client.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('requires reconciliation on replay, preserving the first actor/time instead of issuing another first-intent decision', async () => {
    const f = fixture(); f.state.row.acquired = false; f.state.row.recorded_by = randomUUID();
    const result = await f.claim(); expect(result.decision).toBe('RECONCILIATION_REQUIRED'); expect(result.recordedBy).toBe(f.state.row.recorded_by);
  });
  it.each(['otp','csrPem','url','actorId','role','retry','force','expiresAt'])('rejects caller %s overrides before Auth/SQL', async field => {
    const f = fixture(); await expect(f.store.claimInitialDispatch(token, { ...input, [field]: marker })).rejects.toThrow('ENROLLMENT_DISPATCH_INPUT_INVALID');
    expect(f.auth.getUser).not.toHaveBeenCalled(); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['token','digest','dispatch','environment'])('rejects malformed %s without contacting Auth', async mode => {
    const f = fixture(); const bad = { ...input };
    if (mode === 'digest') bad.enrollmentDigest = 'bad'; if (mode === 'dispatch') bad.dispatchId = 'invalid' as never;
    if (mode === 'environment') bad.environment = 'LIVE';
    await expect(f.store.claimInitialDispatch(mode === 'token' ? 'bad token' : token, bad)).rejects.toThrow('ENROLLMENT_DISPATCH_INPUT_INVALID');
    expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it('rejects unverified Auth before acquiring a database client', async () => {
    const f = fixture(); f.auth.getUser.mockRejectedValue(new Error(marker));
    await expect(f.claim()).rejects.toThrow('UNAUTHORIZED'); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['organization_id','connection_id','environment','dispatch_id','enrollment_id','enrollment_digest','recorded_by','state','recorded_at','acquired'])('rejects mismatched or malformed %s receipt before COMMIT', async field => {
    const f = fixture(); Object.assign(f.state.row, { [field]: field === 'acquired' ? 'true' : field === 'environment' ? 'PRODUCTION'
      : field === 'enrollment_digest' ? 'b'.repeat(64) : field === 'recorded_at' ? 'bad' : field === 'state' ? 'SENT' : randomUUID() });
    await expect(f.claim()).rejects.toThrow('ENROLLMENT_DISPATCH_RECEIPT_INVALID');
    expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT'); expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it('rejects missing persistence results rather than inventing a first claim', async () => {
    const f = fixture(); f.state.count = 0; await expect(f.claim()).rejects.toThrow('ENROLLMENT_DISPATCH_RECEIPT_INVALID');
  });
  it.each(['ORGANIZATION_ADMIN_REQUIRED','ENROLLMENT_DISPATCH_CHANGED','ENROLLMENT_DISPATCH_DIGEST_MISMATCH','ENROLLMENT_UNIT_CHANGED'])('preserves exact private SQL denial %s after rollback', async message => {
    const f = fixture(), base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql, params) => { if (sql.includes('claim_initial_enrollment_dispatch')) throw Object.assign(new Error(message), { code: 'P0001' }); return base(sql, params); });
    await expect(f.claim()).rejects.toThrow(message); expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it.each(['connect','sql','commit','cleanup','release'])('returns no first-intent decision and redacts %s failure', async step => {
    const f = fixture(), base = f.client.query.getMockImplementation()!;
    if (step === 'connect') f.pool.connect.mockRejectedValue(new Error(marker));
    else if (step === 'release') f.client.release.mockImplementation(() => { throw new Error(marker); });
    else f.client.query.mockImplementation(async (sql, params) => {
      if ((step === 'sql' && sql.includes('claim_initial_enrollment_dispatch')) || (step === 'commit' && sql === 'COMMIT')
        || (step === 'cleanup' && sql.includes("claim.sub','',false") && f.client.query.mock.calls.length > 3)) throw Object.assign(new Error(marker), { code: 'P0001' });
      return base(sql, params);
    });
    const error = await f.claim().catch(error => error); expect(error.message).toMatch(/^ENROLLMENT_DATABASE_(UNAVAILABLE|DISPATCH_FAILED|CLEANUP_FAILED)$/);
    expect(String(error)).not.toContain(marker); if (step === 'release') expect(f.client.end).toHaveBeenCalled();
  });
  it('captures the operation before asynchronous Auth', async () => {
    const f = fixture(), captured = { ...input }; let resume!: () => void;
    f.auth.getUser.mockImplementationOnce(async () => { await new Promise<void>(r => { resume = r; }); return { data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null } as never; });
    const pending = f.store.claimInitialDispatch(token, captured); captured.dispatchId = randomUUID(); resume();
    expect((await pending).dispatchId).toBe(input.dispatchId);
  });
});
