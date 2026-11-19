import { describe, expect, it, vi } from 'vitest';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from './vat-einvoice-draft';
import { createZatcaPreparationSnapshot, prepareReservedZatcaArtifact } from './zatca-reserved-preparation';
import type { XadesPreparationOptions } from './zatca-xades-preparation';

const scope = { organizationId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858a', environment: 'SIMULATION',
  unitId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858c', connectionId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858d',
  documentId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858e', invoiceUuid: 'a800b1c2-df4a-4a79-9b91-4a451ce2858b' };
function fixture() {
  const draft = vatEInvoiceDraftSchema.parse({ organization_id: scope.organizationId, connection_id: scope.connectionId,
    invoice_number: 'SNAPSHOT-1', invoice_category: 'SIMPLIFIED', issue_date: '2026-10-24', issue_time: '12:00',
    seller_name: 'Synthetic seller', seller_vat_number: '312345678901233', seller_address: 'Synthetic street',
    seller_building_number: '1234', seller_additional_number: '5678', seller_district: 'Olaya',
    seller_postal_code: '12345', seller_city: 'Riyadh', currency: 'USD', exchange_rate: 3.75,
    lines: [{ item_name: 'Service', quantity: 2, unit_price: 100, discount_amount: 10, tax_rate: 15 }] });
  const calculated = calculateVatEInvoiceDraft(draft);
  return { documentId: scope.documentId, invoiceUuid: scope.invoiceUuid, status: 'DRAFT', draft,
    context: { supplyDate: '2026-10-24', sellerId: { scheme: 'CRN', value: '1010000000' }, paymentMeansCode: '30' },
    savedTotals: calculated.totals, savedLineAmounts: calculated.lines.map(l => ({ line_number: l.line_number,
      line_extension_amount: l.line_extension_amount, tax_amount: l.tax_amount, gross_amount: l.gross_amount })) };
}
function reservation() {
  return { reservation_id: 'a800b1c2-df4a-4a79-9b91-4a451ce2858f', organization_id: scope.organizationId,
    environment: scope.environment, unit_id: scope.unitId, document_id: scope.documentId, invoice_uuid: scope.invoiceUuid,
    counter: '9007199254740993', previous_hash: Buffer.alloc(32, 1).toString('base64'), snapshot_digest: 'a'.repeat(64),
    snapshot: createZatcaPreparationSnapshot(fixture(), scope), state: 'RESERVED', invoice_hash: null, prepared_xml: null };
}

describe('saved-document and reservation preparation boundary', () => {
  it('captures the exact validated saved amounts, discount and FX without allocating chain state', () => {
    const input = fixture();
    const snapshot = createZatcaPreparationSnapshot(input, scope);
    expect(snapshot.savedTotals.payable_amount).toBe('218.50');
    expect(snapshot.savedTotals.tax_total_amount).toBe('28.50');
    expect(snapshot.draft.exchange_rate).toBe(3.75);
    expect(snapshot.context).not.toHaveProperty('invoiceCounter');
    expect(snapshot.context).not.toHaveProperty('previousInvoiceHash');
    input.draft.lines[0].unit_price = 500;
    expect(snapshot.draft.lines[0].unit_price).toBe(100);
  });
  it.each(['documentId', 'invoiceUuid'] as const)('rejects a changed saved %s', key => {
    const input = fixture(); input[key] = scope.unitId;
    expect(() => createZatcaPreparationSnapshot(input, scope)).toThrow('SAVED_DOCUMENT_IDENTITY_MISMATCH');
  });
  it.each(['organization_id', 'connection_id'] as const)('rejects wrong or missing %s', key => {
    const input = fixture(); input.draft[key] = scope.unitId;
    expect(() => createZatcaPreparationSnapshot(input, scope)).toThrow('SAVED_DOCUMENT_SCOPE_MISMATCH');
    expect(() => createZatcaPreparationSnapshot({ ...fixture(), draft: { ...fixture().draft, [key]: null } }, scope)).toThrow();
  });
  it.each(['line_extension_amount', 'allowance_total_amount', 'tax_exclusive_amount', 'tax_total_amount', 'tax_inclusive_amount', 'payable_amount'] as const)('rejects saved total drift: %s', key => {
    const input = fixture(); input.savedTotals[key] = '1.00';
    expect(() => createZatcaPreparationSnapshot(input, scope)).toThrow(`SAVED_TOTAL_MISMATCH:${key}`);
  });
  it.each(['line_extension_amount', 'tax_amount', 'gross_amount'] as const)('rejects saved line drift: %s', key => {
    const input = fixture(); input.savedLineAmounts[0][key] = '1.00';
    expect(() => createZatcaPreparationSnapshot(input, scope)).toThrow('SAVED_LINE_AMOUNT_MISMATCH');
  });
  it('requires complete ordered lines, exact decimal strings and a draft status', () => {
    const input = fixture(); input.savedLineAmounts[0].line_number = 2;
    expect(() => createZatcaPreparationSnapshot(input, scope)).toThrow('SAVED_LINE_ORDER_MISMATCH');
    for (const saved of [
      { ...fixture(), status: 'ISSUED' },
      { ...fixture(), savedTotals: { ...fixture().savedTotals, payable_amount: 218.5 } },
      { ...fixture(), savedLineAmounts: [...fixture().savedLineAmounts, ...fixture().savedLineAmounts] },
    ]) expect(() => createZatcaPreparationSnapshot(saved, scope)).toThrow();
  });
  it.each(['currency', 'exchange_rate', 'document_type', 'seller_country_code', 'buyer_country_code'])('does not apply form defaults to missing saved %s', key => {
    const input = fixture();
    const draft: Record<string, unknown> = { ...input.draft }; delete draft[key];
    expect(() => createZatcaPreparationSnapshot({ ...input, draft }, scope)).toThrow();
  });
  it.each(['unit_code', 'discount_amount', 'tax_category', 'tax_rate'])('requires explicit persisted line %s', key => {
    const input = fixture();
    const item: Record<string, unknown> = { ...input.draft.lines[0] }; delete item[key];
    expect(() => createZatcaPreparationSnapshot({ ...input, draft: { ...input.draft, lines: [item] } }, scope)).toThrow();
  });
  it('refuses external chain/context fields, unknown line data and XML-invalid identities before reserving', () => {
    for (const saved of [
      { ...fixture(), context: { ...fixture().context, invoiceCounter: '5' } },
      { ...fixture(), context: { ...fixture().context, previousInvoiceHash: 'untrusted' } },
      { ...fixture(), draft: { ...fixture().draft, lines: [{ ...fixture().draft.lines[0], prepaid_amount: 1 }] } },
      { ...fixture(), context: { ...fixture().context, sellerId: { scheme: 'NAT', value: '123' } } },
      { ...fixture(), draft: { ...fixture().draft, seller_name: 'invalid\u0000' } },
    ]) expect(() => createZatcaPreparationSnapshot(saved, scope)).toThrow();
  });
  it.each(['organization_id', 'unit_id', 'environment', 'document_id', 'invoice_uuid'] as const)('rejects reservation %s mismatch before signing', async key => {
    const r = reservation(); r[key] = key === 'environment' ? 'PRODUCTION' : scope.connectionId;
    const sign = vi.fn();
    await expect(prepareReservedZatcaArtifact(r, scope, {} as XadesPreparationOptions, sign)).rejects.toThrow('RESERVATION_SCOPE_MISMATCH');
    expect(sign).not.toHaveBeenCalled();
  });
  it('rechecks snapshot scope, totals and line amounts after reading a reservation', async () => {
    const sign = vi.fn();
    const a = reservation(); a.snapshot.scope.connectionId = scope.unitId;
    const b = reservation(); b.snapshot.savedTotals.payable_amount = '1.00';
    const c = reservation(); c.snapshot.savedLineAmounts[0].tax_amount = '1.00';
    for (const r of [a, b, c]) await expect(prepareReservedZatcaArtifact(r, scope, {} as XadesPreparationOptions, sign)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it('refuses unsafe numeric counters, invalid prior hashes, finalized records and extra artifacts', async () => {
    const sign = vi.fn();
    for (const extra of [
      { counter: 9007199254740993 }, { counter: '9223372036854775808' }, { counter: '01' },
      { previous_hash: 'bad' }, { state: 'PREPARED' }, { prepared_xml: '<Invoice/>' },
      { arbitraryXml: '<Invoice/>' }, { snapshot_digest: 'bad' },
    ]) await expect(prepareReservedZatcaArtifact({ ...reservation(), ...extra }, scope, {} as XadesPreparationOptions, sign)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
});
