import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildUnsignedZatcaXml } from '../../lib/zatca-phase2-xml';
import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const pin = z.string().regex(/^[a-f0-9]{64}$/);
const kinds = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
const text = z.string().min(1).max(200).refine(v => v === v.trim() && !/[\x00-\x1f\x7f]/.test(v));
export const standardQaSampleSchema = z.object({
  street: text, building: z.string().regex(/^[0-9]{4}$/), district: text,
  additional: z.string().regex(/^[0-9]{4}$/), postal: z.string().regex(/^[0-9]{5}$/), city: text,
}).strict();
const contextSchema = z.object({ organizationId: z.string().uuid(), legalName: text,
  vatNumber: z.string().regex(/^3[0-9]{13}3$/), originalDigest: pin, responseDigest: pin,
  token: z.string().min(4).max(32768), secret: z.string().min(1).max(8192),
}).strict();
const artifactSchema = z.object({ kind: z.enum(kinds), uuid: z.string().uuid(), xml: z.string().min(1).max(20000),
  invoiceHash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) }).strict();
const manifestSchema = z.object({ version: z.literal('QA_STANDARD_COMPLIANCE_V1'), id: z.string().uuid(), sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  contextDigest: pin, createdAt: z.string().datetime(), artifacts: z.array(artifactSchema).length(3),
}).strict();
const outcomeSchema = z.object({ version: z.literal('QA_STANDARD_OUTCOME_V1'), claimId: z.string().uuid(), manifestDigest: pin,
  index: z.number().int().min(0).max(2), http: z.number().int().min(100).max(599), passed: z.boolean(),
  errorCodes: z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/)).max(40),
  warningCodes: z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/)).max(40),
}).strict();
const claimSchema = z.object({ version: z.literal('QA_STANDARD_INTENT_V1'), id: z.string().uuid(), manifestDigest: pin,
  index: z.number().int().min(0).max(2), artifactHash: pin }).strict();
type Saved = { content: string; version: string };
export interface StandardQaDependencies {
  // Backend closure freshly verifies the saved original/response/key/time. Not HTTP input.
  load(): Promise<unknown>;
  read(name: string): Promise<Saved | null>;
  create(name: string, version: string, content: string): Promise<{ version: string }>;
  assertCreateOnly(): Promise<void>;
  transport: typeof fetch;
}

/** Three unsigned STANDARD diagnostic samples only, fixed Simulation compliance
 * endpoint. No stamp, production CSID, reporting/clearance, finance/SQL or issuer
 * activation. Buyer/registration/item/amount are explicitly synthetic test data.
 * Each immutable artifact has a create-only one-shot claim; unknown outcomes
 * never trigger automatic resend. No arbitrary XML/profile/credential from HTTP.
 */
