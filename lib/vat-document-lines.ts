import Decimal from 'decimal.js';

export type VatDocumentLineInput = {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  discount_amount?: number | string;
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
};

export function calculateVatDocumentLines(lines: VatDocumentLineInput[], standardRate: number | string) {
  const rate = new Decimal(standardRate || 0);
  const detailedLines = lines.map((line) => {
    const grossBeforeDiscount = new Decimal(line.quantity).mul(line.unit_price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const discount = new Decimal(line.discount_amount || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (discount.gt(grossBeforeDiscount)) throw new Error('VAT_LINE_DISCOUNT_EXCEEDS_AMOUNT');
    const net = grossBeforeDiscount.sub(discount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const taxRate = line.supply_type === 'STANDARD' ? rate : new Decimal(0);
    const tax = net.mul(taxRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      description: line.description.trim(),
      quantity: new Decimal(line.quantity).toFixed(3),
      unit_price: new Decimal(line.unit_price).toFixed(2),
      discount_amount: discount.toFixed(2),
      supply_type: line.supply_type,
      net_amount: net.toFixed(2),
      tax_rate: taxRate.toFixed(2),
      tax_amount: tax.toFixed(2),
      gross_amount: net.add(tax).toFixed(2),
    };
  });
  const net = detailedLines.reduce((total, line) => total.add(line.net_amount), new Decimal(0));
  const tax = detailedLines.reduce((total, line) => total.add(line.tax_amount), new Decimal(0));
  return { lines: detailedLines, netAmount: net.toFixed(2), taxAmount: tax.toFixed(2), grossAmount: net.add(tax).toFixed(2) };
}
