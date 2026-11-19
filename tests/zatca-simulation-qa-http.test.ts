import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createSimulationQaHttpHandler, simulationQaStableHost, type SimulationQaRequest } from '../scripts/zatca/simulation-qa-http';
import { simulationQaRole, simulationQaSigningKey } from '../scripts/zatca/simulation-qa';
import { simulationQaRuntimeEnvironment } from '../scripts/zatca/simulation-qa-runtime';
const claims = { sub: 'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview',
  iss: 'https://oidc.vercel.com/oalhalabioa-9334', aud: 'https://vercel.com/oalhalabioa-9334' };
const host = 'yaqeen-fatoora-synthetic.vercel.app';
const environment = { VERCEL_ENV: 'preview', VERCEL_URL: host, FATOORA_QA_AWS_REGION: 'eu-north-1',
  FATOORA_QA_AWS_ROLE_ARN: simulationQaRole, FATOORA_QA_KMS_KEY_ARN: simulationQaSigningKey,
  VERCEL_OIDC_TOKEN: 'synthetic.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.not-real' };
function fixture(env = environment) {
  const status = vi.fn(async () => ({ state: 'READY_FOR_OTP', activationAllowed: false }));
  const prepare = vi.fn(async () => ({ state: 'READY_FOR_OTP', activationAllowed: false }));
  const submit = vi.fn(async (_input: unknown) => ({ state: 'RESPONSE_QUARANTINED', activationAllowed: false }));
  const open = vi.fn(() => ({ status, prepareOriginal: prepare, submitOtp: submit }) as never);
  const handler = createSimulationQaHttpHandler(open, () => env);
  async function call({ method = 'GET', headers = {}, body, raw }: { method?: string; headers?: Record<string,string | undefined>; body?: unknown; raw?: string | Buffer } = {}) {
    const request = Object.assign(Readable.from(raw === undefined ? [] : [raw]), { method,
      headers: { host, origin: 'https://' + host, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      ...(body === undefined ? {} : { body }) }) as SimulationQaRequest;
    const sentHeaders: Record<string,string> = {}, response = { statusCode: 0, text: '',
      setHeader: (name: string, value: string) => { sentHeaders[name] = value; },
      end: (text: string) => { response.text = text; } };
    await handler(request, response as unknown as ServerResponse);
    return { status: response.statusCode, body: JSON.parse(response.text), headers: sentHeaders };
  }
  return { call, open, status, prepare, submit };
}
describe('protected isolated Simulation HTTP boundary', () => {
  it('returns only the safe read status with no-store/nosniff and no CORS permission', async () => {
    const f = fixture(), result = await f.call();
    expect(result.status).toBe(200); expect(result.body).toEqual({ state: 'READY_FOR_OTP', activationAllowed: false });
    expect(result.headers).toMatchObject({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  });
  it('prepares only on an explicit same-origin JSON POST', async () => {
    const f = fixture(), result = await f.call({ method: 'POST', body: { action: 'prepare' } });
    expect(result.status).toBe(200); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.submit).not.toHaveBeenCalled();
  });
  it('accepts only the known stable QA host or this generated deployment, including read requests', async () => {
    const f = fixture();
    expect((await f.call({ method: 'POST', headers: { host: simulationQaStableHost, origin: 'https://' + simulationQaStableHost }, body: { action: 'prepare' } })).status).toBe(200);
    for (const host of ['app.yaqeenbiz.com','yaqeen-financial-core-v2-qa.vercel.app','another-custom.invalid']) {
      const isolated = fixture(); expect((await isolated.call({ headers: { host } })).status).toBe(403);
      expect(isolated.open).not.toHaveBeenCalled();
    }
  });
  it('accepts the original CSR fingerprint plus OTP and returns no OTP', async () => {
    const f = fixture(), input = { action: 'submit', otp: '654321', csrSha256: 'a'.repeat(64) };
    const result = await f.call({ method: 'POST', raw: JSON.stringify(input) });
    expect(result.status).toBe(200); expect(f.submit).toHaveBeenCalledWith({ otp: '654321', csrSha256: 'a'.repeat(64) });
    expect(JSON.stringify(result)).not.toContain('654321');
  });
  it.each([{ origin: 'https://attacker.invalid' }, { host: 'attacker.invalid' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' }, { origin: 'http://' + host }])('blocks cross-origin writes before opening any cloud clients: %j', async headers => {
      const f = fixture();
      expect((await f.call({ method: 'POST', headers, body: { action: 'prepare' } })).status).toBe(403);
      expect(f.open).not.toHaveBeenCalled();
    });
  it.each(['PUT','PATCH','DELETE','OPTIONS'])('does not accept %s', async method => {
    const f = fixture(), result = await f.call({ method });
    expect(result.status).toBe(405); expect(result.headers.Allow).toBe('GET, POST'); expect(f.open).not.toHaveBeenCalled();
  });
  it.each(['text/plain','application/x-www-form-urlencoded',''])('blocks %s request content types', async contentType => {
    const f = fixture();
    expect((await f.call({ method: 'POST', headers: { 'content-type': contentType }, body: { action: 'prepare' } })).status).toBe(415);
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each([{ action: 'prepare', environment: 'PRODUCTION' }, { action: 'prepare', organizationId: 'override' },
    { action: 'submit', otp: '٦٥٤٣٢١', csrSha256: 'a'.repeat(64) },
    { action: 'submit', otp: '654321', csrSha256: 'a'.repeat(64), csrPem: 'override' }, { action: 'retry' }])
    ('rejects body overrides and malformed OTPs before opening a cloud client: %j', async body => {
      const f = fixture(); expect((await f.call({ method: 'POST', body })).status).toBe(400); expect(f.open).not.toHaveBeenCalled();
    });
  it('bounds raw and pre-parsed bodies and rejects malformed JSON/UTF-8', async () => {
    for (const value of [{ raw: 'x'.repeat(4097) }, { raw: 'Invalid JSON' }, { raw: Buffer.from([255]) }, { body: { text: 'x'.repeat(4097) } }]) {
      const f = fixture(); expect((await f.call({ method: 'POST', ...value })).status).toBe(400); expect(f.open).not.toHaveBeenCalled();
    }
  });
  it('refuses a Production runtime even for read requests before opening a cloud client', async () => {
    const f = fixture({ ...environment, VERCEL_ENV: 'production' });
    expect((await f.call()).body).toEqual({ error: 'QA_TARGET_REQUIRED' }); expect(f.open).not.toHaveBeenCalled();
  });
  it('redacts arbitrary errors, credentials and OTPs without exposing a stack/cause', async () => {
    const f = fixture(); f.submit.mockRejectedValueOnce(new Error('654321 PRIVATE_SECRET CUSTOMER_ADDRESS'));
    const result = await f.call({ method: 'POST', body: { action: 'submit', otp: '654321', csrSha256: 'a'.repeat(64) } });
    expect(result.status).toBe(503); expect(result.body).toEqual({ error: 'QA_REQUEST_FAILED' });
    expect(JSON.stringify(result)).not.toMatch(/654321|PRIVATE_SECRET|CUSTOMER_ADDRESS|stack|cause/);
  });
  it('reports ambiguous outcomes as reconciliation, never as retry-ready', async () => {
    const f = fixture(); f.submit.mockRejectedValueOnce(new Error('QA_RECONCILIATION_REQUIRED'));
    const result = await f.call({ method: 'POST', body: { action: 'submit', otp: '654321', csrSha256: 'a'.repeat(64) } });
    expect(result.status).toBe(409); expect(result.body.error).toBe('QA_RECONCILIATION_REQUIRED');
  });
});

describe('Functions runtime identity source', () => {
  it('accepts the official request-context token without an environment token', async () => {
    const { VERCEL_OIDC_TOKEN, ...base } = environment;
    const getToken = vi.fn(async () => VERCEL_OIDC_TOKEN);
    const result = await simulationQaRuntimeEnvironment(base, getToken);
    expect(result.VERCEL_OIDC_TOKEN).toBe(VERCEL_OIDC_TOKEN); expect(getToken).toHaveBeenCalledTimes(1);
    expect(base).not.toHaveProperty('VERCEL_OIDC_TOKEN');
  });
  it('does not fall back to a stale environment token when runtime retrieval fails or belongs to another project', async () => {
    await expect(simulationQaRuntimeEnvironment(environment, async () => { throw new Error('PRIVATE_TOKEN'); })).rejects.toThrow('QA_IDENTITY_REQUIRED');
    const wrong = 'synthetic.' + Buffer.from(JSON.stringify({ ...claims, sub: 'another-project' })).toString('base64url') + '.signature';
    await expect(simulationQaRuntimeEnvironment(environment, async () => wrong)).rejects.toThrow('QA_IDENTITY_REQUIRED');
  });
  it('never retrieves or refreshes a token for a wrong deployment target', async () => {
    const getToken = vi.fn();
    await expect(simulationQaRuntimeEnvironment({ ...environment, VERCEL_ENV: 'production' }, getToken)).rejects.toThrow('QA_TARGET_REQUIRED');
    expect(getToken).not.toHaveBeenCalled();
  });
  it('does not cache a prior invocation token or mutate the process environment snapshot', async () => {
    const getToken = vi.fn(async () => environment.VERCEL_OIDC_TOKEN);
    const first = await simulationQaRuntimeEnvironment(environment, getToken);
    const second = await simulationQaRuntimeEnvironment(environment, getToken);
    expect(getToken).toHaveBeenCalledTimes(2); expect(first).not.toBe(second);
  });
});
