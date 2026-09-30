import { describe, expect, it } from 'vitest';
import { calculateIntercompanyTransfer } from './intercompany-transfer';

const base = {
  holdingOrganizationId: 'holding',
  sourceOrganizationId: 'holding',
  destinationOrganizationId: 'subsidiary',
  sourceAccountId: 'bank-parent',
  destinationAccountId: 'bank-sub',
  transactionType: 'LOAN' as const,
  sourceParentOrganizationId: null,
  destinationParentOrganizationId: 'holding',
  amount: 1_000_000,
  exchangeRate: 1,
  sourceBaseRate: 1,
  destinationBaseRate: 1,
};

describe('calculateIntercompanyTransfer', () => {
  it('balances same-currency parent-to-subsidiary transfers', () => {
    expect(calculateIntercompanyTransfer(base)).toEqual({
      sourceAmount: 1_000_000,
      destinationAmount: 1_000_000,
      sourceBaseAmount: 1_000_000,
      destinationBaseAmount: 1_000_000,
      fxDifferenceBase: 0,
    });
  });

  it('calculates FX amounts independently for each company base currency', () => {
    expect(calculateIntercompanyTransfer({
      ...base,
      amount: 100,
      exchangeRate: 3.75,
      sourceBaseRate: 1,
      destinationBaseRate: 0.2666667,
    })).toEqual({
      sourceAmount: 100,
      destinationAmount: 375,
      sourceBaseAmount: 100,
      destinationBaseAmount: 100,
      fxDifferenceBase: 0,
    });
  });

  it('supports transfers between two subsidiaries under the same holding', () => {
    expect(calculateIntercompanyTransfer({
      ...base,
      sourceOrganizationId: 'subsidiary-a',
      destinationOrganizationId: 'subsidiary-b',
      sourceParentOrganizationId: 'holding',
      destinationParentOrganizationId: 'holding',
    }).sourceAmount).toBe(1_000_000);
  });

  it('allows a payment on behalf without increasing the beneficiary bank account', () => {
    expect(calculateIntercompanyTransfer({ ...base, transactionType: 'ON_BEHALF', destinationAccountId: null }).destinationAmount).toBe(1_000_000);
  });

  it('rejects a branch-level movement submitted as intercompany', () => {
    expect(() => calculateIntercompanyTransfer({
      ...base,
      sourceOrganizationId: 'subsidiary',
      destinationOrganizationId: 'subsidiary',
      sourceParentOrganizationId: 'holding',
      destinationParentOrganizationId: 'holding',
    })).toThrow('INTERCOMPANY_ENTITIES_MUST_DIFFER');
  });

  it('rejects companies outside the selected holding and invalid amounts', () => {
    expect(() => calculateIntercompanyTransfer({ ...base, destinationParentOrganizationId: 'another-holding' }))
      .toThrow('INTERCOMPANY_ORGANIZATIONS_MUST_SHARE_HOLDING');
    expect(() => calculateIntercompanyTransfer({ ...base, amount: 0 }))
      .toThrow('TRANSFER_RATES_AND_AMOUNT_MUST_BE_POSITIVE');
  });
});
