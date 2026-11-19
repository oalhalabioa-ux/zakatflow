import { execFileSync } from 'node:child_process';
import { createHash, sign, verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { certificateSignatureDer } from '../lib/zatca-phase2-qr';
import { prepareZatcaInvoiceHash } from '../lib/zatca-xml-hash';

const mocks = vi.hoisted(() => ({ kms: vi.fn(), publish: vi.fn(), credentials: vi.fn() }));
vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class { send = mocks.kms; },
  GetPublicKeyCommand: class { kind = 'publicKey'; constructor(public input: unknown) {} },
  SignCommand: class { kind = 'sign'; constructor(public input: unknown) {} },
}));
vi.mock('@vercel/oidc-aws-credentials-provider', () => ({ awsCredentialsProvider: mocks.credentials }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: mocks.publish }));
import { runDeveloperAcceptance } from '../scripts/zatca/developer-acceptance';

const keyArn = 'arn:aws:kms:eu-north-1:701899214938:key/ab50c7e0-2251-4ae3-967d-5d14866b80d4';
const base = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const valid = { validationResults: { status: 'PASS', errorMessages: [], warningMessages: [] } };
type Request = { path: string; headers: Record<string, string>; body: Record<string, string> };
let directory: string, key: Buffer, spki: Buffer;
let compliance: X509Certificate, permanent: X509Certificate, unrelated: X509Certificate;
let requests: Request[], permanentCertificate: X509Certificate, warnAt: string | undefined;
const token = (cert: X509Certificate) => cert.raw.toString('base64');
const auth = (cert: X509Certificate, secret: string) => 'Basic ' + Buffer.from(token(cert) + ':' + secret).toString('base64');
const report = () => JSON.parse(mocks.publish.mock.calls.at(-1)![1]);
const xml = (request: Request) => Buffer.from(request.body.invoice, 'base64').toString('utf8');
function qrFields(invoice: string) {
  const payload = /<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)/.exec(invoice)![1];
  const bytes = Buffer.from(payload, 'base64'), fields: Buffer[] = [];
  for (let offset = 0; offset < bytes.length;) {
    expect(bytes[offset++]).toBe(fields.length + 1);
    const size = bytes[offset++];
    expect(bytes.length - offset).toBeGreaterThanOrEqual(size);
    fields.push(bytes.subarray(offset, offset + size)); offset += size;
  }
  expect(fields).toHaveLength(9);
  return fields;
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-csid-handoff-'));
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
  openssl('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes',
    '-keyout', 'root.key', '-out', 'root.pem', '-days', '2', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic Root',
    '-addext', 'basicConstraints=critical,CA:TRUE');
  openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes',
    '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic EGS');
  for (const [name, serial] of [['compliance', '9001'], ['permanent', '9002']]) {
    openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key',
      '-set_serial', serial, '-days', '1', '-out', name + '.pem');
  }
  openssl('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes',
    '-keyout', 'unrelated.key', '-out', 'unrelated.pem', '-days', '1', '-subj', '/CN=Unrelated Synthetic Key');
  key = readFileSync(join(directory, 'leaf.key'));
  compliance = new X509Certificate(readFileSync(join(directory, 'compliance.pem')));
  permanent = new X509Certificate(readFileSync(join(directory, 'permanent.pem')));
  unrelated = new X509Certificate(readFileSync(join(directory, 'unrelated.pem')));
  spki = Buffer.from(compliance.publicKey.export({ format: 'der', type: 'spki' }));
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => {
  vi.clearAllMocks(); requests = []; permanentCertificate = permanent; warnAt = undefined;
  for (const [name, value] of Object.entries({
    VERCEL_ENV: 'preview', FATOORA_QA_AWS_REGION: 'eu-north-1', FATOORA_QA_KMS_KEY_ARN: keyArn,
    FATOORA_QA_AWS_ROLE_ARN: 'arn:aws:iam::701899214938:role/yaqeen-fatoora-qa-preview',
    VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    VERCEL_OIDC_TOKEN: 'header.' + Buffer.from(JSON.stringify({
      iss: 'https://oidc.vercel.com/oalhalabioa-9334', aud: 'https://vercel.com/oalhalabioa-9334',
      sub: 'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview',
    })).toString('base64url') + '.synthetic',
  })) vi.stubEnv(name, value);
  mocks.kms.mockImplementation(async (command: { kind: string; input: { Message: Uint8Array } }) => command.kind === 'publicKey'
    ? { KeyId: keyArn, KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'], PublicKey: spki }
    : { KeyId: keyArn, SigningAlgorithm: 'ECDSA_SHA_256', Signature: sign('sha256', command.input.Message, key) });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith(base + '/')).toBe(true);
    expect(init.redirect).toBe('error');
    const path = url.slice(base.length);
    requests.push({ path, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    if (path === '/compliance') return { status: 200, json: async () => ({ requestID: '1234', binarySecurityToken: token(compliance), secret: 'synthetic-compliance-secret' }) };
    if (path === '/production/csids') return { status: 200, json: async () => ({ binarySecurityToken: token(permanentCertificate), secret: 'synthetic-permanent-secret' }) };
    const body = path === warnAt ? { validationResults: { status: 'WARNING', errorMessages: [], warningMessages: [{ code: 'BR-KSA-10', message: 'Do not publish raw messages' }] } } : valid;
    return { status: 200, json: async () => ({ ...body,
      ...(path === '/invoices/reporting/single' ? { reportingStatus: 'REPORTED' } : {}),
      ...(path === '/invoices/clearance/single' ? { clearanceStatus: 'CLEARED' } : {}),
    }) };
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('actual diagnostic orchestration with synthetic cryptography and mocked network', () => {
  it('uses each phase certificate and fresh artifacts while preserving the complete hash chain', async () => {
    await runDeveloperAcceptance();
    const checks = requests.filter(r => r.path === '/compliance/invoices');
    const deliveries = requests.filter(r => r.path.startsWith('/invoices/'));
    expect(checks).toHaveLength(6); expect(deliveries).toHaveLength(6);
    expect(requests.find(r => r.path === '/production/csids')!.headers.Authorization).toBe(auth(compliance, 'synthetic-compliance-secret'));
    expect(compliance.raw.equals(permanent.raw)).toBe(false);
    expect(permanent.publicKey.export({ format: 'der', type: 'spki' })).toEqual(spki);
    let previous = Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64');
    const all = [...checks, ...deliveries];
    expect(new Set(all.map(r => r.body.uuid)).size).toBe(12);
    for (const [index, request] of all.entries()) {
      const invoice = xml(request), cert = index < 6 ? compliance : permanent;
      expect(request.headers.Authorization).toBe(auth(cert, index < 6 ? 'synthetic-compliance-secret' : 'synthetic-permanent-secret'));
      expect(request.body.invoiceHash).toBe((await prepareZatcaInvoiceHash(invoice)).invoiceHashBase64);
      expect(invoice).toContain(`<cbc:UUID>${request.body.uuid}</cbc:UUID>`);
      expect(invoice).toContain(`<cbc:UUID>${index + 1}</cbc:UUID>`);
      expect(invoice).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previous}</cbc:EmbeddedDocumentBinaryObject>`);
      if (index % 6 >= 3) {
        expect(invoice).toContain(`<ds:X509Certificate>${token(cert)}</ds:X509Certificate>`);
        const fields = qrFields(invoice), signature = Buffer.from(/<ds:SignatureValue>([^<]+)/.exec(invoice)![1], 'base64');
        expect(fields[8]).toEqual(certificateSignatureDer(cert.raw));
        expect(fields[7]).toEqual(spki);
        expect(fields[5].toString()).toBe(request.body.invoiceHash);
        expect(fields[6].toString()).toBe(signature.toString('base64'));
        expect(verify('sha256', Buffer.from(request.body.invoiceHash, 'base64'), cert.publicKey, signature)).toBe(true);
      } else {
        expect(invoice).not.toContain('<ds:Signature');
        expect(invoice).not.toContain('<cbc:ID>QR</cbc:ID>');
      }
      previous = request.body.invoiceHash;
    }
    expect(report()).toMatchObject({ diagnosticPassed: true, releaseReady: false, stage: 'diagnostic-complete' });
    for (const secret of ['synthetic-compliance-secret', 'synthetic-permanent-secret', token(permanent), token(compliance), 'Do not publish raw messages'])
      expect(JSON.stringify(report())).not.toContain(secret);
  });

  it('stops before delivery or further signing when the returned permanent certificate has another key', async () => {
    permanentCertificate = unrelated;
    await runDeveloperAcceptance();
    expect(requests.filter(r => r.path === '/compliance/invoices')).toHaveLength(6);
    expect(requests.some(r => r.path.startsWith('/invoices/'))).toBe(false);
    expect(mocks.kms.mock.calls.filter(([c]) => c.kind === 'sign')).toHaveLength(4); // CSR + three compliance signatures.
    expect(report()).toMatchObject({ diagnosticPassed: false, releaseReady: false, blocked: 'AUTHORITY_CERTIFICATE_KEY_MISMATCH' });
  });

  it('does not request permanent credentials or deliver when a compliance result warns', async () => {
    warnAt = '/compliance/invoices';
    await runDeveloperAcceptance();
    expect(requests.some(r => r.path === '/production/csids' || r.path.startsWith('/invoices/'))).toBe(false);
    expect(report()).toMatchObject({ diagnosticPassed: false, releaseReady: false, blocked: 'COMPLIANCE_MATRIX_NOT_PASSED' });
  });

  it('does not complete after reporting warnings despite HTTP 200 and REPORTED', async () => {
    warnAt = '/invoices/reporting/single';
    await runDeveloperAcceptance();
    expect(requests.filter(r => r.path.startsWith('/invoices/'))).toHaveLength(6);
    expect(report()).toMatchObject({ diagnosticPassed: false, releaseReady: false, blocked: 'DELIVERY_MATRIX_NOT_PASSED' });
    expect(JSON.stringify(report())).not.toContain('Do not publish raw messages');
  });

  it('performs no cloud request or signing outside the existing isolated Preview identity', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await runDeveloperAcceptance();
    expect(requests).toEqual([]); expect(mocks.kms).not.toHaveBeenCalled(); expect(mocks.credentials).not.toHaveBeenCalled();
    expect(report()).toMatchObject({ diagnosticPassed: false, releaseReady: false, blocked: 'QA_TARGET_REQUIRED' });
  });
});