export function createStandardComplianceQa(deps: StandardQaDependencies, privateSample: unknown, sourceSha: string) {
  const manifestName = 'standard-compliance/original-suite';
  const capturedSample = standardQaSampleSchema.safeParse(privateSample);
  async function context() {
    try {
      const saved = contextSchema.parse(await deps.load());
      if (!capturedSample.success) throw new Error();
      const sample = capturedSample.data;
      return { saved, sample, digest: hash(JSON.stringify({ organizationId: saved.organizationId, legalName: saved.legalName,
        vatNumber: saved.vatNumber, originalDigest: saved.originalDigest, responseDigest: saved.responseDigest, sample })) };
    } catch { throw new Error('QA_STANDARD_CONTEXT_UNAVAILABLE'); }
  }
  async function buildArtifacts(ctx: Awaited<ReturnType<typeof context>>, id: string, at: Date, uuids: string[]) {
    const local = new Date(at.getTime() + 3 * 3600000).toISOString(), date = local.slice(0, 10), time = local.slice(11, 19), artifacts = [];
    let previous = Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64');
    const originalNumber = 'YQSIM-' + id.slice(0, 8) + '-S1';
    for (let i = 0; i < 3; i++) {
      const kind = kinds[i], uuid = uuids[i], s = ctx.sample;
      const draft = { organization_id: ctx.saved.organizationId, invoice_number: 'YQSIM-' + id.slice(0, 8) + '-S' + (i + 1),
        document_type: kind, invoice_category: 'STANDARD', issue_date: date, issue_time: time, seller_name: ctx.saved.legalName,
        seller_vat_number: ctx.saved.vatNumber, seller_address: s.street, seller_city: s.city, seller_building_number: s.building,
        seller_district: s.district, seller_additional_number: s.additional, seller_postal_code: s.postal,
        buyer_name: 'عميل اختبار المحاكاة', buyer_vat_number: '399999999800003', buyer_address: 'Synthetic test street',
        buyer_city: 'Riyadh', buyer_building_number: '1234', buyer_district: 'Synthetic test district', buyer_postal_code: '12345',
        ...(i ? { billing_reference: originalNumber, note_reason: 'تصحيح عينة محاكاة فقط' } : {}),
        lines: [{ item_name: 'عينة اختبار محاكاة فقط', quantity: 1, unit_price: 1, tax_category: 'S', tax_rate: 15 }] };
      const built = buildUnsignedZatcaXml(draft, { invoiceUuid: uuid, invoiceCounter: String(i + 1), previousInvoiceHash: previous,
        supplyDate: date, sellerId: { scheme: 'OTH', value: 'SIMULATIONQA' }, paymentMeansCode: '30' });
      const invoiceHash = (await prepareZatcaInvoiceHash(built.xml)).invoiceHashBase64;
      artifacts.push({ kind, uuid, xml: built.xml, invoiceHash }); previous = invoiceHash;
    }
    return artifacts;
  }
  async function manifest(ctx: Awaited<ReturnType<typeof context>>) {
    const stored = await deps.read(manifestName); if (!stored) return null;
    const value = manifestSchema.parse(JSON.parse(stored.content));
    if (stored.version !== value.id || value.contextDigest !== ctx.digest || JSON.stringify(value) !== stored.content) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
    if (new Set(value.artifacts.map(a => a.uuid)).size !== 3) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
    const expected = await buildArtifacts(ctx, value.id, new Date(value.createdAt), value.artifacts.map(a => a.uuid));
    if (JSON.stringify(value.artifacts) !== JSON.stringify(expected)) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
    return { value, digest: hash(stored.content) };
  }
  async function intent(index: number, m: NonNullable<Awaited<ReturnType<typeof manifest>>>) {
    const saved = await deps.read(`standard-compliance/${index}/intent`); if (!saved) return null;
    const value = claimSchema.parse(JSON.parse(saved.content));
    if (saved.version !== value.id || value.index !== index || value.manifestDigest !== m.digest
      || value.artifactHash !== hash(m.value.artifacts[index].xml) || JSON.stringify(value) !== saved.content) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
    return value;
  }
  async function outcome(index: number, m: NonNullable<Awaited<ReturnType<typeof manifest>>>) {
    const saved = await deps.read(`standard-compliance/${index}/result`); if (!saved) return null;
    const value = outcomeSchema.parse(JSON.parse(saved.content));
    const claim = await intent(index, m);
    if (!claim || value.claimId !== claim.id || value.claimId !== saved.version || value.index !== index || value.manifestDigest !== m.digest || JSON.stringify(value) !== saved.content)
      throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
    return value;
  }
  async function summary(m: NonNullable<Awaited<ReturnType<typeof manifest>>>) {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const result = await outcome(i, m), claim = await intent(i, m);
      results.push({ kind: kinds[i], state: result ? (result.passed ? 'PASSED' : 'FAILED') : claim ? 'RECONCILIATION_REQUIRED' : 'NOT_SENT',
        ...(result ? { http: result.http, errorCodes: result.errorCodes, warningCodes: result.warningCodes } : {}) });
    }
    return { stage: 'STANDARD_COMPLIANCE_QA_ONLY', manifestDigest: m.digest, results,
      passed: results.every(r => r.state === 'PASSED'), simplifiedPassed: false, activationAllowed: false };
  }
  return {
    async status() {
      const ctx = await context(), saved = await manifest(ctx);
      return saved ? summary(saved) : { stage: 'STANDARD_COMPLIANCE_QA_ONLY', state: 'NOT_PREPARED', activationAllowed: false };
    },
    async prepare() {
      const ctx = await context(), existing = await manifest(ctx); if (existing) return summary(existing);
      if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('QA_STANDARD_CONTEXT_UNAVAILABLE');
      const id = randomUUID(), now = new Date(), artifacts = await buildArtifacts(ctx, id, now, kinds.map(() => randomUUID()));
      const value = manifestSchema.parse({ version: 'QA_STANDARD_COMPLIANCE_V1', id, sourceSha, contextDigest: ctx.digest, createdAt: now.toISOString(), artifacts });
      const content = JSON.stringify(value); if (Buffer.byteLength(content) > 65536) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
      try { await deps.create(manifestName, id, content); } catch { /* Recover only the immutable first preparation, never resend. */ }
      const saved = await manifest(ctx); if (!saved) throw new Error('QA_STANDARD_STORAGE_UNAVAILABLE');
      return summary(saved);
    },
    async submit(input: unknown) {
      const p = z.object({ index: z.number().int().min(0).max(2), manifestDigest: pin }).strict().parse(input), ctx = await context();
      const m = await manifest(ctx); if (!m || m.digest !== p.manifestDigest) throw new Error('QA_STANDARD_ORIGINAL_CHANGED');
      const done = await outcome(p.index, m); if (done) return summary(m);
      for (let i = 0; i < p.index; i++) if (!(await outcome(i, m))?.passed) throw new Error('QA_STANDARD_PREVIOUS_REQUIRED');
      await deps.assertCreateOnly();
      const claimName = `standard-compliance/${p.index}/intent`, id = randomUUID();
      const claim = JSON.stringify({ version: 'QA_STANDARD_INTENT_V1', id, manifestDigest: m.digest, index: p.index, artifactHash: hash(m.value.artifacts[p.index].xml) });
      try {
        const ack = await deps.create(claimName, id, claim), read = await deps.read(claimName);
        if (ack.version !== id || read?.version !== id || read.content !== claim) throw new Error();
      } catch { throw new Error('QA_STANDARD_RECONCILIATION_REQUIRED'); }
      const artifact = m.value.artifacts[p.index];
      try {
        const response = await deps.transport('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance/invoices', {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
          headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2',
            Authorization: 'Basic ' + Buffer.from(ctx.saved.token + ':' + ctx.saved.secret).toString('base64') },
          body: JSON.stringify({ invoiceHash: artifact.invoiceHash, uuid: artifact.uuid, invoice: Buffer.from(artifact.xml).toString('base64') }),
        });
        if (response.redirected || !response.body) throw new Error();
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try { while (true) { const c = await reader.read(); if (c.done) break; size += c.value.byteLength;
          if (size > 65536) { await reader.cancel(); throw new Error(); } chunks.push(c.value); } }
        finally { reader.releaseLock(); }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const v = z.object({ status: z.enum(['PASS', 'WARNING', 'ERROR']), errorMessages: z.array(z.object({ code: z.string() })).max(40),
          warningMessages: z.array(z.object({ code: z.string() })).max(40) }).parse(body.validationResults);
        const code = (s: string) => /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(s)
          && !s.includes(ctx.saved.secret) && !s.includes(ctx.saved.token) ? s : 'REDACTED_AUTHORITY_CODE';
        const result = outcomeSchema.parse({ version: 'QA_STANDARD_OUTCOME_V1', claimId: id, manifestDigest: m.digest, index: p.index,
          http: response.status, passed: response.status === 200 && v.status === 'PASS' && !v.errorMessages.length && !v.warningMessages.length,
          errorCodes: v.errorMessages.map(x => code(x.code)), warningCodes: v.warningMessages.map(x => code(x.code)) });
        const content = JSON.stringify(result);
        await deps.create(`standard-compliance/${p.index}/result`, id, content);
        const read = await deps.read(`standard-compliance/${p.index}/result`);
        if (read?.version !== id || read.content !== content) throw new Error();
      } catch { throw new Error('QA_STANDARD_RECONCILIATION_REQUIRED'); }
      return summary(m);
    },
  };
}
