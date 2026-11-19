import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createZatcaSimulationComplianceTransport, decodeZatcaComplianceCertificate } from './zatca-simulation-compliance';

const input = { environment: 'SIMULATION', csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMAA=\n-----END CERTIFICATE REQUEST-----\n', otp: '654321' };
const issued = { requestID: '12345678901234567890', dispositionMessage: 'ISSUED', binarySecurityToken: 'MAA=', secret: 'SYNTHETIC_SECRET', errors: null };
const response = (value: unknown = issued) => new Response(JSON.stringify(value), { status: 200 });
afterEach(() => vi.useRealTimers());

describe('fixed Simulation compliance transport', () => {
  it('uses only the fixed Simulation URL, original PEM base64, explicit JSON/version and a single attempt', async () => {
    const fetcher = vi.fn(async () => response());
    expect(await createZatcaSimulationComplianceTransport(fetcher)(input)).toEqual({
      requestId: issued.requestID, binarySecurityToken: issued.binarySecurityToken, secret: issued.secret,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance');
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2', OTP: input.otp } });
    expect(JSON.parse(String(request.body))).toEqual({ csr: Buffer.from(input.csrPem).toString('base64') });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([{ environment: 'PRODUCTION' }, { environment: 'DEVELOPER_PORTAL' }, { endpoint: 'https://other.invalid' },
    { otp: 654321 }, { otp: '٦٥٤٣٢١' }, { otp: '654321\n' }, { csrPem: 'invalid' }])('refuses input overrides before transport: %j', async change => {
    const fetcher = vi.fn();
    await expect(createZatcaSimulationComplianceTransport(fetcher)({ ...input, ...change })).rejects.toThrow('SIMULATION_COMPLIANCE_INPUT_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([201, 302, 400, 401, 429, 500])('does not retry HTTP %s or return upstream response text', async status => {
    const fetcher = vi.fn(async () => new Response('OTP=654321 SYNTHETIC_SECRET', { status }));
    const error = await createZatcaSimulationComplianceTransport(fetcher)(input).catch(e => e);
    expect(error.message).toBe('SIMULATION_COMPLIANCE_RECONCILIATION_REQUIRED');
    expect(error.cause).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ requestID: 9007199254740992 }, { dispositionMessage: 'ERROR' }, { errors: [{ message: 'private' }] },
    { binarySecurityToken: 'MAB=' }, { secret: '\n' }, { requestID: '-1' }, { secret: undefined }])('rejects malformed issued credentials: %j', async change => {
    await expect(createZatcaSimulationComplianceTransport(async () => response({ ...issued, ...change }))(input))
      .rejects.toThrow('SIMULATION_COMPLIANCE_RECONCILIATION_REQUIRED');
  });
  it('accepts an exactly represented numeric request ID without rounding it', async () => {
    const result = await createZatcaSimulationComplianceTransport(async () => response({ ...issued, requestID: 123456 })) (input);
    expect(result.requestId).toBe('123456');
  });
  it('rejects invalid JSON/UTF-8 and oversized bodies', async () => {
    for (const body of ['Invalid Request', 'x'.repeat(65537), Uint8Array.of(0xff)]) {
      await expect(createZatcaSimulationComplianceTransport(async () => new Response(body))(input))
        .rejects.toThrow('SIMULATION_COMPLIANCE_RECONCILIATION_REQUIRED');
    }
  });
  it('aborts after 20 seconds without retrying or exposing the transport exception', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, request) => new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(new Error('654321 SYNTHETIC_SECRET')));
    }));
    const pending = createZatcaSimulationComplianceTransport(fetcher)(input).catch(e => e);
    await vi.advanceTimersByTimeAsync(20000);
    expect((await pending).message).toBe('SIMULATION_COMPLIANCE_RECONCILIATION_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('authority token normalization without credential rewriting', () => {
  let directory: string, certificate: X509Certificate;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'zatca-token-'));
    execFileSync('openssl', ['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=Synthetic QA Only'], { stdio: 'pipe' });
    certificate = new X509Certificate(readFileSync(join(directory, 'cert.pem')));
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  it('normalizes DER, double-base64 DER and a single PEM to the identical certificate', () => {
    const direct = certificate.raw.toString('base64');
    const tokens = [direct, Buffer.from(direct).toString('base64'), Buffer.from(certificate.toString()).toString('base64')];
    for (const token of tokens) expect(decodeZatcaComplianceCertificate(token)).toEqual(certificate.raw);
    expect(new Set(tokens).size).toBe(3);
  });
  it('rejects bundled, trailing, triple-wrapped, malformed and noncanonical tokens', () => {
    const direct = certificate.raw.toString('base64');
    for (const token of [Buffer.concat([certificate.raw, Buffer.from([0])]).toString('base64'),
      Buffer.from(certificate.toString() + certificate.toString()).toString('base64'),
      Buffer.from(Buffer.from(direct).toString('base64')).toString('base64'), 'MAA=', direct + '\n']) {
      expect(() => decodeZatcaComplianceCertificate(token)).toThrow('SIMULATION_CERTIFICATE_ENCODING_INVALID');
    }
  });
});
