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
  it('has eleven deterministic steps including legal and tax review', () => {
    expect(FINANCIAL_SETUP_STEPS).toHaveLength(11);
    expect(new Set(FINANCIAL_SETUP_STEPS).size).toBe(11);
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


import {financialSourceChecks,type FinancialSourceCheckInputs} from './financial-setup-readiness';

const fullSource:FinancialSourceCheckInputs={
 fiscalReadable:true,fiscalCalendarPresent:true,fiscalPeriodPresent:true,fiscalRetainedValid:true,
 chartReadable:true,chartEquityActive:true,
 postingReadable:true,postingApproved:true,postingRulesPresent:true,
 postingCoverageReadable:true,postingCoverageComplete:true,
 bankingReadable:true,bankingAccountPresent:true,
};

describe('source-backed financial readiness card details',()=>{
 it('only marks recorded evidence as complete, with real criteria for each card',()=>{
  const checks=financialSourceChecks(fullSource);
  expect(checks.fiscal).toHaveLength(3);
  expect(checks.chart).toHaveLength(2);
  expect(checks.posting).toHaveLength(3);
  expect(checks.banking).toHaveLength(2);
  expect(Object.values(checks).flat().every(c=>c.status==='MET')).toBe(true);
 });
 it('distinguishes unreadable data from an incomplete source-backed requirement',()=>{
  const checks=financialSourceChecks({...fullSource,
   fiscalReadable:false,fiscalCalendarPresent:false,
   chartReadable:false,bankingReadable:false,postingReadable:false,
   postingCoverageReadable:false,
  });
  expect(checks.fiscal.map(c=>c.status)).toEqual(['UNAVAILABLE','UNAVAILABLE','UNAVAILABLE']);
  expect(checks.chart.map(c=>c.status)).toEqual(['UNAVAILABLE','UNAVAILABLE']);
  expect(checks.banking.map(c=>c.status)).toEqual(['UNAVAILABLE','UNAVAILABLE']);
  expect(checks.posting.map(c=>c.status)).toEqual(['UNAVAILABLE','UNAVAILABLE','UNAVAILABLE']);
 });
 it('keeps independently valid retained earnings distinct from an unset fiscal period',()=>{
  const checks=financialSourceChecks({...fullSource,fiscalPeriodPresent:false});
  expect(checks.fiscal.map(c=>c.status)).toEqual(['MET','MISSING','MET']);
 });
 it('does not declare coverage or active liquidity complete from approval alone',()=>{
  const checks=financialSourceChecks({...fullSource,
   postingRulesPresent:false,postingCoverageReadable:false,postingCoverageComplete:false,
   bankingAccountPresent:false,chartEquityActive:false,
  });
  expect(checks.posting.map(c=>c.status)).toEqual(['MET','MISSING','UNAVAILABLE']);
  expect(checks.banking[1].status).toBe('MISSING');
  expect(checks.chart[1].status).toBe('MISSING');
 });
});
