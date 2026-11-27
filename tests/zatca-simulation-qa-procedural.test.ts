import { createHash, randomUUID, sign, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProceduralSimplifiedComplianceQa } from '../scripts/zatca/procedural-simplified-compliance-qa';
import { prepareSimulationProceduralDocument } from '../scripts/zatca/simulation-procedural-document';
import { prepareZatcaInvoiceHash } from '../lib/zatca-xml-hash';

let directory: string, certificate: string, key: Buffer, fingerprint: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'procedural-simulation-'));
  const command = (...args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: directory, stdio: 'pipe' });
  command('req','-new','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:secp256k1','-nodes','-keyout','root.key','-out','root.pem','-days','2','-subj','/CN=eInvoicing','-addext','basicConstraints=critical,CA:TRUE');
  command('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:secp256k1','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=Synthetic EGS');
  command('x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key','-set_serial','99331','-days','1','-out','leaf.pem');
  const cert = new X509Certificate(readFileSync(join(directory, 'leaf.pem')));
  certificate = cert.raw.toString('base64'); fingerprint = createHash('sha256').update(cert.raw).digest('hex'); key = readFileSync(join(directory, 'leaf.key'));
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const sample = { street: 'Synthetic street', building: '1234', district: 'Synthetic district', additional: '5678', postal: '12345', city: 'Riyadh' };
const good = { validationResults: { status: 'PASS', errorMessages: [], warningMessages: [] } };
function fixture() {
  const ctx = { organizationId: randomUUID(), legalName: 'شركة اختبار اصطناعي', vatNumber: '312345678901233',
    certificate, fingerprint, standardManifestDigest: 'e'.repeat(64), previousInvoiceHash: Buffer.alloc(32, 7).toString('base64'), originalDigest: 'a'.repeat(64), responseDigest: 'b'.repeat(64), token: 'PRIVATE_TOKEN_NOT_FOR_OUTPUT', secret: 'PRIVATE_CREDENTIAL' };
  const profile = structuredClone(sample), map = new Map<string, { content: string; version: string }>();
  const flags = { lostClaim: false, lostResult: false, failTransport: false, wrongAck: false, failFence: false };
  const transport = vi.fn(async () => { if (flags.failTransport) throw Error('PRIVATE_CREDENTIAL'); return new Response(JSON.stringify(good)); });
  const create = vi.fn(async (name: string, version: string, content: string) => {
    if (map.has(name)) throw Error('ResourceExistsException');
    map.set(name, { content, version });
    if ((name.endsWith('/intent') && flags.lostClaim) || (name.endsWith('/result') && flags.lostResult)) throw Error('UNKNOWN_ACK');
    return { version: flags.wrongAck ? randomUUID() : version };
  });
  const signer = vi.fn(async (bytes: Buffer) => sign('sha256', bytes, key));
  const load = vi.fn(async () => structuredClone(ctx));
  const assertCreateOnly = vi.fn(async () => { if (flags.failFence) throw Error('QA_STORAGE_FENCE_UNVERIFIED'); });
  const make = (address: unknown = profile) => createProceduralSimplifiedComplianceQa({ sign: signer, load, read: async name => map.get(name) ?? null, create, assertCreateOnly, transport }, address, 'c'.repeat(40));
  return { ctx, profile, map, flags, transport, create, load, signer, assertCreateOnly, make, api: make(), manifest: () => JSON.parse(map.get('simplified-procedural-compliance/original-suite')!.content) };
}
const input = (status: any, index = 0) => ({ index, manifestDigest: status.manifestDigest });

