import { describe, expect, it } from 'vitest';
import { calculateLiquidityTransfer } from './liquidity-transfer';

const base = { sourceAccountId: 'a', destinationAccountId: 'b', sourceOrganizationId: 'org', destinationOrganizationId: 'org', amount: 100, exchangeRate: 1, sourceBaseRate: 1, destinationBaseRate: 1 };

describe('calculateLiquidityTransfer', () => {
  it('keeps same-currency transfers balanced in base currency', () => {
    expect(calculateLiquidityTransfer(base)).toEqual({ sourceAmount: 100, destinationAmount: 100, sourceBaseAmount: 100, destinationBaseAmount: 100, fxDifferenceBase: 0 });
  });
  it('calculates the received amount and records a currency valuation difference', () => {
    expect(calculateLiquidityTransfer({ ...base, amount: 12.5, exchangeRate: 3.75, sourceBaseRate: 1, destinationBaseRate: 1 / 3.75 })).toEqual({ sourceAmount: 12.5, destinationAmount: 46.875, sourceBaseAmount: 12.5, destinationBaseAmount: 12.5, fxDifferenceBase: 0 });
    expect(calculateLiquidityTransfer({ ...base, amount: 100, exchangeRate: 1, sourceBaseRate: 1, destinationBaseRate: 1.02 }).fxDifferenceBase).toBe(2);
  });
  it('rejects same-account and cross-organization transfers', () => {
    expect(() => calculateLiquidityTransfer({ ...base, destinationAccountId: 'a' })).toThrow('TRANSFER_ACCOUNTS_MUST_DIFFER');
    expect(() => calculateLiquidityTransfer({ ...base, destinationOrganizationId: 'child' })).toThrow('TRANSFER_ACCOUNTS_MUST_SHARE_ORGANIZATION');
  });
  it('rejects non-positive or invalid transfer inputs', () => {
    expect(() => calculateLiquidityTransfer({ ...base, amount: 0 })).toThrow('TRANSFER_RATES_AND_AMOUNT_MUST_BE_POSITIVE');
    expect(() => calculateLiquidityTransfer({ ...base, exchangeRate: Number.NaN })).toThrow('TRANSFER_RATES_AND_AMOUNT_MUST_BE_POSITIVE');
  });
});
