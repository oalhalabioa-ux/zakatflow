import { describe, expect, it } from 'vitest';
import { invoiceSummaryLines, requestErrorMessage, settlementInstructionMatches, standaloneIssuedInvoices, validateCollectionAmount } from './vat-invoice-workflow';

describe('invoice and receipt workflow', () => {
  it('counts a linked sale only once, while retaining legacy standalone invoices', () => {
    expect(standaloneIssuedInvoices([{ id: 'linked', accounting_document_id: 'accounting-1' }, { id: 'legacy', accounting_document_id: null }])).toEqual([{ id: 'legacy', accounting_document_id: null }]);
  });
  it('preserves Supabase plain-object errors as well as Error instances', () => {
    expect(requestErrorMessage({ message: 'EINVOICE_DRAFT_LOCKED', code: 'P0001' })).toBe('EINVOICE_DRAFT_LOCKED');
    expect(requestErrorMessage(new Error('UNAUTHORIZED'))).toBe('UNAUTHORIZED');
    expect(requestErrorMessage(null)).toBe('UNKNOWN_ERROR');
  });
  it('accepts partial and full receipts but rejects stale over-collection without clipping', () => {
    expect(validateCollectionAmount('40.00', '115.00')).toBe(40);
    expect(validateCollectionAmount('75.00', '75.00')).toBe(75);
    expect(() => validateCollectionAmount('75.01', '75')).toThrow('SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING');
    expect(() => validateCollectionAmount(0, 75)).toThrow('SETTLEMENT_AMOUNT_INVALID');
    expect(() => validateCollectionAmount(Infinity, 75)).toThrow('SETTLEMENT_AMOUNT_INVALID');
  });
  it('does not silently post an older receipt amount on retry', () => {
    const metadata = { account_id: 'bank-1', settlement_date: '2026-10-08', amount: '40.00', base_amount: '40.00' };
    const request = { accountId: 'bank-1', date: '2026-10-08', amount: 40, baseAmount: 40 };
    expect(settlementInstructionMatches(metadata, request)).toBe(true);
    expect(settlementInstructionMatches(metadata, { ...request, amount: 50 })).toBe(false);
    expect(settlementInstructionMatches(metadata, { ...request, accountId: 'bank-2' })).toBe(false);
  });
});


it('reconciles small-line VAT summaries to the authoritative accounting total', () => {
  const rows = invoiceSummaryLines({ net_amount: '0.30', tax_amount: '0.05', line_items: Array.from({ length: 10 }, () => ({ supply_type: 'STANDARD', tax_rate: '15.00', net_amount: '0.03' })) });
  expect(rows).toHaveLength(1);
  expect(rows[0].net_amount).toBe('0.30');
  expect(rows[0].tax_amount).toBe('0.05');
});
