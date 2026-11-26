import { describe, expect, it } from 'vitest';
import { convertVatLineToBase, resolveVatExchangeQuote, resolveVatExchangeRate } from './vat-invoice-currency';

describe('VAT invoice currency conversion', () => {
  it('uses the latest direct rate on or before the invoice date', () => {
    expect(resolveVatExchangeRate([
      { from_currency: 'USD', to_currency: 'SAR', rate: 3.7, valuation_date: '2026-01-01' },
      { from_currency: 'USD', to_currency: 'SAR', rate: 3.75, valuation_date: '2026-02-01' },
      { from_currency: 'USD', to_currency: 'SAR', rate: 3.8, valuation_date: '2026-03-01' },
    ], 'USD', 'SAR', '2026-02-15')).toBe('3.75');
  });

  it('can resolve an inverse rate and treats matching currencies as one-to-one', () => {
    expect(resolveVatExchangeRate([
      { from_currency: 'SAR', to_currency: 'USD', rate: 0.25, valuation_date: '2026-02-01' },
    ], 'USD', 'SAR', '2026-02-15')).toBe('4');
    expect(resolveVatExchangeRate([], 'SAR', 'SAR', '2026-02-15')).toBe('1');
    expect(resolveVatExchangeRate([], 'EUR', 'SAR', '2026-02-15')).toBeNull();
  });

  it('returns the same eligible source row for the suggested rate and its date hint', () => {
    const older = { from_currency: 'USD', to_currency: 'SAR', rate: 3.75, valuation_date: '2026-11-24' };
    const future = { ...older, rate: 4.25, valuation_date: '2026-12-01' };
    expect(resolveVatExchangeQuote([future, older], 'USD', 'SAR', '2026-11-25')).toEqual({ rate: '3.75', row: older });
    expect(resolveVatExchangeQuote([future, older], 'USD', 'SAR', '2026-12-01')).toEqual({ rate: '4.25', row: future });
    expect(resolveVatExchangeQuote([future], 'USD', 'SAR', '2026-11-25')).toBeNull();
  });

  it('keeps inverse quote metadata and returns no registry row for matching currencies', () => {
    const inverse = { from_currency: 'SAR', to_currency: 'EUR', rate: 0.25, valuation_date: '2026-11-24' };
    const future = { ...inverse, rate: 0.2, valuation_date: '2026-12-01' };
    expect(resolveVatExchangeQuote([future, inverse], 'EUR', 'SAR', '2026-11-25')).toEqual({ rate: '4', row: inverse });
    expect(resolveVatExchangeQuote([], 'SAR', 'SAR', '2026-11-25')).toEqual({ rate: '1', row: null });
  });

  it('converts and rounds net and VAT separately so base gross matches its parts', () => {
    const line = convertVatLineToBase({
      description: 'Consulting',
      unit_price: '0.05',
      discount_amount: '0.00',
      net_amount: '0.05',
      tax_amount: '0.01',
      gross_amount: '0.06',
      supply_type: 'STANDARD' as const,
    }, '0.5');
    expect(line).toMatchObject({ source_net_amount: '0.05', source_tax_amount: '0.01', net_amount: '0.03', tax_amount: '0.01', gross_amount: '0.04' });
  });
});
