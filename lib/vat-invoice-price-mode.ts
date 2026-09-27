import Decimal from 'decimal.js';

export type PriceModeLine = {
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_category: 'S' | 'Z' | 'E' | 'O';
  tax_rate: string;
};

export function previewInvoiceLine(line: PriceModeLine, pricesIncludeTax: boolean) {
  const quantity = new Decimal(line.quantity || 0);
  const unitPrice = new Decimal(line.unit_price || 0);
  const discount = new Decimal(line.discount_amount || 0);
  const rate = new Decimal(line.tax_rate || 0);
  const divisor = pricesIncludeTax && line.tax_category === 'S'
    ? new Decimal(1).plus(rate.div(100))
    : new Decimal(1);
  const net = Decimal.max(0, quantity.mul(unitPrice).minus(discount).div(divisor));
  const tax = line.tax_category === 'S' ? net.mul(rate).div(100) : new Decimal(0);
  return { net: net.toNumber(), tax: tax.toNumber(), total: net.plus(tax).toNumber() };
}

export function normalizeInvoiceLinePrice<T extends PriceModeLine>(line: T, pricesIncludeTax: boolean): T {
  if (!pricesIncludeTax || line.tax_category !== 'S') return line;
  const divisor = new Decimal(1).plus(new Decimal(line.tax_rate || 0).div(100));
  return {
    ...line,
    unit_price: new Decimal(line.unit_price || 0).div(divisor).toFixed(6),
    discount_amount: new Decimal(line.discount_amount || 0).div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  };
}