describe('separately gated procedural SIMPLIFIED Simulation experiment', () => {
  it('preserves a73-byte Arabic seller name within QR700 without approving runtime', async () => {
    const f = fixture(); f.ctx.legalName = 'شركة ' + 'ص'.repeat(31) + 'QA';
    expect(Buffer.byteLength(f.ctx.legalName)).toBe(73);
    const status = await f.api.prepare();
    expect(status).toMatchObject({ applicationProfileApproved: false, activationAllowed: false, privateIntegrityVerified: true, publishedQrLimitSatisfied: true });
    for (const a of f.manifest().artifacts) { expect(a.xml).toContain(f.ctx.legalName); expect(a.qrCharacters).toBeLessThanOrEqual(700); }
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('rejects an oversized full seller name before saving or sending, without shortening it', async () => {
    const f = fixture(); f.ctx.legalName = 'x'.repeat(200);
    await expect(f.api.prepare()).rejects.toThrow('QA_PROCEDURAL_QR_TOO_LONG');
    expect(f.map.size).toBe(0); expect(f.transport).not.toHaveBeenCalled();
  });
  it('rejects another certificate pin or a wrong signing key before storing any artifact', async () => {
    const f = fixture(); f.ctx.fingerprint = '0'.repeat(64);
    await expect(f.api.prepare()).rejects.toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
    expect(f.signer).not.toHaveBeenCalled(); expect(f.map.size).toBe(0); expect(f.transport).not.toHaveBeenCalled();
    const g = fixture(); g.signer.mockResolvedValue(Buffer.alloc(71));
    await expect(g.api.prepare()).rejects.toThrow(); expect(g.map.size).toBe(0); expect(g.transport).not.toHaveBeenCalled();
  });
  it('independently rejects changed signing properties and scope with a retained external receipt', async () => {
    const f = fixture(); await f.api.prepare(); const m = f.manifest(), a = m.artifacts[0];
    const seen = f.signer.mock.calls;
    const receipt = JSON.parse(seen[1][0].toString());
    expect(receipt).toMatchObject({ version: 'SIMULATION_PROCEDURAL_INTEGRITY_V1', certificateFingerprint: fingerprint, invoiceHash: a.invoiceHash });
    expect(receipt.xmlSha256).toBe(createHash('sha256').update(a.xml).digest('hex'));
    const draft = { organization_id: f.ctx.organizationId, invoice_number: 'SYNTHETIC-RECEIPT', invoice_category: 'SIMPLIFIED',
      issue_date: '2026-11-19', issue_time: '12:00:00', seller_name: 'Synthetic', seller_vat_number: f.ctx.vatNumber,
      seller_address: sample.street, seller_city: sample.city, seller_building_number: sample.building, seller_additional_number: sample.additional, seller_district: sample.district, seller_postal_code: sample.postal,
      lines: [{ item_name: 'Synthetic', quantity: 1, unit_price: 1, tax_category: 'S', tax_rate: 15 }] };
    const context = { invoiceUuid: randomUUID(), invoiceCounter: '1', previousInvoiceHash: f.ctx.previousInvoiceHash,
      supplyDate: draft.issue_date, sellerId: { scheme: 'OTH', value: 'SIMULATIONQA' }, paymentMeansCode: '30' };
    const options = { certificate, fingerprint, signingTime: new Date(), scopeDigest: 'a'.repeat(64) };
    const original = await prepareSimulationProceduralDocument(draft, context, options, async bytes => sign('sha256', bytes, key));
    for (const change of [{ signingTime: new Date(options.signingTime.getTime() + 1000) }, { scopeDigest: 'b'.repeat(64) }]) {
      let index = 0;
      await expect(prepareSimulationProceduralDocument(draft, context, { ...options, ...change }, async () => Buffer.from(index++ ? original.integritySignature : original.invoiceSignature, 'base64')))
        .rejects.toThrow('QA_PROCEDURAL_SIGNATURE_INVALID');
    }
  });
  it('prepares three bounded private originals with actual shared XML/hash builders, verified signatures/receipts and no authority request', async () => {
    const f = fixture(); expect(await f.api.status()).toMatchObject({ state: 'NOT_PREPARED' }); expect(f.map.size).toBe(0);
    const status = await f.api.prepare(); expect(status).toMatchObject({ passed: false, applicationProfileApproved: false, activationAllowed: false });
    expect(f.transport).not.toHaveBeenCalled(); expect(f.map.size).toBe(1);
    const m = f.manifest(); expect(new Set(m.artifacts.map((a: any) => a.uuid)).size).toBe(3);
    for (let i = 0; i < 3; i++) {
      const a = m.artifacts[i]; expect((await prepareZatcaInvoiceHash(a.xml)).invoiceHashBase64).toBe(a.invoiceHash);
      expect(a.xml).toContain('name="0200000"'); expect(a.xml).toContain(f.ctx.vatNumber); expect(a.xml).toContain('SIMULATIONQA');
      expect(a.xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">1.15</cbc:TaxInclusiveAmount>');
      expect(a.xml).toContain('SignatureValue'); expect(a.integritySignature).toBeTruthy(); expect(a.xml).not.toContain('PRIVATE_CREDENTIAL');
    }
    expect(f.signer).toHaveBeenCalledTimes(6);
    const prior = f.map.get('simplified-procedural-compliance/original-suite')!.content;
    expect(await f.make().prepare()).toEqual(status); expect(f.map.get('simplified-procedural-compliance/original-suite')!.content).toBe(prior);
    expect(f.signer).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|<Invoice|seller_|token|secret/);
  });
  it('sends exactly the preserved three artifacts to fixed compliance only and never labels simplified/delivery/activation passed', async () => {
    const f = fixture(), prepared = await f.api.prepare(); let result: any;
    for (let i = 0; i < 3; i++) result = await f.api.submit(input(prepared, i));
    expect(result).toMatchObject({ passed: true, applicationProfileApproved: false, activationAllowed: false }); expect(f.map.size).toBe(7);
    const originals = f.manifest().artifacts;
    expect(f.transport).toHaveBeenCalledTimes(3); expect(f.signer).toHaveBeenCalledTimes(6); expect(f.assertCreateOnly).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const [url, req] = f.transport.mock.calls[i] as unknown as [string, RequestInit];
      expect(url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance/invoices');
      expect(req.redirect).toBe('error'); const body = JSON.parse(String(req.body));
      expect(body).toEqual({ uuid: originals[i].uuid, invoiceHash: originals[i].invoiceHash, invoice: Buffer.from(originals[i].xml).toString('base64') });
      expect((req.headers as any).Authorization).toBe('Basic ' + Buffer.from(f.ctx.token + ':' + f.ctx.secret).toString('base64'));
    }
    await f.make().submit(input(prepared)); await f.api.status(); expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it('allows only one dispatch across concurrent workers', async () => {
    const f = fixture(), prepared = await f.api.prepare();
    await Promise.allSettled(Array.from({ length: 8 }, () => f.make().submit(input(prepared))));
    expect(f.transport).toHaveBeenCalledTimes(1); expect(await f.api.status()).toHaveProperty('results.0.state', 'PASSED');
  });
  it('blocks a missing/unknown create-only proof before the intent or request', async () => {
    const f = fixture(), p = await f.api.prepare(); f.flags.failFence = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_STORAGE_FENCE_UNVERIFIED');
    expect(f.map.size).toBe(1); expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['lostClaim', 'wrongAck'] as const)('never sends after %s and never retries an intent', async mode => {
    const f = fixture(), p = await f.api.prepare(); f.flags[mode] = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED');
    expect(f.transport).not.toHaveBeenCalled(); expect(await f.api.status()).toHaveProperty('results.0.state', 'RECONCILIATION_REQUIRED');
    await expect(f.make().submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('recovers an actually saved result after a lost result acknowledgement without resending', async () => {
    const f = fixture(), p = await f.api.prepare(); f.flags.lostResult = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED');
    expect(await f.api.status()).toHaveProperty('results.0.state', 'PASSED');
    await f.make().submit(input(p)); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('never retries transport ambiguity or skips a prior result', async () => {
    const f = fixture(), p = await f.api.prepare();
    await expect(f.api.submit(input(p, 1))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_PREVIOUS_REQUIRED');
    f.flags.failTransport = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED');
    await expect(f.make().submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ index: 3 }, { endpoint: 'https://override.invalid' }, { xml: '<Invoice/>' }, { manifestDigest: '0'.repeat(64) }])('rejects caller overrides: %j', async change => {
    const f = fixture(), p = await f.api.prepare(); await expect(f.api.submit({ ...input(p), ...change })).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('rejects altered invoice bytes even if their hash is recomputed', async () => {
    const f = fixture(); await f.api.prepare(); const m = f.manifest();
    m.artifacts[0].xml = m.artifacts[0].xml.replace('1.15', '9.99');
    m.artifacts[0].invoiceHash = (await prepareZatcaInvoiceHash(m.artifacts[0].xml)).invoiceHashBase64;
    f.map.get('simplified-procedural-compliance/original-suite')!.content = JSON.stringify(m);
    await expect(f.api.status()).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('rejects changed saved scope/response or absent fresh context before writes', async () => {
    const f = fixture(), p = await f.api.prepare(); f.ctx.responseDigest = 'd'.repeat(64);
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_ORIGINAL_CHANGED');
    f.load.mockRejectedValueOnce(Error('PRIVATE_CREDENTIAL'));
    await expect(f.api.prepare()).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_CONTEXT_UNAVAILABLE'); expect(f.map.size).toBe(1); expect(f.transport).not.toHaveBeenCalled();
  });
  it('captures the address before asynchronous reads and refuses absent configuration', async () => {
    const f = fixture(); f.profile.street = 'MUTATED'; await f.api.prepare(); expect(f.manifest().artifacts[0].xml).toContain('Synthetic street');
    const g = fixture(); await expect(g.make(null).prepare()).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_CONTEXT_UNAVAILABLE'); expect(g.map.size).toBe(0);
  });
  it('saves a rejection without retrying and redacts credential-bearing authority codes', async () => {
    const f = fixture(), p = await f.api.prepare();
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ validationResults: { status: 'ERROR', errorMessages: [{ code: f.ctx.secret }], warningMessages: [] } })));
    const result = await f.api.submit(input(p)); expect(result).toHaveProperty('results.0.state', 'FAILED');
    expect(JSON.stringify(result)).not.toContain(f.ctx.secret); expect(result).toHaveProperty('results.0.errorCodes.0', 'REDACTED_AUTHORITY_CODE');
    await f.api.submit(input(p)); await expect(f.api.submit(input(p, 1))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_PREVIOUS_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('refuses a response relinked to another claim or changed intent bytes', async () => {
    const f = fixture(), p = await f.api.prepare(); await f.api.submit(input(p));
    const saved = f.map.get('simplified-procedural-compliance/0/result')!, result = JSON.parse(saved.content);
    const original = saved.content; result.claimId = randomUUID(); saved.content = JSON.stringify(result); saved.version = result.claimId;
    await expect(f.api.status()).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_ORIGINAL_CHANGED');
    saved.content = original; saved.version = JSON.parse(original).claimId;
    const claim = f.map.get('simplified-procedural-compliance/0/intent')!, value = JSON.parse(claim.content); value.artifactHash = '0'.repeat(64); claim.content = JSON.stringify(value);
    await expect(f.api.status()).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_ORIGINAL_CHANGED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['redirect', 'malformed', 'oversized'] as const)('stops after an invalid %s response', async mode => {
    const f = fixture(), p = await f.api.prepare();
    const response = new Response(mode === 'malformed' ? '{}' : mode === 'oversized' ? 'x'.repeat(65537) : JSON.stringify(good));
    if (mode === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    f.transport.mockResolvedValueOnce(response);
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED');
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_SIMPLIFIED_PROCEDURAL_RECONCILIATION_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
});
