import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_SETUP_STEPS,
  financialSetupProgress,
  isFinancialSetupMode,
  isSetupStep,
  isSkippedSetupStep,
  nextSetupStep,
  setupStorageKey,
} from './financial-setup-steps';

describe('organization financial setup journey', () => {
  it('has ten deterministic, unique steps including optional structure', () => {
    expect(FINANCIAL_SETUP_STEPS).toHaveLength(10);
    expect(new Set(FINANCIAL_SETUP_STEPS).size).toBe(10);
    expect(FINANCIAL_SETUP_STEPS.indexOf('chart')).toBeLessThan(FINANCIAL_SETUP_STEPS.indexOf('fiscal')); // Fiscal UI requires a postable retained-earnings child account.
  });

  it('skips opening entry only for a genuinely new institution', () => {
    expect(isSkippedSetupStep('opening', 'NEW')).toBe(true);
    expect(isSkippedSetupStep('opening', 'EXISTING')).toBe(false);
    expect(nextSetupStep('banking', 'NEW')).toBe('users');
    expect(nextSetupStep('banking', 'EXISTING')).toBe('opening');
  });

  it('does not falsely count incomplete financial steps as finished', () => {
    expect(financialSetupProgress(null, [])).toBe(0);
    expect(financialSetupProgress('NEW', ['organization'])).toBe(29);
    expect(financialSetupProgress('EXISTING', ['organization'])).toBe(14);
    expect(financialSetupProgress('EXISTING', [...FINANCIAL_SETUP_STEPS])).toBe(100);
    expect(financialSetupProgress('NEW', FINANCIAL_SETUP_STEPS.filter(step => step !== 'opening'))).toBe(100);
    expect(financialSetupProgress('EXISTING', FINANCIAL_SETUP_STEPS.filter(step => step !== 'opening'))).toBe(86);
  });

  it('validates stored modes and scopes progress to an organization', () => {
    expect(isFinancialSetupMode('EXISTING')).toBe(true);
    expect(isFinancialSetupMode('other')).toBe(false);
    expect(isSetupStep('chart')).toBe(true);
    expect(isSetupStep('unknown')).toBe(false);
    expect(setupStorageKey('organization-a')).not.toBe(setupStorageKey('organization-b'));
  });
});
