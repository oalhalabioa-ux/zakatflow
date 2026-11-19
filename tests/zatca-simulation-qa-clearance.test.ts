import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createStandardClearanceQa } from '../scripts/zatca/standard-clearance-qa';
import { prepareZatcaInvoiceHash } from '../lib/zatca-xml-hash';

const sample = { street: 'Synthetic street', building: '1234', district: 'Synthetic district', additional: '5678', postal: '12345', city: 'Riyadh' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Deliberately dummy stamp: these tests establish response binding, NOT CA trust
// or authority-signature verification. Those flags must remain false.
export function syntheticClearedXml(xml: string) {
  return xml.replace(/(<Invoice\b[^>]*>)/, '$1<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>U1lOVEhFVElD</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>U1lOVEhFVElD</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>')
    .replace('</Invoice>', '<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">U1lOVEhFVElD</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>');
}
const reply = (xml: string) => ({ clearanceStatus: 'CLEARED', validationResults: { status: 'PASS', errorMessages: [], warningMessages: [] },
  clearedInvoice: Buffer.from(xml).toString('base64') });
function fixture() {
  const ctx = { organizationId: randomUUID(), legalName: 'شركة اختبار اصطناعي', vatNumber: '312345678901233',
    originalDigest: 'a'.repeat(64), standardManifestDigest: 'b'.repeat(64), simplifiedManifestDigest: 'c'.repeat(64),
    finalResponseDigest: 'd'.repeat(64), finalFingerprint: 'e'.repeat(64), previousInvoiceHash: Buffer.alloc(32, 17).toString('base64'),
    token: 'PRIVATE_FINAL_TOKEN', secret: 'PRIVATE_FINAL_SECRET' };
  const map = new Map<string, { content: string; version: string }>();
  const flags = { lostClaim: false, lostResult: false, wrongClaimAck: false, wrongResultAck: false, deny: false };
  const load = vi.fn(async () => structuredClone(ctx)), read = vi.fn(async (name: string) => map.get(name) ?? null);
  const create = vi.fn(async (name: string, version: string, content: string) => {
    if (flags.deny || map.has(name)) throw Error('PRIVATE_STORAGE_FAILURE');
    map.set(name, { content, version });
    if (name.endsWith('/intent') && flags.lostClaim || name.endsWith('/result') && flags.lostResult) throw Error('PRIVATE_LOST_ACK');
    return { version: name.endsWith('/intent') && flags.wrongClaimAck || name.endsWith('/result') && flags.wrongResultAck ? randomUUID() : version };
  });
  const assertCreateOnly = vi.fn(async () => {});
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init!.body));
    return new Response(JSON.stringify(reply(syntheticClearedXml(Buffer.from(payload.invoice, 'base64').toString()))));
  });
  const make = (address: unknown = sample) => createStandardClearanceQa({ load, read, create, assertCreateOnly, transport }, address, 'f'.repeat(40));
  return { ctx, map, flags, load, read, create, assertCreateOnly, transport, make, api: make(),
    manifest: () => JSON.parse(map.get('standard-clearance/original-suite')!.content) };
}
const input = (status: any, index = 0) => ({ index, manifestDigest: status.manifestDigest });

