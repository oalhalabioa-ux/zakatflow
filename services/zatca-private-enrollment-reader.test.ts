import { createClient } from '@supabase/supabase-js';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';

const org = 'e800b1c2-df4a-4a79-9b91-4a451ce2858a', connectionId = 'e800b1c2-df4a-4a79-9b91-4a451ce2858b';
const actor = 'e800b1c2-df4a-4a79-9b91-4a451ce2858c', other = 'e800b1c2-df4a-4a79-9b91-4a451ce2858d';
const target = { organizationId: org, connectionId, environment: 'SIMULATION' };
const token = 'SYNTHETIC.ACCESS.TOKEN', secretMarker = 'DO_NOT_RETURN_DB_PASSWORD_OR_TOKEN';
function fixture() {
  const csr = Buffer.from('SYNTHETIC_PUBLIC_CSR_ONLY'), stamp = 'a'.repeat(64);
  const rows = {
    member: { role: 'ADMIN', status: 'ACTIVE' },
    connection: { id: connectionId, organization_id: org, environment: 'SIMULATION', unit_stamp: stamp },
    enrollment: { enrollment_id: other, organization_id: org, environment: 'SIMULATION', connection_id: connectionId,
      unit_stamp: stamp, enrollment_digest: 'b'.repeat(64), csr_der_base64: csr.toString('base64'), integrity_valid: true,
      expected_identity: { organizationId: org, connectionId, unitId: connectionId, environment: 'SIMULATION', profile: 'ZAKATFLOW_SAN_DIRECTORY_V1',
        csrSha256: createHash('sha256').update(csr).digest('hex'), kmsPublicKeySpkiBase64: 'MAA=', taxpayerVatNumber: '312345678901233',
        commonName: 'Saved unit', branchName: 'Riyadh', legalName: 'Synthetic company', egsSerialNumber: '1-QA|2-1|3-unit',
        invoiceType: '1100', branchLocation: 'Riyadh', industry: 'Software', email: 'qa@example.invalid' } },
  };
  const count = { member: 1, connection: 1, enrollment: 1 };
  const client = Object.assign(new EventEmitter(), { query: vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('from public.organization_members')) return { rows: [structuredClone(rows.member)], rowCount: count.member };
    if (sql.includes('from public.vat_einvoice_connections')) return { rows: [structuredClone(rows.connection)], rowCount: count.connection };
    if (sql.includes('from zatca_preparation.enrollment_requests')) return { rows: [structuredClone(rows.enrollment)], rowCount: count.enrollment };
    return { rows: [], rowCount: 0 };
  }), release: vi.fn(), end: vi.fn(async () => {}) });
  const auth = { getUser: vi.fn(async (_jwt?: string) => ({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: false,
    user_metadata: { role: 'OWNER', organization_id: org } } }, error: null })) };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) };
  const reader = createVerifiedZatcaEnrollmentReader(auth as never, pool as unknown as Pick<Pool, 'connect'>);
  return { rows, count, client, auth, pool, reader };
}

