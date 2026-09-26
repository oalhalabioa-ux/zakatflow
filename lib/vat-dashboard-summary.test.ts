import { describe, expect, it } from 'vitest';
import { aggregateVatDashboardTotals, type VatDashboardTotals } from './vat-dashboard-summary';

const totals = (overrides: Partial<VatDashboardTotals> = {}): VatDashboardTotals => ({
  salesBase: '0', salesGross: '0', purchaseBase: '0', purchaseVatBeforeRecovery: '0',
  outputTax: '0', inputTax: '0', taxPayable: '0', taxCredit: '0', salesNet: '0', purchaseNet: '0',
  paidAmount: '0', cashReservedAmount: '0', zeroRatedSales: '0', exemptSales: '0', outOfScopeSales: '0',
  ...overrides,
});

describe('aggregateVatDashboardTotals', () => {
  it('adds entity amounts without netting one entity’s tax against another', () => {
    const result = aggregateVatDashboardTotals([
      totals({ salesBase: '1000.50', taxPayable: '150', taxCredit: '0', paidAmount: '50' }),
      totals({ salesBase: '200.25', taxPayable: '0', taxCredit: '45', paidAmount: '0' }),
    ]);

    expect(result.salesBase).toBe('1200.75');
    expect(result.taxPayable).toBe('150.00');
    expect(result.taxCredit).toBe('45.00');
    expect(result.paidAmount).toBe('50.00');
  });

  it('uses the earliest filing deadline and marks the group filed only when every entity is filed', () => {
    const result = aggregateVatDashboardTotals([
      totals({ filingStatus: 'FILED', dueDate: '2026-05-31' }),
      totals({ filingStatus: 'NOT_FILED', dueDate: '2026-04-30' }),
    ]);

    expect(result.dueDate).toBe('2026-04-30');
    expect(result.filingStatus).toBe('NOT_FILED');
  });
});
