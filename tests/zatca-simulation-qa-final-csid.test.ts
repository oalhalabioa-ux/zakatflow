import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFinalSimulationCsidQa } from '../scripts/zatca/final-simulation-csid-qa';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const response = { requestID: '12345678901234567890', dispositionMessage: 'ISSUED',
  binarySecurityToken: Buffer.from('SYNTHETIC_CERTIFICATE').toString('base64'), secret: 'PRIVATE_FINAL_SECRET', errors: null };
function fixture() {
  const ctx = { originalDigest: 'a'.repeat(64), responseDigest: 'b'.repeat(64), standardManifestDigest: 'c'.repeat(64),
    simplifiedManifestDigest: 'd'.repeat(64), interimFingerprint: 'e'.repeat(64), requestId: '12345678901234567891',
    token: 'PRIVATE_INTERIM_TOKEN', secret: 'PRIVATE_INTERIM_SECRET' };
  const map = new Map<string,{ content: string; version: string }>();
  const options = { lostClaimAck: false, badClaimAck: false, lostResultAck: false, badResultAck: false, deny: false };
  const load = vi.fn(async () => structuredClone(ctx));
  const read = vi.fn(async (name: string) => map.get(name) ?? null);
  const create = vi.fn(async (name: string, version: string, content: string) => {
    if (options.deny || map.has(name)) throw Error('PRIVATE_STORAGE_DIAGNOSTIC');
    map.set(name, { content, version });
    if (name.endsWith('/intent') ? options.lostClaimAck : options.lostResultAck) throw Error('PRIVATE_UNKNOWN_ACK');
    return { version: (name.endsWith('/intent') ? options.badClaimAck : options.badResultAck) ? 'different' : version };
  });
  const verifyCertificate = vi.fn(async (_token: string) => ({ fingerprintSha256: 'f'.repeat(64) }));
  const assertCreateOnly = vi.fn(async () => {});
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)));
  const make = () => createFinalSimulationCsidQa({ load, read, create, verifyCertificate, assertCreateOnly, transport }, '1'.repeat(40));
  return { ctx, map, options, load, read, create, verifyCertificate, assertCreateOnly, transport, make, api: make() };
}
const input = async (f: ReturnType<typeof fixture>) => ({ readinessDigest: (await f.api.status() as { readinessDigest: string }).readinessDigest });

