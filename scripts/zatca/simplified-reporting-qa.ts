import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { summarizeDeveloperResult } from './developer-result';
import { prepareSimulationProceduralDocument } from './simulation-procedural-document';
import { standardQaSampleSchema } from './standard-compliance-qa';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const pin = z.string().regex(/^[a-f0-9]{64}$/);
const invoiceHash = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
export const reportingPrefix = 'simplified-reporting/';
const manifestName = reportingPrefix + 'document';
const intentName = reportingPrefix + 'intent';
const resultName = reportingPrefix + 'result';
const documentSchema = z.object({
  xml: z.string().min(1).max(20000), invoiceHash, invoiceSignature: z.string().min(80).max(104),
  integritySignature: z.string().min(80).max(104), qrCharacters: z.number().int().min(1).max(700),
}).strict();
const manifestSchema = z.object({
  id: z.string().uuid(), sourceSha: z.string().regex(/^[a-f0-9]{40}$/), contextDigest: pin,
  createdAt: z.string().datetime(), document: documentSchema,
}).strict();
const intentSchema = z.object({ id: z.string().uuid(), manifestDigest: pin }).strict();
const resultSchema = z.object({
  claimId: z.string().uuid(), manifestDigest: pin, http: z.number().int().min(100).max(599),
  rawResponse: z.string().max(24000),
}).strict();

interface ReportingContext {
  organizationId: string; legalName: string; vatNumber: string;
  finalResponseDigest: string; finalFingerprint: string; certificate: string;
  previousInvoiceHash: string; invoiceCounter: string; token: string; secret: string;
}

interface Saved { content: string; version: string }

interface Dependencies {
  load(): Promise<ReportingContext>;
  read(name: string): Promise<Saved | null>;
  create(name: string, version: string, content: string): Promise<{ version: string }>;
  assertCreateOnly(): Promise<void>;
  sign(bytes: Buffer): Promise<Uint8Array>;
  transport: typeof fetch;
}

