export type FinancialSetupMode = 'NEW' | 'EXISTING';

export type FinancialSetupStep =
  | 'organization'
  | 'structure'
  | 'fiscal'
  | 'chart'
  | 'posting'
  | 'banking'
  | 'opening'
  | 'users'
  | 'review'
  | 'finished';

export const FINANCIAL_SETUP_STEPS: readonly FinancialSetupStep[] = [
  'organization', 'structure', 'chart', 'fiscal', 'posting', 'banking',
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

export function nextSetupStep(step: FinancialSetupStep, mode: FinancialSetupMode | null, requireOpeningReview=false): FinancialSetupStep {
  const index = FINANCIAL_SETUP_STEPS.indexOf(step);
  return FINANCIAL_SETUP_STEPS.slice(index + 1).find(candidate =>
    !isSkippedSetupStep(candidate, mode) || candidate==='opening'&&requireOpeningReview) ?? 'finished';
}

export function financialSetupProgress(mode: FinancialSetupMode | null, completed: readonly FinancialSetupStep[]) {
  const completedSet = new Set(completed);
  // Organizational structure is an optional review, not part of the accounting source certificate.
  const required=FINANCIAL_SETUP_STEPS.filter(step=>step!=='structure'&&step!=='finished'&&step!=='review');
  const count=required.filter(step=>completedSet.has(step)||isSkippedSetupStep(step,mode)).length;
  return Math.round((count / required.length) * 100);
}

export function setupStorageKey(organizationId: string) {
  return `yaqeen:financial-setup:v${FINANCIAL_SETUP_STORAGE_VERSION}:${organizationId}`;
}
