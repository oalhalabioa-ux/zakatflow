import Decimal from 'decimal.js';
import { z } from 'zod';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from './vat-einvoice-draft';
import { buildUnsignedZatcaXml, zatcaXmlContextSchema } from './zatca-phase2-xml';
import { prepareZatcaInvoiceHash } from './zatca-xml-hash';
import { prepareSignedZatcaXml, type XadesPreparationOptions, type XadesPreparationSigner } from './zatca-xades-preparation';

// Server-side preparation contract only. Trusted storage/authorization must supply
// BOTH the expected scope and reservation. This is not a public API or a trust decision.
export const zatcaPreparationScopeSchema = z.object({
  organizationId: z.string().uuid(), environment: z.enum(['SIMULATION', 'PRODUCTION']),
  unitId: z.string().uuid(), connectionId: z.string().uuid(), documentId: z.string().uuid(),
  invoiceUuid: z.string().uuid(),
}).strict();
const line = vatEInvoiceDraftSchema.shape.lines.element;
const strictDraft = vatEInvoiceDraftSchema.safeExtend({
  // A saved snapshot must carry these persisted values; form defaults cannot
  // fill missing currency/FX or line tax/price context at a signing boundary.
  currency: vatEInvoiceDraftSchema.shape.currency.removeDefault(),
  exchange_rate: vatEInvoiceDraftSchema.shape.exchange_rate.removeDefault(),
  document_type: vatEInvoiceDraftSchema.shape.document_type.removeDefault(),
  seller_country_code: vatEInvoiceDraftSchema.shape.seller_country_code.removeDefault(),
  buyer_country_code: vatEInvoiceDraftSchema.shape.buyer_country_code.removeDefault(),
  lines: z.array(line.safeExtend({
    unit_code: line.shape.unit_code.removeDefault(), discount_amount: line.shape.discount_amount.removeDefault(),
    tax_category: line.shape.tax_category.removeDefault(), tax_rate: line.shape.tax_rate.removeDefault(),
  }).strict()).min(1).max(500),
}).strict();
const money = z.string().regex(/^(0|[1-9][0-9]{0,29})\.[0-9]{2}$/);
const totalsSchema = z.object({
  line_extension_amount: money, allowance_total_amount: money, tax_exclusive_amount: money,
  tax_total_amount: money, tax_inclusive_amount: money, payable_amount: money,
}).strict();
const lineAmountsSchema = z.array(z.object({
  line_number: z.number().int().positive(), line_extension_amount: money, tax_amount: money, gross_amount: money,
}).strict()).min(1).max(500);
const contextSchema = zatcaXmlContextSchema.omit({ invoiceUuid: true, invoiceCounter: true, previousInvoiceHash: true });
const snapshotSchema = z.object({
  version: z.literal('ZATCA_PREPARATION_V1'), scope: zatcaPreparationScopeSchema, draft: strictDraft,
  context: contextSchema, savedTotals: totalsSchema, savedLineAmounts: lineAmountsSchema,
}).strict();
const savedSchema = snapshotSchema.omit({ version: true, scope: true }).extend({
  documentId: z.string().uuid(), invoiceUuid: z.string().uuid(), status: z.literal('DRAFT'),
}).strict();
const reservationSchema = z.object({
  reservation_id: z.string().uuid(), organization_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), unit_id: z.string().uuid(),
  document_id: z.string().uuid(), invoice_uuid: z.string().uuid(),
  // Never coerce a JavaScript number: PostgreSQL bigint must cross this boundary as text.
  counter: z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= BigInt('9223372036854775807')),
  previous_hash: z.string().min(1).max(128), snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot: snapshotSchema, state: z.literal('RESERVED'),
  invoice_hash: z.null(), prepared_xml: z.null(),
  created_at: z.string().optional(), prepared_at: z.null().optional(),
}).strict();
export type ZatcaPreparationScope = z.infer<typeof zatcaPreparationScopeSchema>;
export type ZatcaPreparationSnapshot = z.infer<typeof snapshotSchema>;

