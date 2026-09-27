import { describe, expect, it } from 'vitest';
import { calculateVatDocumentLines } from './vat-document-lines';
import { prepareVatAccountingEntryLines } from './vat-accounting-entry';

describe('prepareVatAccountingEntryLines', () => {
  it('converts tax-inclusive unit prices and fixed discounts into net values', () => {
    const input = prepareVatAccountingEntryLines([
      { description: 'Service', quantity: '1', unit_price: '115', discount_amount: '10', supply_type: 'STANDARD' },
    ], { standardRate: 15, priceDisplay: 'UNIT', discountMode: 'AMOUNT', pricesIncludeVat: true });

    const result = calculateVatDocumentLines(input, 15);
    expect(result.lines[0]).toMatchObject({ net_amount: '91.30', tax_amount: '13.70', gross_amount: '105.00' });
  });

  it('applies percentage discounts to a tax-inclusive line total', () => {
    const input = prepareVatAccountingEntryLines([
      { description: 'Service', quantity: '10', unit_price: '1150', discount_amount: '10', supply_type: 'STANDARD' },
    ], { standardRate: 15, priceDisplay: 'LINE', discountMode: 'PERCENT', pricesIncludeVat: true });

    const result = calculateVatDocumentLines(input, 15);
    expect(result.lines[0]).toMatchObject({ net_amount: '900.00', tax_amount: '135.00', gross_amount: '1035.00' });
  });

  it('does not remove VAT from exempt, zero-rated or out-of-scope prices', () => {
    const input = prepareVatAccountingEntryLines([
      { description: 'Export', quantity: 1, unit_price: 115, supply_type: 'ZERO_RATED' },
    ], { standardRate: 15, priceDisplay: 'UNIT', discountMode: 'NONE', pricesIncludeVat: true });

    expect(calculateVatDocumentLines(input, 15).lines[0]).toMatchObject({ net_amount: '115.00', tax_amount: '0.00', gross_amount: '115.00' });
  });
});
