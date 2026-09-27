import Decimal from 'decimal.js';

export type VatFxRate = {
  from_currency: string;
  to_currency: string;
  rate: string | number;
  valuation_date: string;
};

export function resolveVatExchangeRate(
  rates: VatFxRate[],
  sourceCurrency: string,
  baseCurrency: string,
  invoiceDate: string,
): string | null {
  const source = sourceCurrency.toUpperCase();
  const base = baseCurrency.toUpperCase();
  if (source === base) return '1';

  const eligible = rates.filter((rate) => rate.valuation_date <= invoiceDate);
  const direct = eligible
    .filter((rate) => rate.from_currency.toUpperCase() === source && rate.to_currency.toUpperCase() === base)
    .sort((a, b) => b.valuation_date.localeCompare(a.valuation_date))[0];
  if (direct) return new Decimal(direct.rate).toSignificantDigits(12).toString();

  const inverse = eligible
    .filter((rate) => rate.from_currency.toUpperCase() === base && rate.to_currency.toUpperCase() === source)
    .sort((a, b) => b.valuation_date.localeCompare(a.valuation_date))[0];
  if (inverse) return new Decimal(1).div(inverse.rate).toSignificantDigits(12).toString();
  return null;
}

export function convertVatAmountToBase(value: number | string, rate: number | string) {
  return new Decimal(value || 0).mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function convertVatLineToBase<T extends {
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  tax_amount: string;
  gross_amount: string;
}>(line: T, rate: number | string) {
  const netAmount = convertVatAmountToBase(line.net_amount, rate);
  const taxAmount = convertVatAmountToBase(line.tax_amount, rate);
  return {
    ...line,
    source_unit_price: line.unit_price,
    source_discount_amount: line.discount_amount,
    source_net_amount: line.net_amount,
    source_tax_amount: line.tax_amount,
    source_gross_amount: line.gross_amount,
    unit_price: convertVatAmountToBase(line.unit_price, rate),
    discount_amount: convertVatAmountToBase(line.discount_amount, rate),
    net_amount: netAmount,
    tax_amount: taxAmount,
    gross_amount: new Decimal(netAmount).add(taxAmount).toFixed(2),
  };
}
