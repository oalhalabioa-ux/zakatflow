import Decimal from 'decimal.js';

export type VatDocumentForSummary = {
  document_type: 'SALES' | 'PURCHASE';
  document_kind: 'INVOICE' | 'CREDIT_NOTE';
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  net_amount: number | string;
  tax_amount: number | string;
  recoverable_percent: number | string;
};

const amount = (value: number | string) => new Decimal(value || 0);

export function calculateVatAmounts(netAmount: number | string, taxRate: number | string) {
  const net = amount(netAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const rate = amount(taxRate);
  const tax = net.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { netAmount: net.toFixed(2), taxAmount: tax.toFixed(2), grossAmount: net.add(tax).toFixed(2) };
}

export function summarizeVatDocuments(documents: VatDocumentForSummary[]) {
  const totals = {
    salesNet: new Decimal(0),
    purchaseNet: new Decimal(0),
    outputTax: new Decimal(0),
    inputTax: new Decimal(0),
    zeroRatedSales: new Decimal(0),
    exemptSales: new Decimal(0),
    outOfScopeSales: new Decimal(0),
  };

  for (const document of documents) {
    const sign = document.document_kind === 'CREDIT_NOTE' ? -1 : 1;
    const net = amount(document.net_amount).mul(sign);
    const tax = amount(document.tax_amount).mul(sign);

    if (document.document_type === 'SALES') {
      totals.salesNet = totals.salesNet.add(net);
      totals.outputTax = totals.outputTax.add(tax);
      if (document.supply_type === 'ZERO_RATED') totals.zeroRatedSales = totals.zeroRatedSales.add(net);
      if (document.supply_type === 'EXEMPT') totals.exemptSales = totals.exemptSales.add(net);
      if (document.supply_type === 'OUT_OF_SCOPE') totals.outOfScopeSales = totals.outOfScopeSales.add(net);
    } else {
      totals.purchaseNet = totals.purchaseNet.add(net);
      totals.inputTax = totals.inputTax.add(
        tax.mul(amount(document.recoverable_percent)).div(100),
      );
    }
  }

  const netTax = totals.outputTax.sub(totals.inputTax);
  const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

  return {
    salesNet: money(totals.salesNet),
    purchaseNet: money(totals.purchaseNet),
    outputTax: money(totals.outputTax),
    inputTax: money(totals.inputTax),
    zeroRatedSales: money(totals.zeroRatedSales),
    exemptSales: money(totals.exemptSales),
    outOfScopeSales: money(totals.outOfScopeSales),
    netTax: money(netTax),
    taxPayable: money(Decimal.max(netTax, 0)),
    taxCredit: money(Decimal.max(netTax.negated(), 0)),
    documentCount: documents.length,
  };
}
