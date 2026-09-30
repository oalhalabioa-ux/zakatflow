export type IntercompanyTransferInput = {
  holdingOrganizationId: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  sourceAccountId: string;
  destinationAccountId: string | null;
  transactionType: 'LOAN' | 'CAPITAL' | 'ON_BEHALF';
  sourceParentOrganizationId: string | null;
  destinationParentOrganizationId: string | null;
  amount: number;
  exchangeRate: number;
  sourceBaseRate: number;
  destinationBaseRate: number;
};

export type IntercompanyTransferAmounts = {
  sourceAmount: number;
  destinationAmount: number;
  sourceBaseAmount: number;
  destinationBaseAmount: number;
  fxDifferenceBase: number;
};

const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export function calculateIntercompanyTransfer(input: IntercompanyTransferInput): IntercompanyTransferAmounts {
  const sourceIsInGroup = input.sourceOrganizationId === input.holdingOrganizationId || input.sourceParentOrganizationId === input.holdingOrganizationId;
  const destinationIsInGroup = input.destinationOrganizationId === input.holdingOrganizationId || input.destinationParentOrganizationId === input.holdingOrganizationId;
  if (!input.holdingOrganizationId || !sourceIsInGroup || !destinationIsInGroup) {
    throw new Error('INTERCOMPANY_ORGANIZATIONS_MUST_SHARE_HOLDING');
  }
  if (!input.sourceAccountId || (input.transactionType !== 'ON_BEHALF' && !input.destinationAccountId) || input.sourceAccountId === input.destinationAccountId) {
    throw new Error('TRANSFER_ACCOUNTS_MUST_DIFFER');
  }
  if (input.sourceOrganizationId === input.destinationOrganizationId) {
    throw new Error('INTERCOMPANY_ENTITIES_MUST_DIFFER');
  }
  if (![input.amount, input.exchangeRate, input.sourceBaseRate, input.destinationBaseRate].every(Number.isFinite) ||
      input.amount <= 0 || input.exchangeRate <= 0 || input.sourceBaseRate <= 0 || input.destinationBaseRate <= 0) {
    throw new Error('TRANSFER_RATES_AND_AMOUNT_MUST_BE_POSITIVE');
  }
  const sourceAmount = round4(input.amount);
  const destinationAmount = round4(sourceAmount * input.exchangeRate);
  const sourceBaseAmount = round4(sourceAmount * input.sourceBaseRate);
  const destinationBaseAmount = round4(destinationAmount * input.destinationBaseRate);
  return {
    sourceAmount,
    destinationAmount,
    sourceBaseAmount,
    destinationBaseAmount,
    fxDifferenceBase: round4(destinationBaseAmount - sourceBaseAmount),
  };
}
