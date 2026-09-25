import { describe, expect, it } from 'vitest';
import {
  emptyVatPeriodSummary,
  getVatPaymentDeadline,
  getVatYearStart,
  summarizeVatPeriodInputs,
  summarizeVatRowsWithDetail,
} from './vat-period-summary';

describe('VAT aggregate period calculation', () => {
  it('calculates standard sales and purchase VAT, recovery and payable while excluding zero/exempt/out-of-scope VAT', () => {
    const input = {
      ...emptyVatPeriodSummary(),
      sales_standard_base: '1000',
      sales_zero_rated_base: '200',
      sales_exempt_base: '300',
      sales_out_of_scope_base: '400',
      purchases_standard_base: '500',
      purchases_zero_rated_base: '100',
      purchases_exempt_base: '80',
      purchases_out_of_scope_base: '20',
      input_tax_recoverable_percent: '80',
    };
    const result = summarizeVatPeriodInputs(input, 15);
    expect(result.salesBase).toBe('1900.00');
    expect(result.salesGross).toBe('2050.00');
    expect(result.purchaseBase).toBe('700.00');
    expect(result.outputTax).toBe('150.00');
    expect(result.purchaseVatBeforeRecovery).toBe('75.00');
    expect(result.inputTax).toBe('60.00');
    expect(result.taxPayable).toBe('90.00');
  });

  it('includes reverse charge output tax and eligible input tax, and actual import VAT', () => {
    const input = {
      ...emptyVatPeriodSummary(),
      imports_goods_base: '400',
      imports_vat_paid: '60',
      reverse_charge_base: '200',
      input_tax_recoverable_percent: '50',
    };
    const result = summarizeVatPeriodInputs(input, 15);
    expect(result.outputTax).toBe('30.00');
    expect(result.purchaseBase).toBe('600.00');
    expect(result.purchaseVatBeforeRecovery).toBe('90.00');
    expect(result.inputTax).toBe('45.00');
    expect(result.taxCredit).toBe('15.00');
  });

  it('uses aggregate rows instead of detailed records for covered periods to prevent double counting', () => {
    const aggregate = { ...emptyVatPeriodSummary(), period_start: '2026-01-01', period_end: '2026-03-31', sales_standard_base: '1000' };
    const details = [
      { document_type: 'SALES' as const, document_kind: 'INVOICE' as const, supply_type: 'STANDARD' as const, net_amount: 1000, tax_amount: 150, recoverable_percent: 100, transaction_date: '2026-02-10' },
      { document_type: 'SALES' as const, document_kind: 'INVOICE' as const, supply_type: 'STANDARD' as const, net_amount: 200, tax_amount: 30, recoverable_percent: 100, transaction_date: '2026-04-10' },
    ];
    expect(summarizeVatRowsWithDetail(details, [aggregate], 15).salesNet).toBe('1200.00');
    expect(summarizeVatRowsWithDetail(details, [aggregate], 15).outputTax).toBe('180.00');
  });
});

describe('VAT filing dates', () => {
  it('sets the deadline to the last day of the month following the period', () => {
    expect(getVatPaymentDeadline('2026-03-31')).toBe('2026-04-30');
    expect(getVatPaymentDeadline('2026-02-28')).toBe('2026-03-31');
    expect(getVatPaymentDeadline('2026-12-31')).toBe('2027-01-31');
  });

  it('uses the configured fiscal year start month for year-to-date totals', () => {
    expect(getVatYearStart('2026-03-31', 1)).toBe('2026-01-01');
    expect(getVatYearStart('2026-03-31', 4)).toBe('2025-04-01');
  });
});