describe('isolated STANDARD Simulation clearance protocol', () => {
  it('reads without writes/HTTP, then builds fresh unsigned counters7–9 from the six-case continuation', async () => {
    const f = fixture(); expect(await f.api.status()).toMatchObject({ state: 'NOT_PREPARED', activationAllowed: false, authorityStampVerified: false });
    expect(f.map.size).toBe(0); expect(f.transport).not.toHaveBeenCalled();
    const status = await f.api.prepare(), m = f.manifest();
    expect(new Set(m.artifacts.map((a: any) => a.uuid)).size).toBe(3); expect(f.map.size).toBe(1);
    let prior = f.ctx.previousInvoiceHash;
    for (let i = 0; i < 3; i++) {
      const a = m.artifacts[i]; expect(a.xml).toContain('<cbc:UUID>' + a.uuid + '</cbc:UUID>');
      expect(a.xml).toContain('>' + (i + 7) + '</cbc:UUID>'); expect(a.xml).toContain(prior);
      expect(a.xml).toContain('name="0100000"'); expect(a.xml).toContain('>1.15</cbc:TaxInclusiveAmount>');
      expect(a.xml).not.toMatch(/SignatureValue|PRIVATE_|<cbc:ID>QR/);
      expect((await prepareZatcaInvoiceHash(a.xml)).invoiceHashBase64).toBe(a.invoiceHash); prior = a.invoiceHash;
    }
    const before = [...f.map.values()].map(x => x.content);
    expect(await f.make().prepare()).toEqual(status); expect([...f.map.values()].map(x => x.content)).toEqual(before);
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|<Invoice|organizationId|vatNumber|certificate|token|secret/);
  });
  it('sends each exact immutable artifact once with FINAL credentials to fixed Simulation clearance only', async () => {
    const f = fixture(), p = await f.api.prepare(); let status: any;
    for (let i = 0; i < 3; i++) {
      status = await f.api.submit(input(p, i));
      const [url, init] = f.transport.mock.calls[i], a = f.manifest().artifacts[i];
      expect(url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single');
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: {
        'Clearance-Status': '1', 'Accept-Version': 'V2', Authorization: 'Basic ' + Buffer.from(f.ctx.token + ':' + f.ctx.secret).toString('base64') } });
      expect(JSON.parse(String(init!.body))).toEqual({ uuid: a.uuid, invoiceHash: a.invoiceHash, invoice: Buffer.from(a.xml).toString('base64') });
      expect(init!.headers).not.toHaveProperty('OTP');
    }
    expect(status).toMatchObject({ protocolPassed: true, authorityStampVerified: false, trustVerified: false, applicationProfileApproved: false, activationAllowed: false });
    expect(f.map.size).toBe(7); expect(status.results.every((r: any) => r.returnedDocumentMatched)).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|SignatureValue|rawResponse|clearedInvoice|token|secret/);
    await f.make().status(); await f.make().submit(input(p)); expect(f.transport).toHaveBeenCalledTimes(3);
    expect(f.create).toHaveBeenCalledTimes(7);
  });
  it.each(['originalDigest','standardManifestDigest','simplifiedManifestDigest','finalResponseDigest','finalFingerprint','previousInvoiceHash'] as const)
    ('rejects changed %s before a claim or transport', async key => {
      const f = fixture(), p = await f.api.prepare(); f.ctx[key] = key === 'previousInvoiceHash' ? Buffer.alloc(32, 18).toString('base64') : '0'.repeat(64);
      await expect(f.api.submit(input(p))).rejects.toThrow('QA_CLEARANCE_ORIGINAL_CHANGED'); expect(f.map.size).toBe(1); expect(f.transport).not.toHaveBeenCalled();
    });
  it('requires backend final/key/identity/completion checks again on every recovery', async () => {
    const f = fixture(), p = await f.api.prepare(); await f.api.submit(input(p));
    f.load.mockRejectedValue(Error('PRIVATE_REVOKED_OR_WRONG_KEY'));
    await expect(f.make().status()).rejects.toThrow('QA_CLEARANCE_CONTEXT_UNAVAILABLE');
    await expect(f.make().submit(input(p))).rejects.toThrow('QA_CLEARANCE_CONTEXT_UNAVAILABLE'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ endpoint: 'https://override.invalid' }, { token: 'PRIVATE' }, { environment: 'PRODUCTION' }, { xml: '<Invoice/>' },
    { certificate: 'MAA=' }, { organizationId: randomUUID() }, { index: 3 }, { manifestDigest: 'bad' }])('rejects caller override %j', async extra => {
    const f = fixture(), p = await f.api.prepare();
    await expect(f.api.submit({ ...input(p), ...extra })).rejects.toThrow('QA_CLEARANCE_INPUT_INVALID'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('requires a passed previous response; does not advance after a rejection or missing returned XML', async () => {
    const f = fixture(), p = await f.api.prepare();
    await expect(f.api.submit(input(p, 1))).rejects.toThrow('QA_CLEARANCE_PREVIOUS_REQUIRED');
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...reply(''), clearedInvoice: null })));
    expect(await f.api.submit(input(p))).toHaveProperty('results.0.state', 'FAILED');
    await expect(f.api.submit(input(p, 1))).rejects.toThrow('QA_CLEARANCE_PREVIOUS_REQUIRED');
    await f.api.submit(input(p)); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['lostClaim','wrongClaimAck'] as const)('does not dispatch after %s, even after reload', async flag => {
    const f = fixture(), p = await f.api.prepare(); f.flags[flag] = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_CLEARANCE_RECONCILIATION_REQUIRED');
    expect(await f.make().submit(input(p))).toHaveProperty('results.0.state', 'RECONCILIATION_REQUIRED'); expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['lostResult','wrongResultAck'] as const)('recovers retained response after %s without replay', async flag => {
    const f = fixture(), p = await f.api.prepare(); f.flags[flag] = true;
    await expect(f.api.submit(input(p))).rejects.toThrow('QA_CLEARANCE_RECONCILIATION_REQUIRED');
    expect(await f.make().submit(input(p))).toHaveProperty('results.0.state', 'PASSED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('allows at most one dispatch across concurrent workers', async () => {
    const f = fixture(), p = await f.api.prepare();
    await Promise.allSettled([f.api.submit(input(p)), f.make().submit(input(p)), f.make().submit(input(p))]);
    expect(f.transport).toHaveBeenCalledTimes(1); expect(await f.make().status()).toHaveProperty('results.0.state', 'PASSED');
  });
  it.each(['content','uuid','unstamped','doctype','not-json','warning','wrong-status','wrong-http','bad-base64','private-messages'] as const)
    ('retains %s response privately and fails instead of claiming clearance', async mode => {
      const f = fixture(), p = await f.api.prepare(), a = f.manifest().artifacts[0]; let xml = syntheticClearedXml(a.xml), http = 200;
      if (mode === 'content') xml = xml.replace('>1.15<', '>2.30<');
      if (mode === 'uuid') xml = xml.replace(a.uuid, randomUUID());
      if (mode === 'unstamped') xml = a.xml;
      if (mode === 'doctype') xml = '<!DOCTYPE Invoice SYSTEM "file:///private">' + xml;
      const body = reply(xml);
      if (mode === 'warning') body.validationResults.warningMessages = ['PRIVATE_AUTHORITY_TEXT'] as never;
      if (mode === 'wrong-status') body.clearanceStatus = 'NOT_CLEARED';
      if (mode === 'wrong-http') http = 202;
      if (mode === 'bad-base64') body.clearedInvoice = 'MAB=';
      if (mode === 'private-messages') body.validationResults.errorMessages = [{ message: f.ctx.secret }] as never;
      const raw = mode === 'not-json' ? 'PRIVATE_NOT_JSON' : JSON.stringify(body);
      f.transport.mockResolvedValueOnce(new Response(raw, { status: http }));
      const status = await f.api.submit(input(p)); expect(status).toHaveProperty('results.0.state', mode === 'warning' ? 'CLEARED_WITH_WARNINGS' : 'FAILED');
      expect(status).toHaveProperty('protocolPassed', false); expect(JSON.stringify(status)).not.toMatch(/PRIVATE_|SignatureValue|clearedInvoice/);
      expect(JSON.parse(f.map.get('standard-clearance/0/result')!.content).rawResponse).toBe(raw);
      await f.make().submit(input(p)); expect(f.transport).toHaveBeenCalledTimes(1);
    });
  it.each(['transport','redirect','oversized','utf8'] as const)('does not retry after %s uncertainty', async mode => {
    const f = fixture(), p = await f.api.prepare();
    f.transport.mockImplementationOnce(async () => {
      if (mode === 'transport') throw Error('PRIVATE_TRANSPORT');
      const r = new Response(mode === 'utf8' ? new Uint8Array([255]) : mode === 'oversized' ? 'x'.repeat(48001) : '{}');
      if (mode === 'redirect') Object.defineProperty(r, 'redirected', { value: true }); return r;
    });
    const error = await f.api.submit(input(p)).catch(e => e); expect(error.message).toBe('QA_CLEARANCE_RECONCILIATION_REQUIRED'); expect(error.cause).toBeUndefined();
    expect(await f.make().submit(input(p))).toHaveProperty('results.0.state', 'RECONCILIATION_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('rejects modified saved XML/hash/result intent linkage without disclosure or a new request', async () => {
    const f = fixture(), p = await f.api.prepare(); await f.api.submit(input(p));
    const result = f.map.get('standard-clearance/0/result')!, v = JSON.parse(result.content); v.claimId = randomUUID(); result.content = JSON.stringify(v);
    await expect(f.make().status()).rejects.toThrow('QA_CLEARANCE_ORIGINAL_CHANGED');
    const suite = f.map.get('standard-clearance/original-suite')!, m = JSON.parse(suite.content); m.artifacts[0].xml += ' '; suite.content = JSON.stringify(m);
    await expect(f.make().status()).rejects.toThrow('QA_CLEARANCE_ORIGINAL_CHANGED'); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('refuses missing address, unavailable create-only fence and missing storage acknowledgement', async () => {
    const f = fixture(); await expect(f.make(null).prepare()).rejects.toThrow('QA_CLEARANCE_CONTEXT_UNAVAILABLE');
    f.assertCreateOnly.mockRejectedValueOnce(Error('QA_STORAGE_FENCE_UNVERIFIED'));
    await expect(f.api.prepare()).rejects.toThrow('QA_STORAGE_FENCE_UNVERIFIED'); expect(f.map.size).toBe(0);
    f.flags.deny = true; await expect(f.api.prepare()).rejects.toThrow('QA_CLEARANCE_STORAGE_UNAVAILABLE'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('binds its digest to the complete private manifest, not a caller-selected invoice', async () => {
    const f = fixture(), p = await f.api.prepare();
    expect(p).toHaveProperty('manifestDigest', sha(f.map.get('standard-clearance/original-suite')!.content));
    await expect(f.api.submit({ ...input(p), manifestDigest: '0'.repeat(64) })).rejects.toThrow('QA_CLEARANCE_ORIGINAL_CHANGED'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('bounds hanging response bodies at the same20-second request deadline', async () => {
    const f = fixture(), p = await f.api.prepare(); vi.useFakeTimers();
    try {
      f.transport.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(c) {
        init!.signal!.addEventListener('abort', () => c.error(Error('PRIVATE_TIMEOUT')));
      } })));
      const attempt = f.api.submit(input(p)).catch(e => e); await vi.advanceTimersByTimeAsync(20001);
      expect((await attempt).message).toBe('QA_CLEARANCE_RECONCILIATION_REQUIRED');
      expect(await f.make().status()).toHaveProperty('results.0.state', 'RECONCILIATION_REQUIRED'); expect(f.transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('distinguishes a202 CLEARED warning and recovers its saved code without replay or advancing the gate', async () => {
    const f = fixture(), p = await f.api.prepare(), body = reply(syntheticClearedXml(f.manifest().artifacts[0].xml));
    body.validationResults.warningMessages = [{ code: 'BR-KSA-80', message: 'PRIVATE_UPSTREAM_MESSAGE' },
      { code: 'certificate-issuer-name' }, { code: 'PRIVATE_FINAL_SECRET' }] as never;
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 202 }));
    const result = await f.api.submit(input(p));
    expect(result).toHaveProperty('results.0.state', 'CLEARED_WITH_WARNINGS');
    expect(result).toHaveProperty('results.0.returnedDocumentMatched', true);
    expect(result).toHaveProperty('results.0.warningCodes', ['BR-KSA-80', 'certificate-issuer-name', 'UNCLASSIFIED_AUTHORITY_CODE']);
    expect(result).toHaveProperty('protocolPassed', false);
    expect(await f.make().status()).toEqual(result); await f.make().submit(input(p));
    await expect(f.api.submit(input(p, 1))).rejects.toThrow('QA_CLEARANCE_PREVIOUS_REQUIRED');
    expect(f.transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  });
});
