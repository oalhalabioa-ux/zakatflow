import Decimal from 'decimal.js';
import { calculateVatAmounts, summarizeVatDocuments, type VatDocumentForSummary } from './vat';

export const VAT_SUMMARY_AMOUNT_FIELDS = [
  'sales_standard_base',
  'sales_zero_rated_base',
  'sales_exempt_base',
  'sales_out_of_scope_base',
  'purchases_standard_base',
  'purchases_zero_rated_base',
  'purchases_exempt_base',
  'purchases_out_of_scope_base',
  'imports_goods_base',
  'imports_vat_paid',
  'reverse_charge_base',
] as const;

export type VatPeriodSummaryInputs = Record<(typeof VAT_SUMMARY_AMOUNT_FIELDS)[number], number | string> & {
  input_tax_recoverable_percent: number | string;
};

export type VatPeriodSummaryRecord = VatPeriodSummaryInputs & {
  id?: string;
  organization_id?: string;
  period_start?: string;
  period_end?: string;
  filing_status?: 'NOT_FILED' | 'FILED';
  filed_at?: string | null;
  filing_reference?: string | null;
  paid_amount?: number | string;
  paid_at?: string | null;
  payment_reference?: string | null;
  cash_reserved_amount?: number | string;
  notes?: string | null;
};

export const emptyVatPeriodSummary = (): VatPeriodSummaryInputs => ({
  sales_standard_base: '0',
  sales_zero_rated_base: '0',
  sales_exempt_base: '0',
  sales_out_of_scope_base: '0',
  purchases_standard_base: '0',
  purchases_zero_rated_base: '0',
  purchases_exempt_base: '0',
  purchases_out_of_scope_base: '0',
  imports_goods_base: '0',
  imports_vat_paid: '0',
  reverse_charge_base: '0',
  input_tax_recoverable_percent: '100',
});

const decimal = (value: number | string | null | undefined) => new Decimal(value || 0);
const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function vatPeriodSummaryAsDocuments(row: VatPeriodSummaryRecord, standardRate: number | string): VatDocumentForSummary[] {
  const recovery = decimal(row.input_tax_recoverable_percent ?? 100).toFixed(2);
  const rows: VatDocumentForSummary[] = [];
  const add = (document_type: 'SALES' | 'PURCHASE', supply_type: VatDocumentForSummary['supply_type'], net: number | string, taxRate: number | string, exactTax?: number | string) => {
    const amounts = calculateVatAmounts(net, taxRate);
    rows.push({
      document_type,
      document_kind: 'INVOICE',
      supply_type,
      net_amount: amounts.netAmount,
      tax_amount: exactTax ?? amounts.taxAmount,
      recoverable_percent: document_type === 'PURCHASE' ? recovery : 100,
    });
  };

  add('SALES', 'STANDARD', row.sales_standard_base, standardRate);
  add('SALES', 'ZERO_RATED', row.sales_zero_rated_base, 0);
  add('SALES', 'EXEMPT', row.sales_exempt_base, 0);
  add('SALES', 'OUT_OF_SCOPE', row.sales_out_of_scope_base, 0);
  // Reverse-charge services create output tax and, when eligible, recoverable input tax.
  add('SALES', 'STANDARD', row.reverse_charge_base, standardRate);
  add('PURCHASE', 'STANDARD', row.purchases_standard_base, standardRate);
  add('PURCHASE', 'ZERO_RATED', row.purchases_zero_rated_base, 0);
  add('PURCHASE', 'EXEMPT', row.purchases_exempt_base, 0);
  add('PURCHASE', 'OUT_OF_SCOPE', row.purchases_out_of_scope_base, 0);
  // Import VAT is entered as the actual customs VAT amount; the imported base is for spend reporting.
  add('PURCHASE', 'STANDARD', row.imports_goods_base, 0, money(decimal(row.imports_vat_paid)));
  add('PURCHASE', 'STANDARD', row.reverse_charge_base, standardRate);
  return rows;
}

export function summarizeVatPeriodInputs(row: VatPeriodSummaryRecord, standardRate: number | string) {
  const result = summarizeVatDocuments(vatPeriodSummaryAsDocuments(row, standardRate));
  const salesBase = decimal(row.sales_standard_base)
    .add(row.sales_zero_rated_base).add(row.sales_exempt_base).add(row.sales_out_of_scope_base);
  const purchasesBase = decimal(row.purchases_standard_base)
    .add(row.purchases_zero_rated_base).add(row.purchases_exempt_base).add(row.purchases_out_of_scope_base)
    .add(row.imports_goods_base);
  const salesVat = decimal(calculateVatAmounts(row.sales_standard_base, standardRate).taxAmount);
  const purchasesBeforeVat = purchasesBase.add(row.reverse_charge_base);
  const grossSales = salesBase.add(salesVat);
  const purchaseVatBeforeRecovery = decimal(calculateVatAmounts(row.purchases_standard_base, standardRate).taxAmount)
    .add(row.imports_vat_paid)
    .add(calculateVatAmounts(row.reverse_charge_base, standardRate).taxAmount);
  return {
    ...result,
    salesBase: money(salesBase),
    salesGross: money(grossSales),
    purchaseBase: money(purchasesBeforeVat),
    purchaseVatBeforeRecovery: money(purchaseVatBeforeRecovery),
  };
}

export function summarizeVatRowsWithDetail(
  detail: VatDocumentForSummary[],
  aggregateRows: VatPeriodSummaryRecord[],
  standardRate: number | string,
) {
  const covered = aggregateRows.filter((row) => row.period_start && row.period_end);
  const remainingDetail = detail.filter((document) => !covered.some((row) =>
    documentDate(document) >= row.period_start! && documentDate(document) <= row.period_end!,
  ));
  const aggregateDetail = aggregateRows.flatMap((row) => vatPeriodSummaryAsDocuments(row, standardRate));
  return summarizeVatDocuments([...remainingDetail, ...aggregateDetail]);
}

function documentDate(document: VatDocumentForSummary & { transaction_date?: string; issue_date?: string }) {
  return document.transaction_date ?? document.issue_date ?? '';
}

export function summarizePaidAndReserved(rows: VatPeriodSummaryRecord[]) {
  return rows.reduce((totals, row) => ({
    paid: totals.paid.add(row.paid_amount ?? 0),
    cashReserved: totals.cashReserved.add(row.cash_reserved_amount ?? 0),
  }), { paid: new Decimal(0), cashReserved: new Decimal(0) });
}

export function getVatYearStart(periodEnd: string, periodStartMonth: number) {
  const [endYear, endMonth] = periodEnd.split('-').map(Number);
  const year = endMonth < periodStartMonth ? endYear - 1 : endYear;
  return `${year}-${String(periodStartMonth).padStart(2, '0')}-01`;
}

export function getVatPaymentDeadline(periodEnd: string) {
  const [year, month] = periodEnd.split('-').map(Number);
  const deadline = new Date(Date.UTC(year, month + 1, 0));
  return `${deadline.getUTCFullYear()}-${String(deadline.getUTCMonth() + 1).padStart(2, '0')}-${String(deadline.getUTCDate()).padStart(2, '0')}`;
}
