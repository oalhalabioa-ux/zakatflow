import { describe, expect, it } from 'vitest';
import { calculateVatAmounts, summarizeVatDocuments } from './vat';

describe('summarizeVatDocuments', () => {
  it('calculates VAT and invoice totals to two decimal places', () => {
    expect(calculateVatAmounts('100.05', '15')).toEqual({
      netAmount: '100.05',
      taxAmount: '15.01',
      grossAmount: '115.06',
    });
    expect(calculateVatAmounts('100', 0)).toEqual({
      netAmount: '100.00',
      taxAmount: '0.00',
      grossAmount: '100.00',
    });
  });

  it('nets sales tax against recoverable purchase tax and applies credit notes', () => {
    const result = summarizeVatDocuments([
      { document_type: 'SALES', document_kind: 'INVOICE', supply_type: 'STANDARD', net_amount: '1000', tax_amount: '150', recoverable_percent: 100 },
      { document_type: 'SALES', document_kind: 'CREDIT_NOTE', supply_type: 'STANDARD', net_amount: '100', tax_amount: '15', recoverable_percent: 100 },
      { document_type: 'PURCHASE', document_kind: 'INVOICE', supply_type: 'STANDARD', net_amount: '400', tax_amount: '60', recoverable_percent: 50 },
    ]);

    expect(result.salesNet).toBe('900.00');
    expect(result.outputTax).toBe('135.00');
    expect(result.inputTax).toBe('30.00');
    expect(result.taxPayable).toBe('105.00');
    expect(result.documentCount).toBe(3);
  });

  it('reports a recoverable tax credit when input VAT is higher', () => {
    const result = summarizeVatDocuments([
      { document_type: 'SALES', document_kind: 'INVOICE', supply_type: 'STANDARD', net_amount: '100', tax_amount: '15', recoverable_percent: 100 },
      { document_type: 'PURCHASE', document_kind: 'INVOICE', supply_type: 'STANDARD', net_amount: '200', tax_amount: '30', recoverable_percent: 100 },
    ]);

    expect(result.taxPayable).toBe('0.00');
    expect(result.taxCredit).toBe('15.00');
  });
});
