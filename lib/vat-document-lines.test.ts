import { describe, expect, it } from 'vitest';
import { calculateVatDocumentLines } from './vat-document-lines';

describe('calculateVatDocumentLines', () => {
  it('calculates mixed tax categories, line discounts and rounded totals', () => {
    const result = calculateVatDocumentLines([
      { description: 'Consulting', quantity: '2', unit_price: '100', discount_amount: '10', supply_type: 'STANDARD' },
      { description: 'Export service', quantity: 1, unit_price: 50, supply_type: 'ZERO_RATED' },
    ], 15);
    expect(result.lines.map((line) => [line.net_amount, line.tax_amount, line.gross_amount])).toEqual([
      ['190.00', '28.50', '218.50'],
      ['50.00', '0.00', '50.00'],
    ]);
    expect([result.netAmount, result.taxAmount, result.grossAmount]).toEqual(['240.00', '28.50', '268.50']);
  });

  it('rejects discounts greater than the gross line value', () => {
    expect(() => calculateVatDocumentLines([
      { description: 'Item', quantity: 1, unit_price: 10, discount_amount: 11, supply_type: 'STANDARD' },
    ], 15)).toThrow('VAT_LINE_DISCOUNT_EXCEEDS_AMOUNT');
  });
});
