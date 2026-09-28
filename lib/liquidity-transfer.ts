export type TransferInput = {
  sourceAccountId: string;
  destinationAccountId: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  amount: number;
  exchangeRate: number;
  sourceBaseRate: number;
  destinationBaseRate: number;
};

export type TransferAmounts = {
  sourceAmount: number;
  destinationAmount: number;
  sourceBaseAmount: number;
  destinationBaseAmount: number;
  fxDifferenceBase: number;
};

const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export function calculateLiquidityTransfer(input: TransferInput): TransferAmounts {
  if (!input.sourceAccountId || !input.destinationAccountId || input.sourceAccountId === input.destinationAccountId) {
    throw new Error('TRANSFER_ACCOUNTS_MUST_DIFFER');
  }
  if (input.sourceOrganizationId !== input.destinationOrganizationId) {
    throw new Error('TRANSFER_ACCOUNTS_MUST_SHARE_ORGANIZATION');
  }
  if (![input.amount, input.exchangeRate, input.sourceBaseRate, input.destinationBaseRate].every(Number.isFinite) ||
      input.amount <= 0 || input.exchangeRate <= 0 || input.sourceBaseRate <= 0 || input.destinationBaseRate <= 0) {
    throw new Error('TRANSFER_RATES_AND_AMOUNT_MUST_BE_POSITIVE');
  }
  const sourceAmount = round4(input.amount);
  const destinationAmount = round4(sourceAmount * input.exchangeRate);
  const sourceBaseAmount = round4(sourceAmount * input.sourceBaseRate);
  const destinationBaseAmount = round4(destinationAmount * input.destinationBaseRate);
  return { sourceAmount, destinationAmount, sourceBaseAmount, destinationBaseAmount, fxDifferenceBase: round4(destinationBaseAmount - sourceBaseAmount) };
}
