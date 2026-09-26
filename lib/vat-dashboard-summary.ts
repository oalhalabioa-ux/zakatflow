export type VatDashboardTotals = {
  salesBase: string;
  salesGross: string;
  purchaseBase: string;
  purchaseVatBeforeRecovery: string;
  outputTax: string;
  inputTax: string;
  taxPayable: string;
  taxCredit: string;
  salesNet: string;
  purchaseNet: string;
  paidAmount: string;
  cashReservedAmount: string;
  filingStatus?: string;
  dueDate?: string;
  zeroRatedSales: string;
  exemptSales: string;
  outOfScopeSales: string;
};

const amountFields: Array<keyof VatDashboardTotals> = [
  'salesBase', 'salesGross', 'purchaseBase', 'purchaseVatBeforeRecovery',
  'outputTax', 'inputTax', 'taxPayable', 'taxCredit', 'salesNet', 'purchaseNet',
  'paidAmount', 'cashReservedAmount', 'zeroRatedSales', 'exemptSales', 'outOfScopeSales',
];

export function aggregateVatDashboardTotals(rows: VatDashboardTotals[]): VatDashboardTotals {
  const result = Object.fromEntries(amountFields.map((field) => [
    field,
    rows.reduce((sum, row) => sum + (Number.isFinite(Number(row[field])) ? Number(row[field]) : 0), 0).toFixed(2),
  ])) as Pick<VatDashboardTotals, typeof amountFields[number]>;

  const dueDates = rows.map((row) => row.dueDate).filter((date): date is string => Boolean(date)).sort();
  const hasFilingStatuses = rows.some((row) => row.filingStatus !== undefined);

  return {
    ...result,
    ...(hasFilingStatuses ? { filingStatus: rows.every((row) => row.filingStatus === 'FILED') ? 'FILED' : 'NOT_FILED' } : {}),
    ...(dueDates.length ? { dueDate: dueDates[0] } : {}),
  };
}
