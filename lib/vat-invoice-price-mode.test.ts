import { describe, expect, it } from 'vitest';
import { applyInvoiceLineDiscount, normalizeInvoiceLinePrice, previewInvoiceLine } from './vat-invoice-price-mode';

describe('VAT invoice price mode', () => {
  it('splits tax-inclusive unit price and discount into net and VAT', () => {
    const line = { quantity: '1', unit_price: '115', discount_amount: '11.5', tax_category: 'S' as const, tax_rate: '15' };
    expect(previewInvoiceLine(line, true)).toEqual({ net: 90, tax: 13.5, total: 103.5 });
    expect(normalizeInvoiceLinePrice(line, true)).toMatchObject({ unit_price: '100.000000', discount_amount: '10.00' });
  });

  it('leaves exclusive and non-taxable line prices unchanged', () => {
    const standard = { quantity: '2', unit_price: '100', discount_amount: '0', tax_category: 'S' as const, tax_rate: '15' };
    const zeroRated = { ...standard, tax_category: 'Z' as const, tax_rate: '0' };
    expect(previewInvoiceLine(standard, false)).toEqual({ net: 200, tax: 30, total: 230 });
    expect(normalizeInvoiceLinePrice(standard, false)).toBe(standard);
    expect(normalizeInvoiceLinePrice(zeroRated, true)).toBe(zeroRated);
  });

  it('converts a percentage discount to a rounded amount before tax normalization', () => {
    const line = { quantity: '3', unit_price: '100', discount_amount: '12.5', tax_category: 'S' as const, tax_rate: '15' };
    const discounted = applyInvoiceLineDiscount(line, 'PERCENT');
    expect(discounted.discount_amount).toBe('37.50');
    expect(previewInvoiceLine(discounted, false)).toEqual({ net: 262.5, tax: 39.375, total: 301.875 });
  });
});