export function createSimplifiedReportingQa(deps: Dependencies, privateSample: unknown, sourceSha: string) {
  const address = standardQaSampleSchema.safeParse(privateSample);
  async function context() {
    const { token, secret, certificate, ...binding } = await deps.load();
    if (!address.success || !invoiceHash.safeParse(binding.previousInvoiceHash).success)
      throw Error('QA_REPORTING_CONTEXT_UNAVAILABLE');
    return { token, secret, certificate, binding, address: address.data,
      digest: hash(JSON.stringify({ binding, address: address.data })) };
  }
  type Context = Awaited<ReturnType<typeof context>>;
  async function document(ctx: Context, id: string, at: Date, prior?: z.infer<typeof documentSchema>) {
    const local = new Date(at.getTime() + 3 * 3600000).toISOString(), date = local.slice(0, 10);
    const s = ctx.address;
    const draft = { organization_id: ctx.binding.organizationId, invoice_number: 'YQSIM-' + id.slice(0, 8) + '-R1',
      document_type: 'INVOICE', invoice_category: 'SIMPLIFIED', issue_date: date, issue_time: local.slice(11, 19),
      seller_name: ctx.binding.legalName, seller_vat_number: ctx.binding.vatNumber, seller_address: s.street,
      seller_city: s.city, seller_building_number: s.building, seller_district: s.district,
      seller_additional_number: s.additional, seller_postal_code: s.postal,
      lines: [{ item_name: 'عينة إبلاغ المحاكاة', quantity: 1, unit_price: 1, tax_category: 'S', tax_rate: 15 }] };
    const signatures = prior ? [prior.invoiceSignature, prior.integritySignature] : [];
    const signer = prior ? async () => Buffer.from(signatures.shift() ?? '', 'base64') : deps.sign;
    return documentSchema.parse(await prepareSimulationProceduralDocument(draft, { invoiceUuid: id,
      invoiceCounter: ctx.binding.invoiceCounter, previousInvoiceHash: ctx.binding.previousInvoiceHash,
      supplyDate: date, sellerId: { scheme: 'OTH', value: 'SIMULATIONQA' }, paymentMeansCode: '30' },
    { certificate: ctx.certificate, fingerprint: ctx.binding.finalFingerprint, signingTime: at, scopeDigest: ctx.digest, purpose: 'REPORTING' }, signer));
  }
  async function manifest(ctx: Context) {
    const saved = await deps.read(manifestName);
    if (!saved) return null;
    const value = manifestSchema.parse(JSON.parse(saved.content));
    if (saved.version !== value.id || value.contextDigest !== ctx.digest || JSON.stringify(value) !== saved.content
      || JSON.stringify(value.document) !== JSON.stringify(await document(ctx, value.id, new Date(value.createdAt), value.document)))
      throw Error('QA_REPORTING_ORIGINAL_CHANGED');
    return { value, digest: hash(saved.content) };
  }
  type Manifest = NonNullable<Awaited<ReturnType<typeof manifest>>>;
  async function persist(name: string, id: string, value: unknown) {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > 65536) throw Error('QA_REPORTING_STORAGE_UNAVAILABLE');
    const ack = await deps.create(name, id, content), saved = await deps.read(name);
    if (ack.version !== id || saved?.version !== id || saved.content !== content) throw Error('QA_REPORTING_STORAGE_UNAVAILABLE');
  }
  async function summary(m: Manifest) {
    const base = { manifestDigest: m.digest, qrCharacters: m.value.document.qrCharacters };
    const intent = await deps.read(intentName), result = await deps.read(resultName);
    if (!intent && !result) return { ...base, state: 'READY' as const };
    const claim = intentSchema.parse(JSON.parse(intent?.content ?? 'null'));
    if (intent?.version !== claim.id || claim.manifestDigest !== m.digest)
      throw Error('QA_REPORTING_ORIGINAL_CHANGED');
    if (!result) return { ...base, state: 'RECONCILIATION_REQUIRED' as const };
    const value = resultSchema.parse(JSON.parse(result.content));
    if (result.version !== claim.id || value.claimId !== claim.id || value.manifestDigest !== m.digest)
      throw Error('QA_REPORTING_ORIGINAL_CHANGED');
    let body: unknown;
    try { body = JSON.parse(value.rawResponse); } catch { /* The saved response stays terminal. */ }
    const { errorCodes, warningCodes, ...outcome } = summarizeDeveloperResult(value.http, body, 'reporting');
    const safeCode = (code: string) => /^BR-(?:KSA|CO|S|E|AE|O|Z|G|IC|IG|CL|DEC|VAT|B|F|P)(?:-[A-Z0-9]{1,12}){0,3}-[0-9]{1,3}$/.test(code)
      ? code : 'UNCLASSIFIED_AUTHORITY_MESSAGE';
    return { ...base, ...outcome, state: outcome.reportingOutcome, errorCodes: errorCodes.slice(0, 40).map(safeCode),
      warningCodes: warningCodes.slice(0, 40).map(safeCode) };
  }
  return {
    async status() {
      const m = await manifest(await context());
      return m ? summary(m) : { state: 'NOT_PREPARED' as const };
    },
    async prepare() {
      const ctx = await context(), existing = await manifest(ctx);
      if (existing) return summary(existing);
      await deps.assertCreateOnly();
      const id = randomUUID(), now = new Date();
      const value = manifestSchema.parse({ id, sourceSha, contextDigest: ctx.digest,
        createdAt: now.toISOString(), document: await document(ctx, id, now) });
      try { await persist(manifestName, id, value); } catch { /* Read the first immutable preparation. */ }
      const saved = await manifest(ctx);
      if (!saved) throw Error('QA_REPORTING_STORAGE_UNAVAILABLE');
      return summary(saved);
    },
    async submit(manifestDigest: string) {
      const ctx = await context(), m = await manifest(ctx);
      if (!m || m.digest !== manifestDigest) throw Error('QA_REPORTING_ORIGINAL_CHANGED');
      const existing = await summary(m);
      if (existing.state !== 'READY') return existing;
      await deps.assertCreateOnly();
      const id = randomUUID();
      try {
        await persist(intentName, id, { id, manifestDigest });
        const doc = m.value.document;
        const response = await deps.transport('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/reporting/single', {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
          headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2',
            'Clearance-Status': '0', Authorization: 'Basic ' + Buffer.from(ctx.token + ':' + ctx.secret).toString('base64') },
          body: JSON.stringify({ invoiceHash: doc.invoiceHash, uuid: m.value.id, invoice: Buffer.from(doc.xml).toString('base64') }),
        });
        if (response.redirected || !response.body) throw Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 24000) { await reader.cancel(); throw Error(); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const rawResponse = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        await persist(resultName, id, resultSchema.parse({ claimId: id, manifestDigest, http: response.status, rawResponse }));
      } catch { throw Error('QA_REPORTING_RECONCILIATION_REQUIRED'); }
      return summary(m);
    },
  };
}
