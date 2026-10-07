import Decimal from 'decimal.js';

/** Linked ZATCA documents represent the same sale as their accounting source. */
export function standaloneIssuedInvoices<T extends { accounting_document_id?: string | null }>(invoices: T[]) {
  return invoices.filter((invoice) => !invoice.accounting_document_id);
}

export function requestErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'UNKNOWN_ERROR';
}

export function validateCollectionAmount(amount: number | string, outstanding: number | string) {
  const requested = new Decimal(amount);
  const remaining = new Decimal(outstanding);
  if (!requested.isFinite() || requested.lte(0)) throw new Error('SETTLEMENT_AMOUNT_INVALID');
  if (requested.gt(remaining)) throw new Error('SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING');
  return requested.toNumber();
}

export function settlementInstructionMatches(metadata: Record<string, unknown>, request: {
  accountId: string; date: string; amount: number; baseAmount: number;
}) {
  return metadata.account_id === request.accountId && metadata.settlement_date === request.date
    && new Decimal(String(metadata.amount ?? 0)).eq(request.amount)
    && new Decimal(String(metadata.base_amount ?? 0)).eq(request.baseAmount);
}


/** Category summaries reconcile to the accounting header, including tax/FX rounding. */
export function invoiceSummaryLines<T extends { net_amount: string | number; tax_amount: string | number; line_items?: Array<{ supply_type: string; tax_rate: string | number; net_amount: string | number }> | null }>(document: T) {
  if (!document.line_items?.length) return [document];
  const groups = new Map<string, { supply_type: string; tax_rate: string | number; net: Decimal }>();
  for (const line of document.line_items) {
    const key = `${line.supply_type}:${line.tax_rate}`;
    const group = groups.get(key) ?? { supply_type: line.supply_type, tax_rate: line.tax_rate, net: new Decimal(0) };
    group.net = group.net.plus(line.net_amount);
    groups.set(key, group);
  }
  const summaries = Array.from(groups.values()).map((group) => ({ ...document, supply_type: group.supply_type, tax_rate: group.tax_rate,
    net_amount: group.net.toFixed(2), tax_amount: group.net.mul(group.tax_rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) }));
  const last = summaries[summaries.length - 1];
  const netDifference = new Decimal(document.net_amount).minus(summaries.reduce((sum, row) => sum.plus(row.net_amount), new Decimal(0)));
  last.net_amount = new Decimal(last.net_amount).plus(netDifference).toFixed(2);
  const taxable = [...summaries].reverse().find((row) => Number(row.tax_rate) > 0) ?? last;
  const taxDifference = new Decimal(document.tax_amount).minus(summaries.reduce((sum, row) => sum.plus(row.tax_amount), new Decimal(0)));
  taxable.tax_amount = new Decimal(taxable.tax_amount).plus(taxDifference).toFixed(2);
  return summaries;
}