function validateSnapshot(snapshot: ZatcaPreparationSnapshot, scope: ZatcaPreparationScope) {
  for (const key of Object.keys(scope) as (keyof ZatcaPreparationScope)[]) {
    if (snapshot.scope[key] !== scope[key]) throw new Error('SNAPSHOT_SCOPE_MISMATCH');
  }
  if (snapshot.draft.organization_id !== scope.organizationId || snapshot.draft.connection_id !== scope.connectionId) {
    throw new Error('SAVED_DOCUMENT_SCOPE_MISMATCH');
  }
  const calculated = calculateVatEInvoiceDraft(snapshot.draft);
  for (const key of Object.keys(calculated.totals) as (keyof typeof calculated.totals)[]) {
    if (!new Decimal(snapshot.savedTotals[key]).eq(calculated.totals[key])) throw new Error(`SAVED_TOTAL_MISMATCH:${key}`);
  }
  if (snapshot.savedLineAmounts.length !== calculated.lines.length) throw new Error('SAVED_LINE_COUNT_MISMATCH');
  for (let i = 0; i < calculated.lines.length; i++) {
    const actual = snapshot.savedLineAmounts[i], expected = calculated.lines[i];
    if (actual.line_number !== expected.line_number) throw new Error('SAVED_LINE_ORDER_MISMATCH');
    for (const key of ['line_extension_amount', 'tax_amount', 'gross_amount'] as const) {
      if (!new Decimal(actual[key]).eq(expected[key])) throw new Error(`SAVED_LINE_AMOUNT_MISMATCH:${i + 1}:${key}`);
    }
  }
}

/** Build the versioned snapshot BEFORE reserving. Caller must have read the saved
 * document/lines consistently under tenant authorization, not from request JSON.
 * Does not allocate a counter or compute the PostgreSQL JSONB snapshot digest.
 */
export function createZatcaPreparationSnapshot(savedInput: unknown, expectedScope: unknown): ZatcaPreparationSnapshot {
  const saved = savedSchema.parse(savedInput), scope = zatcaPreparationScopeSchema.parse(expectedScope);
  if (saved.documentId !== scope.documentId || saved.invoiceUuid !== scope.invoiceUuid) throw new Error('SAVED_DOCUMENT_IDENTITY_MISMATCH');
  const snapshot = snapshotSchema.parse({
    version: 'ZATCA_PREPARATION_V1', scope, draft: saved.draft, context: saved.context,
    savedTotals: saved.savedTotals, savedLineAmounts: saved.savedLineAmounts,
  });
  validateSnapshot(snapshot, scope);
  // Run all UBL-specific validation before a durable pending reservation is created.
  // This counter/PIH is validation-only and is never returned as allocated chain state.
  buildUnsignedZatcaXml(snapshot.draft, { ...snapshot.context, invoiceUuid: scope.invoiceUuid,
    invoiceCounter: '1', previousInvoiceHash: Buffer.alloc(32).toString('base64') });
  return snapshot;
}

/** Derive the entire artifact from a freshly loaded, scope-checked saved reservation.
 * No arbitrary prepared XML/hash input, database mutation, submission or issuance.
 * The returned finalize arguments are only for the isolated storage contract;
 * authorized DB adapter, full certificate trust/profile and recovery remain gates.
 */
export async function prepareReservedZatcaArtifact(
  reservationInput: unknown, expectedScope: unknown, options: XadesPreparationOptions, sign: XadesPreparationSigner,
) {
  const reservation = reservationSchema.parse(reservationInput), scope = zatcaPreparationScopeSchema.parse(expectedScope);
  for (const [field, key] of [
    ['organization_id', 'organizationId'], ['environment', 'environment'], ['unit_id', 'unitId'],
    ['document_id', 'documentId'], ['invoice_uuid', 'invoiceUuid'],
  ] as const) if (reservation[field] !== scope[key]) throw new Error('RESERVATION_SCOPE_MISMATCH');
  validateSnapshot(reservation.snapshot, scope);
  const context = { ...reservation.snapshot.context, invoiceUuid: reservation.invoice_uuid,
    invoiceCounter: reservation.counter, previousInvoiceHash: reservation.previous_hash };
  const unsigned = buildUnsignedZatcaXml(reservation.snapshot.draft, context);
  // Capture mutable configuration before the first await, just as the parsed snapshot above.
  const capturedOptions = { ...options, signingTime: new Date(options.signingTime.getTime()),
    policy: { ...options.policy }, issuerChainDerBase64: [...options.issuerChainDerBase64] };
  const expectedHash = (await prepareZatcaInvoiceHash(unsigned.xml)).invoiceHashBase64;
  const artifact = await prepareSignedZatcaXml(reservation.snapshot.draft, context, capturedOptions, sign);
  if (artifact.invoiceHashBase64 !== expectedHash
      || (await prepareZatcaInvoiceHash(artifact.xml)).invoiceHashBase64 !== expectedHash) throw new Error('RESERVATION_ARTIFACT_HASH_MISMATCH');
  return {
    ...artifact, stage: 'RESERVATION_BOUND_PREPARATION_ONLY' as const,
    finalizeArguments: { p_org: scope.organizationId, p_environment: scope.environment, p_unit: scope.unitId,
      p_reservation: reservation.reservation_id, p_snapshot_digest: reservation.snapshot_digest,
      p_invoice_hash: expectedHash, p_prepared_xml: artifact.xml },
  };
}
