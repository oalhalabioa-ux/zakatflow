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

  it('calculates percentage discounts on the quantity and unit price before VAT', () => {
    const result = calculateVatDocumentLines([
      { description: 'Service', quantity: 3, unit_price: 100, discount_amount: '12.5', discount_mode: 'PERCENT', supply_type: 'STANDARD' },
    ], 15);
    expect(result.lines[0]).toMatchObject({ discount_amount: '37.50', net_amount: '262.50', tax_amount: '39.38', gross_amount: '301.88' });
  });

  it('rejects percentage discounts greater than 100%', () => {
    expect(() => calculateVatDocumentLines([
      { description: 'Service', quantity: 1, unit_price: 100, discount_amount: '100.01', discount_mode: 'PERCENT', supply_type: 'STANDARD' },
    ], 15)).toThrow('VAT_LINE_DISCOUNT_PERCENT_EXCEEDS_100');
  });
});


it('matches grouped invoice VAT for low-value accounting lines', () => {
  const result = calculateVatDocumentLines(Array.from({ length: 10 }, () => ({ description: 'Small item', quantity: 1, unit_price: '0.03', supply_type: 'STANDARD' as const })), 15);
  expect(result.taxAmount).toBe('0.05');
  expect(result.grossAmount).toBe('0.35');
});
