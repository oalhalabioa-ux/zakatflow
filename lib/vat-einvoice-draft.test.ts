import { describe, expect, it } from 'vitest';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from './vat-einvoice-draft';

const baseDraft = {
  organization_id: 'a800b1c2-df4a-4a79-9b91-4a451ce2858a',
  invoice_number: 'INV-2026-0001',
  invoice_category: 'STANDARD',
  issue_date: '2026-09-24',
  issue_time: '13:45:00',
  seller_name: 'Levant Holding',
  seller_vat_number: '312345678901233',
  seller_address: 'King Fahd Road',
  seller_building_number: '1234',
  seller_district: 'Al Olaya',
  seller_additional_number: '5678',
  seller_postal_code: '12345',
  seller_city: 'Riyadh',
  buyer_name: 'Customer LLC',
  buyer_address: 'Olaya Street',
  buyer_building_number: '4321',
  buyer_district: 'Al Olaya',
  buyer_city: 'Riyadh',
  buyer_postal_code: '54321',
  lines: [
    { item_name: 'Consulting service', quantity: 2, unit_price: 100, tax_category: 'S', tax_rate: 15 },
  ],
};

describe('VAT e-invoice drafts', () => {
  it('requires buyer details for a standard invoice', () => {
    const { buyer_name: _buyerName, buyer_address: _buyerAddress, buyer_building_number: _buyerBuilding,
      buyer_district: _buyerDistrict, buyer_city: _buyerCity, buyer_postal_code: _buyerPostal, ...draft } = baseDraft;
    const result = vatEInvoiceDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
  });

  it('only accepts SAR until foreign-currency tax conversion is implemented', () => {
    const result = vatEInvoiceDraftSchema.safeParse({ ...baseDraft, currency: 'USD' });
    expect(result.success).toBe(false);
  });

  it('requires Saudi national address components for the seller and standard buyer', () => {
    const result = vatEInvoiceDraftSchema.safeParse({
      ...baseDraft,
      seller_building_number: '12',
      buyer_postal_code: '1234',
    });
    expect(result.success).toBe(false);
  });

  it('requires a reference and reason for a credit or debit note', () => {
    const result = vatEInvoiceDraftSchema.safeParse({ ...baseDraft, document_type: 'CREDIT_NOTE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'NOTE_INVOICE_REFERENCE_REQUIRED')).toBe(true);
      expect(result.error.issues.some((issue) => issue.message === 'NOTE_REASON_REQUIRED')).toBe(true);
    }
  });

  it('calculates rounded line and invoice totals using decimal arithmetic', () => {
    const draft = vatEInvoiceDraftSchema.parse({
      ...baseDraft,
      lines: [
        { item_name: 'Service A', quantity: 3, unit_price: 0.1, tax_category: 'S', tax_rate: 15 },
        { item_name: 'Service B', quantity: 1, unit_price: 100, discount_amount: 10, tax_category: 'S', tax_rate: 15 },
      ],
    });
    const calculated = calculateVatEInvoiceDraft(draft);
    expect(calculated.lines.map((line) => [line.line_extension_amount, line.tax_amount, line.gross_amount])).toEqual([
      ['0.30', '0.05', '0.35'],
      ['90.00', '13.50', '103.50'],
    ]);
    expect(calculated.totals).toEqual({
      line_extension_amount: '90.30',
      allowance_total_amount: '0.00',
      tax_exclusive_amount: '90.30',
      tax_total_amount: '13.55',
      tax_inclusive_amount: '103.85',
      payable_amount: '103.85',
    });
  });

  it('rounds VAT at document level by tax category, not by adding rounded line VAT', () => {
    const draft = vatEInvoiceDraftSchema.parse({
      ...baseDraft,
      lines: Array.from({ length: 3 }, (_, index) => ({
        item_name: `Small line ${index + 1}`,
        quantity: 1,
        unit_price: 0.03,
        tax_category: 'S',
        tax_rate: 15,
      })),
    });
    const calculated = calculateVatEInvoiceDraft(draft);
    expect(calculated.lines.map((line) => line.tax_amount)).toEqual(['0.00', '0.00', '0.00']);
    expect(calculated.taxBreakdowns).toEqual([{ tax_category: 'S', tax_rate: '15.00', taxable_amount: '0.09', tax_amount: '0.01' }]);
    expect(calculated.totals.tax_total_amount).toBe('0.01');
    expect(calculated.totals.payable_amount).toBe('0.10');
  });

  it('rejects a discount larger than its line amount', () => {
    const draft = vatEInvoiceDraftSchema.parse({
      ...baseDraft,
      lines: [{ item_name: 'Service', quantity: 1, unit_price: 10, discount_amount: 11, tax_category: 'S', tax_rate: 15 }],
    });
    expect(() => calculateVatEInvoiceDraft(draft)).toThrow('LINE_DISCOUNT_EXCEEDS_AMOUNT:1');
  });
});
