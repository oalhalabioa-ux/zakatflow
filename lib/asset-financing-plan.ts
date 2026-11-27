import Decimal from "decimal.js";

export type AssetFundingMode = "CASH" | "DEFERRED" | "INSTALLMENTS" | "EXTERNAL" | "MIXED";
export type InstallmentFrequency = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL" | "CUSTOM";
export type InstallmentDraft = { dueDate: string; principal: string; financeCost: string };
export type FinancingDraft = {
  invoiceTotal: string;
  currency: string;
  purchaseDate: string;
  downPayment: string;
  financeCost: string;
};

const Money = Decimal.clone({ precision: 40 });
const monthInterval = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
export const maxAssetInstallments = 48;

export function fundingModeCanUseExistingPurchase(
  scope: "PERSONAL" | "ORGANIZATION",
  mode: AssetFundingMode,
): boolean {
  return scope === "PERSONAL" ? mode === "CASH" : mode === "DEFERRED";
}

export function assetMoneyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function amount(value: string, digits: number): Decimal {
  if (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 30) throw Error("ASSET_FINANCING_AMOUNT_INVALID");
  const parsed = new Money(value);
  if (parsed.decimalPlaces() > digits) throw Error("ASSET_FINANCING_AMOUNT_PRECISION");
  return parsed;
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(date + "T00:00:00Z");
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === date;
}

function financedAmounts(input: FinancingDraft) {
  const digits = assetMoneyDigits(input.currency);
  const invoice = amount(input.invoiceTotal, digits);
  const down = amount(input.downPayment || "0", digits);
  const fees = amount(input.financeCost || "0", digits);
  if (!invoice.gt(0) || down.gte(invoice)) throw Error("ASSET_FINANCING_DOWN_PAYMENT_INVALID");
  if (!validDate(input.purchaseDate)) throw Error("ASSET_FINANCING_DATE_INVALID");
  return { digits, invoice, down, fees, balance: invoice.minus(down) };
}

function dueDateAtMonth(date: string, months: number): string {
  const monthStart = new Date(date.slice(0, 8) + "01T00:00:00Z");
  monthStart.setUTCMonth(monthStart.getUTCMonth() + months);
  const endOfMonth = new Date(monthStart);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  monthStart.setUTCDate(Math.min(Number(date.slice(8)), endOfMonth.getUTCDate()));
  const result = monthStart.toISOString().slice(0, 10);
  if (!validDate(result)) throw Error("ASSET_FINANCING_DATE_INVALID");
  return result;
}

export function generateAssetInstallments(
  input: FinancingDraft,
  count: number,
  frequency: InstallmentFrequency,
  firstDue: string,
): InstallmentDraft[] {
  const { digits, balance, fees } = financedAmounts(input);
  if (!Number.isInteger(count) || count < 1 || count > maxAssetInstallments) throw Error("ASSET_FINANCING_COUNT_INVALID");
  if (!validDate(firstDue) || firstDue < input.purchaseDate) throw Error("ASSET_FINANCING_DATE_INVALID");
  const principal = balance.div(count).toDecimalPlaces(digits, Decimal.ROUND_DOWN);
  const financeCost = fees.div(count).toDecimalPlaces(digits, Decimal.ROUND_DOWN);
  if (principal.isZero()) throw Error("ASSET_FINANCING_COUNT_INVALID");
  return Array.from({ length: count }, (_, index) => ({
    dueDate: frequency === "CUSTOM" ? (index === 0 ? firstDue : "") : dueDateAtMonth(firstDue, monthInterval[frequency] * index),
    principal: (index === count - 1 ? balance.minus(principal.times(index)) : principal).toFixed(digits),
    financeCost: (index === count - 1 ? fees.minus(financeCost.times(index)) : financeCost).toFixed(digits),
  }));
}

export function validateAssetInstallments(input: FinancingDraft, rows: InstallmentDraft[]) {
  const { digits, invoice, down, fees, balance } = financedAmounts(input);
  if (!rows.length || rows.length > maxAssetInstallments) throw Error("ASSET_FINANCING_COUNT_INVALID");
  let remainingPrincipal = balance;
  let remainingFees = fees;
  let previousDue = input.purchaseDate;
  for (const row of rows) {
    if (!validDate(row.dueDate) || row.dueDate < previousDue) throw Error("ASSET_FINANCING_DATE_INVALID");
    const principal = amount(row.principal, digits);
    const charge = amount(row.financeCost || "0", digits);
    if (principal.plus(charge).isZero() || principal.gt(remainingPrincipal) || charge.gt(remainingFees))
      throw Error("ASSET_FINANCING_SCHEDULE_TOTAL");
    remainingPrincipal = remainingPrincipal.minus(principal);
    remainingFees = remainingFees.minus(charge);
    previousDue = row.dueDate;
  }
  if (!remainingPrincipal.isZero() || !remainingFees.isZero()) throw Error("ASSET_FINANCING_SCHEDULE_TOTAL");
  return {
    payableNow: down.toFixed(digits),
    remainingPrincipal: balance.toFixed(digits),
    futureTotal: balance.plus(fees).toFixed(digits),
    paidPercent: down.div(invoice).times(100).toDecimalPlaces(2).toNumber(),
  };
}