describe('verified auth and dedicated private PostgreSQL enrollment read', () => {
  it('verifies the token with Auth and uses one scoped client/transaction with local identity and explicit cleanup', async () => {
    const f = fixture(); const result = await f.reader.loadOriginalEnrollment(token, target);
    expect(result.stage).toBe('AUTHORIZED_ENROLLMENT_READ_ONLY'); expect(result.actorId).toBe(actor);
    expect(result.enrollmentId).toBe(other); expect(result.savedUnit.organizationId).toBe(org);
    expect(result.csrPem).toContain(f.rows.enrollment.csr_der_base64);
    expect(f.auth.getUser).toHaveBeenCalledWith(token); expect(f.pool.connect).toHaveBeenCalledTimes(1);
    const calls = f.client.query.mock.calls;
    expect(calls[0][0]).toBe('ROLLBACK'); expect(calls[2][0]).toBe('BEGIN');
    const identity = calls.find(([sql]) => sql.includes("set_config('request.jwt.claim.sub',$1,true)"))!;
    expect(identity[1]).toEqual([actor, JSON.stringify({ sub: actor, role: 'authenticated' })]);
    expect(identity[0]).toContain("set_config('request.jwt.claim','',true)");
    expect(identity[0]).toContain("set_config('request.jwt.claim.role','authenticated',true)");
    expect(identity[0]).toContain("set_config('request.jwt.claim.email','',true)");
    expect(calls.at(-1)![0]).toContain("set_config('request.jwt.claim','',false)");
    expect(calls.at(-1)![0]).toContain("set_config('request.jwt.claim.role','',false)");
    expect(calls.at(-1)![0]).toContain("set_config('request.jwt.claim.email','',false)");
    expect(calls.find(([sql]) => sql.includes('from public.organization_members'))?.[1]).toEqual([org, actor]);
    expect(calls.filter(([sql]) => sql.includes('for share'))).toHaveLength(2);
    expect(calls.at(-2)![0]).toBe('COMMIT'); expect(calls.at(-1)![0]).toContain("claim.sub','',false");
    expect(JSON.stringify(calls)).not.toContain(token); expect(JSON.stringify(result)).not.toContain(token);
    expect(f.client.release).toHaveBeenCalledWith(false); expect(f.client.listenerCount('error')).toBe(0);
  });
  it.each(['userId','actorId','role','enrollmentId','csrPem','sql','certificate'])('rejects request %s before Auth/database access', async field => {
    const f = fixture(); await expect(f.reader.loadOriginalEnrollment(token, { ...target, [field]: other })).rejects.toThrow('ENROLLMENT_READ_INPUT_INVALID');
    expect(f.auth.getUser).not.toHaveBeenCalled(); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['', 'token\nforged', 'Bearer token', 'x'.repeat(16385)])('rejects malformed/oversized token without forwarding it', async bad => {
    const f = fixture(); await expect(f.reader.loadOriginalEnrollment(bad, target)).rejects.toThrow('ENROLLMENT_READ_INPUT_INVALID'); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['remoteError','missingUser','wrongAudience','anonymous','invalidSubject'])('denies %s Auth results without a database connection', async mode => {
    const f = fixture();
    if (mode === 'remoteError') f.auth.getUser.mockRejectedValue(new Error(secretMarker));
    if (mode === 'missingUser') f.auth.getUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    if (mode === 'wrongAudience') f.auth.getUser.mockResolvedValue({ data: { user: { id: actor, aud: 'service_role' } }, error: null } as never);
    if (mode === 'anonymous') f.auth.getUser.mockResolvedValue({ data: { user: { id: actor, aud: 'authenticated', is_anonymous: true } }, error: null } as never);
    if (mode === 'invalidSubject') f.auth.getUser.mockResolvedValue({ data: { user: { id: 'not-a-uuid', aud: 'authenticated' } }, error: null } as never);
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('UNAUTHORIZED'); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['missing','inactive','viewer'])('denies %s current membership despite forged user_metadata admin role', async mode => {
    const f = fixture(); if (mode === 'missing') f.count.member = 0;
    if (mode === 'inactive') f.rows.member.status = 'INACTIVE'; if (mode === 'viewer') f.rows.member.role = 'VIEWER';
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
    expect(f.client.query.mock.calls.some(([sql]) => sql.includes('vat_einvoice_connections'))).toBe(false);
    expect(f.client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(2);
    expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it.each(['id','organization_id','environment'])('checks returned connection %s scope instead of trusting query shape', async field => {
    const f = fixture(); Object.assign(f.rows.connection, { [field]: field === 'environment' ? 'PRODUCTION' : other });
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ENROLLMENT_READ_SCOPE_MISMATCH');
  });
  it('denies missing source/enrollment and stale unit identity', async () => {
    const f = fixture(); f.count.connection = 0;
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('EINVOICE_CONNECTION_NOT_FOUND');
    f.count.connection = 1; f.count.enrollment = 0;
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ORIGINAL_ENROLLMENT_REQUIRED');
    f.count.enrollment = 1; f.rows.enrollment.unit_stamp = 'c'.repeat(64);
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ENROLLMENT_UNIT_CHANGED');
  });
  it.each(['outerScope','innerScope','checksum','csrDigest','csrEncoding','unknownProfile'])('rejects corrupted saved %s data', async mode => {
    const f = fixture();
    if (mode === 'outerScope') f.rows.enrollment.organization_id = other;
    if (mode === 'innerScope') f.rows.enrollment.expected_identity.unitId = other;
    if (mode === 'checksum') f.rows.enrollment.integrity_valid = false;
    if (mode === 'csrDigest') f.rows.enrollment.expected_identity.csrSha256 = '0'.repeat(64);
    if (mode === 'csrEncoding') f.rows.enrollment.csr_der_base64 += '=';
    if (mode === 'unknownProfile') f.rows.enrollment.expected_identity.profile = 'AUTO';
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow(/ENROLLMENT_READ_(SCOPE_MISMATCH|INTEGRITY_INVALID)/);
  });
  it('redacts connection/query failures and discards a failed database connection', async () => {
    const f = fixture(); f.pool.connect.mockRejectedValueOnce(new Error(secretMarker));
    const first = await f.reader.loadOriginalEnrollment(token, target).catch(error => error);
    expect(first.message).toBe('ENROLLMENT_DATABASE_UNAVAILABLE'); expect(first.cause).toBeUndefined();
    f.client.query.mockRejectedValueOnce(new Error(secretMarker));
    const second = await f.reader.loadOriginalEnrollment(token, target).catch(error => error);
    expect(second.message).toBe('ENROLLMENT_DATABASE_READ_FAILED'); expect(String(second)).not.toContain(secretMarker);
    expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('discards the connection if rollback fails', async () => {
    const f = fixture(), original = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql, params) => {
      if (sql.includes('from public.organization_members')) throw new Error(secretMarker);
      if (sql === 'ROLLBACK' && f.client.query.mock.calls.length > 1) throw new Error(secretMarker);
      return original(sql, params);
    });
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ENROLLMENT_DATABASE_READ_FAILED');
    expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('does not return read data if commit or final context cleanup fails', async () => {
    for (const step of ['commit','cleanup']) {
      const f = fixture(), original = f.client.query.getMockImplementation()!;
      f.client.query.mockImplementation(async (sql, params) => {
        if ((step === 'commit' && sql === 'COMMIT') || (step === 'cleanup' && sql.includes("claim.sub','',false") && f.client.query.mock.calls.length > 3)) throw new Error(secretMarker);
        return original(sql, params);
      });
      await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow(/ENROLLMENT_DATABASE_(READ_FAILED|CLEANUP_FAILED)/);
      expect(f.client.release).toHaveBeenCalledWith(true);
    }
  });
  it('closes a client whose pool release fails, without returning private data', async () => {
    const f = fixture(); f.client.release.mockImplementation(() => { throw new Error(secretMarker); });
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ENROLLMENT_DATABASE_CLEANUP_FAILED');
    expect(f.client.end).toHaveBeenCalledTimes(1);
  });
  it('captures target/dependencies before asynchronous authentication', async () => {
    const f = fixture(), t = { ...target }; let resume!: () => void;
    f.auth.getUser.mockImplementationOnce(async () => { await new Promise<void>(resolve => { resume = resolve; }); return { data: { user: { id: actor, aud: 'authenticated', is_anonymous: false } }, error: null } as never; });
    const pending = f.reader.loadOriginalEnrollment(token, t); t.organizationId = other;
    f.pool.connect = vi.fn(async () => { throw new Error(secretMarker); }); resume();
    expect((await pending).savedUnit.organizationId).toBe(org);
  });
  it('treats connection error events as a failed read and removes its listener', async () => {
    const f = fixture(), original = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql, params) => { if (sql === 'COMMIT') f.client.emit('error', new Error(secretMarker)); return original(sql, params); });
    await expect(f.reader.loadOriginalEnrollment(token, target)).rejects.toThrow('ENROLLMENT_DATABASE_READ_FAILED');
    expect(f.client.release).toHaveBeenCalledWith(true); expect(f.client.listenerCount('error')).toBe(0);
  });
  it('honors an Auth server denial through the real SDK without acquiring a database connection', async () => {
    const f = fixture(); const authClient = createClient('https://synthetic-project.supabase.co', 'synthetic-public-key', {
      global: { fetch: async () => new Response(JSON.stringify({ msg: 'synthetic invalid token', code: 'bad_jwt' }), { status: 401,
        headers: { 'Content-Type': 'application/json' } }) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const reader = createVerifiedZatcaEnrollmentReader(authClient.auth, f.pool as unknown as Pick<Pool, 'connect'>);
    await expect(reader.loadOriginalEnrollment(token, target)).rejects.toThrow('UNAUTHORIZED'); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('uses the real Supabase SDK getUser network method, not a locally decoded session/user', async () => {
    const f = fixture(); const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: actor, aud: 'authenticated', role: 'authenticated',
      is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const authClient = createClient('https://synthetic-project.supabase.co', 'synthetic-public-key', { global: { fetch: fetcher },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const reader = createVerifiedZatcaEnrollmentReader(authClient.auth, f.pool as unknown as Pick<Pool, 'connect'>);
    expect((await reader.loadOriginalEnrollment(token, target)).actorId).toBe(actor);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/auth/v1/user'); expect(new Headers(init.headers).get('Authorization')).toBe('Bearer ' + token);
  });
});
