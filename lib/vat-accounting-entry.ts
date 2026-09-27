import Decimal from 'decimal.js';

export type VatAccountingEntryLine = {
  description: string;
  unit?: string;
  quantity: string | number;
  unit_price: string | number;
  discount_amount?: string | number;
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
};

export type VatAccountingEntryOptions = {
  standardRate: number | string;
  priceDisplay: 'UNIT' | 'LINE';
  discountMode: 'NONE' | 'AMOUNT' | 'PERCENT';
  pricesIncludeVat: boolean;
};

/** Normalizes form values to the net unit price and net discount expected by VAT calculations. */
export function prepareVatAccountingEntryLines(
  lines: VatAccountingEntryLine[],
  options: VatAccountingEntryOptions,
) {
  const rate = new Decimal(options.standardRate || 0);
  return lines.map((line) => {
    const quantity = new Decimal(line.quantity || 0);
    const enteredPrice = new Decimal(line.unit_price || 0);
    const enteredUnitPrice = options.priceDisplay === 'LINE' && quantity.gt(0)
      ? enteredPrice.div(quantity)
      : enteredPrice;
    const lineRate = line.supply_type === 'STANDARD' ? rate : new Decimal(0);
    const taxFactor = options.pricesIncludeVat
      ? new Decimal(1).plus(lineRate.div(100))
      : new Decimal(1);
    const unitPrice = enteredUnitPrice.div(taxFactor);
    let discount = new Decimal(options.discountMode === 'NONE' ? 0 : line.discount_amount || 0);
    if (options.pricesIncludeVat && options.discountMode === 'AMOUNT') discount = discount.div(taxFactor);

    return {
      ...line,
      unit_price: unitPrice.toSignificantDigits(14).toString(),
      discount_amount: discount.toSignificantDigits(14).toString(),
      discount_mode: options.discountMode === 'PERCENT' ? 'PERCENT' as const : 'AMOUNT' as const,
    };
  });
}