describe('final Simulation CSID one-shot quarantine', () => {
  it('reads readiness without writes, signing, transport or disclosure', async () => {
    const f = fixture(), status = await f.api.status();
    expect(status).toMatchObject({ state: 'READY', activationAllowed: false, trustVerified: false, applicationProfileApproved: false });
    expect(f.map.size).toBe(0); expect(f.create).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|12345678901234567891/);
  });
  it('uses the fixed SIMULATION URL and original CCSID once, preserving raw returned authentication values privately', async () => {
    const f = fixture(), p = await input(f), result = await f.api.request(p);
    expect(result).toMatchObject({ state: 'RESPONSE_QUARANTINED', identityKeyTimeVerified: true,
      trustVerified: false, activationAllowed: false, applicationProfileApproved: false });
    if (result.state !== 'RESPONSE_QUARANTINED') throw Error('Expected a separately quarantined response');
    const [url, init] = f.transport.mock.calls[0];
    expect(url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/production/csids');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Accept-Version': 'V2', Authorization: 'Basic ' + Buffer.from(f.ctx.token + ':' + f.ctx.secret).toString('base64') } });
    expect(JSON.parse(String(init!.body))).toEqual({ compliance_request_id: f.ctx.requestId });
    expect(init!.headers).not.toHaveProperty('OTP');
    const saved = f.map.get('final-simulation-csid/response')!;
    expect(JSON.parse(saved.content).response).toEqual({ requestId: response.requestID, binarySecurityToken: response.binarySecurityToken, secret: response.secret });
    expect(result.responseDigest).toBe(hash(saved.content)); expect(f.map.size).toBe(2);
    expect(f.assertCreateOnly).toHaveBeenCalledTimes(1);
    await f.make().request(p); await f.make().status();
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|SYNTHETIC_CERTIFICATE|binarySecurityToken|requestId|requestID/);
  });
  it.each(['originalDigest','responseDigest','standardManifestDigest','simplifiedManifestDigest','interimFingerprint','requestId'] as const)
    ('refuses changed %s before claiming or sending', async key => {
      const f = fixture(), p = await input(f); f.ctx[key] = key === 'requestId' ? '999' : '0'.repeat(64);
      await expect(f.api.request(p)).rejects.toThrow('QA_FINAL_CSID_ORIGINAL_CHANGED');
      expect(f.create).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
    });
  it('requires fresh backend completion/key/identity checks, including on recovery', async () => {
    const f = fixture(), p = await input(f); await f.api.request(p);
    f.load.mockRejectedValue(Error('PRIVATE_FAILED_PRIOR_OR_KEY'));
    await expect(f.make().status()).rejects.toThrow('QA_FINAL_CSID_CONTEXT_UNAVAILABLE');
    await expect(f.make().request(p)).rejects.toThrow('QA_FINAL_CSID_CONTEXT_UNAVAILABLE');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ environment: 'PRODUCTION' }, { token: 'override' }, { requestId: '1' }, { endpoint: 'https://override.invalid' },
    { certificate: 'MAA=' }, { otp: '654321' }, { readinessDigest: 'invalid' }])('rejects caller override %j', async extra => {
    const f = fixture(); await expect(f.api.request({ ...await input(f), ...extra })).rejects.toThrow('QA_FINAL_CSID_INPUT_INVALID');
    expect(f.create).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('requires proof of actual create-only storage before intent or HTTP', async () => {
    const f = fixture(); f.assertCreateOnly.mockRejectedValue(Error('QA_STORAGE_FENCE_UNVERIFIED'));
    await expect(f.api.request(await input(f))).rejects.toThrow('QA_STORAGE_FENCE_UNVERIFIED');
    expect(f.create).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['lostClaimAck','badClaimAck'] as const)('never dispatches after %s and never reclaims an existing intent', async option => {
    const f = fixture(), p = await input(f); f.options[option] = true;
    await expect(f.api.request(p)).rejects.toThrow('QA_FINAL_CSID_RECONCILIATION_REQUIRED');
    expect(await f.make().request(p)).toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
    expect(f.transport).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it.each(['lostResultAck','badResultAck'] as const)('recovers stored response after %s without another request', async option => {
    const f = fixture(), p = await input(f); f.options[option] = true;
    await expect(f.api.request(p)).rejects.toThrow('QA_FINAL_CSID_RECONCILIATION_REQUIRED');
    expect(await f.make().request(p)).toMatchObject({ state: 'RESPONSE_QUARANTINED', activationAllowed: false });
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledTimes(2);
  });
  it('allows at most one concurrent authority request', async () => {
    const f = fixture(), p = await input(f);
    await Promise.allSettled([f.api.request(p), f.make().request(p)]);
    expect(f.transport).toHaveBeenCalledTimes(1); expect((await f.make().status()).state).toBe('RESPONSE_QUARANTINED');
  });
  it('retains a mismatched, expired, unparseable or same-interim certificate without activating or retrying', async () => {
    for (const mode of ['reject','same-interim']) {
      const f = fixture(), p = await input(f);
      if (mode === 'reject') f.verifyCertificate.mockRejectedValue(Error('PRIVATE_CERTIFICATE_REJECTED'));
      else f.verifyCertificate.mockResolvedValue({ fingerprintSha256: f.ctx.interimFingerprint });
      expect(await f.api.request(p)).toMatchObject({ state: 'QUARANTINED_VERIFICATION_REQUIRED', identityKeyTimeVerified: false, activationAllowed: false });
      expect(f.map.size).toBe(2); await f.make().request(p); expect(f.transport).toHaveBeenCalledTimes(1);
      f.verifyCertificate.mockResolvedValue({ fingerprintSha256: 'f'.repeat(64) });
      expect((await f.make().status()).state).toBe('RESPONSE_QUARANTINED'); expect(f.transport).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    () => new Response('PRIVATE_ERROR', { status: 401 }), () => new Response('PRIVATE_REDIRECT', { status: 302 }),
    () => new Response('not-json'), () => new Response(new Uint8Array([255])), () => new Response('x'.repeat(65537)),
    () => new Response(JSON.stringify({ ...response, requestID: 9007199254740992 })),
    () => new Response(JSON.stringify({ ...response, binarySecurityToken: 'MAB=' })),
    () => new Response(JSON.stringify({ ...response, dispositionMessage: 'ERROR' })),
    () => new Response(JSON.stringify({ ...response, errors: ['PRIVATE_FAILURE'] })),
  ])('redacts uncertain transport/parse outcomes and never resends', async reply => {
    const f = fixture(), p = await input(f); f.transport.mockImplementation(async () => reply());
    const error = await f.api.request(p).catch(e => e);
    expect(error.message).toBe('QA_FINAL_CSID_RECONCILIATION_REQUIRED'); expect(error.cause).toBeUndefined();
    expect((await f.make().request(p)).state).toBe('RECONCILIATION_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.map.size).toBe(1);
  });
  it('rejects orphan/misbound response records', async () => {
    const f = fixture(), p = await input(f); await f.api.request(p);
    const record = f.map.get('final-simulation-csid/response')!, value = JSON.parse(record.content);
    value.claimId = '00000000-0000-4000-8000-000000000001'; record.content = JSON.stringify(value);
    await expect(f.make().status()).rejects.toThrow('QA_FINAL_CSID_ORIGINAL_CHANGED');
    f.map.delete('final-simulation-csid/intent');
    await expect(f.make().status()).rejects.toThrow('QA_FINAL_CSID_ORIGINAL_CHANGED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('aborts a hanging response body at the same bounded request deadline', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), p = await input(f);
      f.transport.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(c) {
        init!.signal!.addEventListener('abort', () => c.error(Error('PRIVATE_TIMEOUT')));
      } })));
      const attempt = f.api.request(p).catch(e => e);
      await vi.advanceTimersByTimeAsync(20001);
      expect((await attempt).message).toBe('QA_FINAL_CSID_RECONCILIATION_REQUIRED');
      expect((await f.make().status()).state).toBe('RECONCILIATION_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
