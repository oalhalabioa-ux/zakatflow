import Decimal from 'decimal.js';

export type ValuationInput = {
  quantity: Decimal.Value;
  pricePerUnit: Decimal.Value;
  priceCurrency: string;
  baseCurrency: string;
  fxRate: Decimal.Value;
};

export function valueAsset(input: ValuationInput) {
  const marketValue = new Decimal(input.quantity).mul(input.pricePerUnit);
  const baseValue = marketValue.mul(input.fxRate);
  return { marketValue, baseValue, currency: input.priceCurrency, baseCurrency: input.baseCurrency };
}
