import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildUnsignedZatcaXml } from '../../lib/zatca-phase2-xml';
import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';
import { standardQaSampleSchema } from './standard-compliance-qa';
import { inspectStandardClearedDocument } from './standard-clearance-inspection';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const pin = z.string().regex(/^[a-f0-9]{64}$/), b64hash = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const kinds = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
const contextSchema = z.object({ organizationId: z.string().uuid(), legalName: z.string().min(1).max(200),
  vatNumber: z.string().regex(/^3[0-9]{13}3$/), originalDigest: pin, standardManifestDigest: pin,
  simplifiedManifestDigest: pin, finalResponseDigest: pin, finalFingerprint: pin, previousInvoiceHash: b64hash,
  token: z.string().min(4).max(32768), secret: z.string().min(1).max(8192),
}).strict();
const artifactSchema = z.object({ kind: z.enum(kinds), uuid: z.string().uuid(), xml: z.string().min(1).max(20000), invoiceHash: b64hash }).strict();
const manifestSchema = z.object({ version: z.literal('QA_STANDARD_CLEARANCE_V1'), id: z.string().uuid(),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/), contextDigest: pin, createdAt: z.string().datetime(),
  artifacts: z.array(artifactSchema).length(3),
}).strict();
const intentSchema = z.object({ version: z.literal('QA_STANDARD_CLEARANCE_INTENT_V1'), id: z.string().uuid(),
  manifestDigest: pin, index: z.number().int().min(0).max(2), artifactHash: pin }).strict();
const resultSchema = z.object({ version: z.literal('QA_STANDARD_CLEARANCE_RESPONSE_V1'), claimId: z.string().uuid(),
  manifestDigest: pin, index: z.number().int().min(0).max(2), http: z.number().int().min(100).max(599),
  rawResponse: z.string().max(48000),
}).strict();
type Saved = { content: string; version: string };
export interface StandardClearanceQaDependencies {
  // Backend-only: revalidate six saved passes, original identity, final CSID and
  // fresh KMS SPKI. Never accept credentials, scope or previous hash from HTTP.
  load(): Promise<unknown>;
  read(name: string): Promise<Saved | null>;
  create(name: string, version: string, content: string): Promise<{ version: string }>;
  assertCreateOnly(): Promise<void>;
  transport: typeof fetch;
}

/** Fixed SIMULATION STANDARD clearance only. No local stamp, application
 * activation, reporting, accounting, CSR or credential issuance. Returned XML
 * stays encrypted; matching content/UUID and a present stamp are protocol
 * evidence, NOT independent verification of the authority's stamp/CA trust.
 */
