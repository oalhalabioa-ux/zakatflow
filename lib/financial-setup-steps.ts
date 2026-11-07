export type FinancialSetupMode = 'NEW' | 'EXISTING';

export type FinancialSetupStep =
  | 'organization'
  | 'fiscal'
  | 'chart'
  | 'posting'
  | 'banking'
  | 'opening'
  | 'users'
  | 'review'
  | 'finished';

export const FINANCIAL_SETUP_STEPS: readonly FinancialSetupStep[] = [
  'organization', 'chart', 'fiscal', 'posting', 'banking',
  'opening', 'users', 'review', 'finished',
] as const;

export const FINANCIAL_SETUP_STORAGE_VERSION = 1;

export function isFinancialSetupMode(value: unknown): value is FinancialSetupMode {
  return value === 'NEW' || value === 'EXISTING';
}

export function isSetupStep(value: unknown): value is FinancialSetupStep {
  return typeof value === 'string' && FINANCIAL_SETUP_STEPS.some(step => step === value);
}

export function isSkippedSetupStep(step: FinancialSetupStep, mode: FinancialSetupMode | null) {
  return step === 'opening' && mode === 'NEW';
}

export function nextSetupStep(step: FinancialSetupStep, mode: FinancialSetupMode | null): FinancialSetupStep {
  const index = FINANCIAL_SETUP_STEPS.indexOf(step);
  return FINANCIAL_SETUP_STEPS.slice(index + 1).find(candidate => !isSkippedSetupStep(candidate, mode)) ?? 'finished';
}

export function financialSetupProgress(mode: FinancialSetupMode | null, completed: readonly FinancialSetupStep[]) {
  const completedSet = new Set(completed);
  const count = FINANCIAL_SETUP_STEPS.filter(step => completedSet.has(step) || isSkippedSetupStep(step, mode)).length;
  return Math.round((count / FINANCIAL_SETUP_STEPS.length) * 100);
}

export function setupStorageKey(organizationId: string) {
  return `yaqeen:financial-setup:v${FINANCIAL_SETUP_STORAGE_VERSION}:${organizationId}`;
}