export function createStandardClearanceQa(deps: StandardClearanceQaDependencies, privateSample: unknown, sourceSha: string) {
  const prefix = 'standard-clearance/', manifestName = prefix + 'original-suite';
  const address = standardQaSampleSchema.safeParse(privateSample);
  const flags = { stage: 'STANDARD_CLEARANCE_QA_ONLY', diagnosticOnly: true, applicationProfileApproved: false,
    trustVerified: false, authorityStampVerified: false, activationAllowed: false } as const;
  async function context() {
    try {
      const saved = contextSchema.parse(await deps.load());
      if (!address.success) throw Error();
      const { token: _token, secret: _secret, ...binding } = saved;
      return { saved, sample: address.data, digest: hash(JSON.stringify({ ...binding, sample: address.data })) };
    } catch { throw Error('QA_CLEARANCE_CONTEXT_UNAVAILABLE'); }
  }
  async function build(ctx: Awaited<ReturnType<typeof context>>, id: string, at: Date, uuids: string[]) {
    const local = new Date(at.getTime() + 3 * 3600000).toISOString(), date = local.slice(0, 10), time = local.slice(11, 19);
    let previous = ctx.saved.previousInvoiceHash;
    const artifacts = [], originalNumber = 'YQSIM-' + id.slice(0, 8) + '-C1';
    for (let i = 0; i < 3; i++) {
      const s = ctx.sample, uuid = uuids[i];
      const draft = { organization_id: ctx.saved.organizationId, invoice_number: 'YQSIM-' + id.slice(0, 8) + '-C' + (i + 1),
        document_type: kinds[i], invoice_category: 'STANDARD', issue_date: date, issue_time: time,
        seller_name: ctx.saved.legalName, seller_vat_number: ctx.saved.vatNumber, seller_address: s.street,
        seller_city: s.city, seller_building_number: s.building, seller_district: s.district,
        seller_additional_number: s.additional, seller_postal_code: s.postal,
        buyer_name: 'عميل اختبار المحاكاة', buyer_vat_number: '399999999800003', buyer_address: 'Synthetic test street',
        buyer_city: 'Riyadh', buyer_building_number: '1234', buyer_district: 'Synthetic test district', buyer_postal_code: '12345',
        ...(i ? { billing_reference: originalNumber, note_reason: 'تصحيح عينة محاكاة فقط' } : {}),
        lines: [{ item_name: 'عينة اختبار محاكاة فقط', quantity: 1, unit_price: 1, tax_category: 'S', tax_rate: 15 }] };
      const built = buildUnsignedZatcaXml(draft, { invoiceUuid: uuid, invoiceCounter: String(i + 7), previousInvoiceHash: previous,
        supplyDate: date, sellerId: { scheme: 'OTH', value: 'SIMULATIONQA' }, paymentMeansCode: '30' });
      const invoiceHash = (await prepareZatcaInvoiceHash(built.xml)).invoiceHashBase64;
      artifacts.push({ kind: kinds[i], uuid, xml: built.xml, invoiceHash }); previous = invoiceHash;
    }
    return artifacts;
  }
  async function manifest(ctx: Awaited<ReturnType<typeof context>>) {
    const saved = await deps.read(manifestName); if (!saved) return null;
    const value = manifestSchema.parse(JSON.parse(saved.content));
    if (saved.version !== value.id || value.contextDigest !== ctx.digest || JSON.stringify(value) !== saved.content
      || new Set(value.artifacts.map(a => a.uuid)).size !== 3) throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
    const expected = await build(ctx, value.id, new Date(value.createdAt), value.artifacts.map(a => a.uuid));
    if (JSON.stringify(expected) !== JSON.stringify(value.artifacts)) throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
    return { value, digest: hash(saved.content) };
  }
  type Manifest = NonNullable<Awaited<ReturnType<typeof manifest>>>;
  async function intent(i: number, m: Manifest) {
    const saved = await deps.read(prefix + i + '/intent'); if (!saved) return null;
    const value = intentSchema.parse(JSON.parse(saved.content));
    if (saved.version !== value.id || value.index !== i || value.manifestDigest !== m.digest
      || value.artifactHash !== hash(m.value.artifacts[i].xml) || JSON.stringify(value) !== saved.content)
      throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
    return value;
  }
  async function result(i: number, m: Manifest) {
    const saved = await deps.read(prefix + i + '/result'); if (!saved) return null;
    const value = resultSchema.parse(JSON.parse(saved.content)), claim = await intent(i, m);
    if (!claim || saved.version !== claim.id || value.claimId !== claim.id || value.index !== i
      || value.manifestDigest !== m.digest || JSON.stringify(value) !== saved.content) throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
    return value;
  }
  async function inspect(value: z.infer<typeof resultSchema>, artifact: z.infer<typeof artifactSchema>) {
    // No authority text/code/XML is reflected to HTTP. Even parse failures stay
    // retained as a terminal diagnostic response, not a retry-ready result.
    const failed = { http: value.http, protocolPassed: false, returnedDocumentMatched: false,
      disposition: 'UNVERIFIED' as string, errorCount: 0, warningCount: 0, errorCodes: [] as string[], warningCodes: [] as string[] };
    try {
      const body = z.object({ clearanceStatus: z.enum(['CLEARED', 'NOT_CLEARED']),
        validationResults: z.object({ status: z.enum(['PASS', 'WARNING', 'ERROR']), errorMessages: z.array(z.unknown()).max(40),
          warningMessages: z.array(z.unknown()).max(40) }), clearedInvoice: z.string().max(45000).nullable().optional(),
      }).parse(JSON.parse(value.rawResponse));
      // Return only tightly bounded code shapes, never authority prose/values.
      // Credentials may be echoed upstream; a fixed code vocabulary shape keeps
      // private strings out even when an unexpected response invents a code.
      const codes = (items: unknown[]) => items.map(item => {
        const code = item && typeof item === 'object' ? (item as Record<string,unknown>).code : null;
        return typeof code === 'string' && ( /^BR-(?:KSA|CO|S|E|AE|O|Z|G|IC|IG|CL|DEC|VAT|B|F|P)(?:-[A-Z0-9]{1,12}){0,3}-[0-9]{1,3}$/.test(code)
          || /^(?:certificate-issuer-name|certificate-hashing|certificate-signature|certificate-validity|certificate-public-key|signed-properties-hashing|signatureValue|invoiceHash|XSD_ZATCA_VALID)$/.test(code))
          ? code : 'UNCLASSIFIED_AUTHORITY_CODE';
      });
      const base = { ...failed, disposition: body.clearanceStatus, errorCount: body.validationResults.errorMessages.length,
        warningCount: body.validationResults.warningMessages.length, errorCodes: codes(body.validationResults.errorMessages),
        warningCodes: codes(body.validationResults.warningMessages) };
      if (![200, 202].includes(value.http) || body.clearanceStatus !== 'CLEARED' || base.errorCount
        || !body.clearedInvoice || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.clearedInvoice)) return base;
      const bytes = Buffer.from(body.clearedInvoice, 'base64');
      if (bytes.length > 32768 || bytes.toString('base64') !== body.clearedInvoice) return base;
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const returnedInspection = await inspectStandardClearedDocument(xml, artifact);
      const returnedDocumentMatched = returnedInspection.canonicalInvoiceHashMatched && returnedInspection.uuidMatched && returnedInspection.stampStructurePresent;
      return { ...base, returnedInspection, returnedDocumentMatched,
        protocolPassed: returnedDocumentMatched && value.http === 200 && body.validationResults.status === 'PASS' && !base.warningCount };
    } catch { return failed; }
  }
  async function summary(m: Manifest) {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const saved = await result(i, m), claim = await intent(i, m), checked = saved ? await inspect(saved, m.value.artifacts[i]) : null;
      const state = checked ? checked.protocolPassed ? 'PASSED' : checked.disposition === 'CLEARED'
        && checked.returnedDocumentMatched && checked.warningCount > 0 && !checked.errorCount ? 'CLEARED_WITH_WARNINGS'
        : checked.disposition === 'CLEARED' ? 'CLEARED_VERIFICATION_REQUIRED' : 'FAILED'
        : claim ? 'RECONCILIATION_REQUIRED' : 'NOT_SENT';
      results.push({ kind: kinds[i], state, ...(checked ?? {}) });
    }
    return { ...flags, manifestDigest: m.digest, results, protocolPassed: results.every(r => r.state === 'PASSED') };
  }
  return {
    async status() {
      const m = await manifest(await context());
      return m ? summary(m) : { ...flags, state: 'NOT_PREPARED' as const };
    },
    async prepare() {
      const ctx = await context(), existing = await manifest(ctx); if (existing) return summary(existing);
      if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw Error('QA_CLEARANCE_CONTEXT_UNAVAILABLE');
      await deps.assertCreateOnly();
      const id = randomUUID(), at = new Date();
      const value = manifestSchema.parse({ version: 'QA_STANDARD_CLEARANCE_V1', id, sourceSha, contextDigest: ctx.digest,
        createdAt: at.toISOString(), artifacts: await build(ctx, id, at, kinds.map(() => randomUUID())) });
      const content = JSON.stringify(value); if (Buffer.byteLength(content) > 65536) throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
      try { await deps.create(manifestName, id, content); } catch { /* Recover only the immutable first suite. */ }
      const saved = await manifest(ctx); if (!saved) throw Error('QA_CLEARANCE_STORAGE_UNAVAILABLE');
      return summary(saved);
    },
    async submit(input: unknown) {
      const p = z.object({ index: z.number().int().min(0).max(2), manifestDigest: pin }).strict().safeParse(input);
      if (!p.success) throw Error('QA_CLEARANCE_INPUT_INVALID');
      const ctx = await context(), m = await manifest(ctx);
      if (!m || m.digest !== p.data.manifestDigest) throw Error('QA_CLEARANCE_ORIGINAL_CHANGED');
      const i = p.data.index;
      if (await result(i, m) || await intent(i, m)) return summary(m);
      for (let prior = 0; prior < i; prior++) {
        const saved = await result(prior, m);
        if (!saved || !(await inspect(saved, m.value.artifacts[prior])).protocolPassed) throw Error('QA_CLEARANCE_PREVIOUS_REQUIRED');
      }
      await deps.assertCreateOnly();
      const id = randomUUID(), claim = JSON.stringify(intentSchema.parse({ version: 'QA_STANDARD_CLEARANCE_INTENT_V1',
        id, manifestDigest: m.digest, index: i, artifactHash: hash(m.value.artifacts[i].xml) }));
      try {
        const name = prefix + i + '/intent', ack = await deps.create(name, id, claim), saved = await deps.read(name);
        if (ack.version !== id || saved?.version !== id || saved.content !== claim) throw Error();
      } catch { throw Error('QA_CLEARANCE_RECONCILIATION_REQUIRED'); }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const a = m.value.artifacts[i];
        const response = await deps.transport('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single', {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2', 'Clearance-Status': '1',
            Authorization: 'Basic ' + Buffer.from(ctx.saved.token + ':' + ctx.saved.secret).toString('base64') },
          body: JSON.stringify({ invoiceHash: a.invoiceHash, uuid: a.uuid, invoice: Buffer.from(a.xml).toString('base64') }),
        });
        if (response.redirected || !response.body) throw Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > 48000) { await reader.cancel(); throw Error(); } chunks.push(part.value);
        } } finally { reader.releaseLock(); }
        const rawResponse = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const content = JSON.stringify(resultSchema.parse({ version: 'QA_STANDARD_CLEARANCE_RESPONSE_V1', claimId: id,
          manifestDigest: m.digest, index: i, http: response.status, rawResponse }));
        if (Buffer.byteLength(content) > 65536) throw Error();
        // Retain before parsing/matching: even rejected/mismatched XML is not lost.
        const name = prefix + i + '/result', ack = await deps.create(name, id, content), saved = await deps.read(name);
        if (ack.version !== id || saved?.version !== id || saved.content !== content) throw Error();
      } catch { throw Error('QA_CLEARANCE_RECONCILIATION_REQUIRED'); }
      finally { clearTimeout(timer); }
      return summary(m);
    },
  };
}
