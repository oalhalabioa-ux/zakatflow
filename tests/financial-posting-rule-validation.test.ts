import {describe,it,expect} from 'vitest';
import {validatePostingRuleAccounts} from '../lib/financial-posting-rule-validation';
const chart=[{id:'1000',cash:true},{id:'1010',cash:true},{id:'6100',cash:false},{id:'2100',cash:false}];
const rule={eventType:'EXPENSE',sourceModule:'core',classificationId:'office:BASE',cashDirection:'NON_CASH' as const,debitAccountId:'6100',creditAccountId:'2100'};
describe('pre-save posting rule account controls',()=>{
 it('allows correctly directed non-cash and cash expense rules',()=>{
  expect(validatePostingRuleAccounts([rule],chart)).toBeNull();
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'OUTFLOW',creditAccountId:'1000',cashActivity:'OPERATING'}],chart)).toBeNull();
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'INFLOW',debitAccountId:'1000',cashActivity:'OPERATING'}],chart)).toBeNull();
 });
 it('rejects noncash mappings through bank accounts',()=>{
  expect(validatePostingRuleAccounts([{...rule,debitAccountId:'1000'}],chart)).toBe('REPORTING_POLICY_CASH_DIRECTION_INVALID');
 });
 it('requires a cash leg in the correct direction',()=>{
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'OUTFLOW',cashActivity:'OPERATING'}],chart)).toBe('REPORTING_POLICY_CASH_DIRECTION_INVALID');
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'INFLOW',creditAccountId:'1000',cashActivity:'OPERATING'}],chart)).toBe('REPORTING_POLICY_CASH_DIRECTION_INVALID');
 });
 it('requires cash-flow activity for a single bank leg',()=>{
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'OUTFLOW',creditAccountId:'1000'}],chart)).toBe('REPORTING_POLICY_CASH_ACTIVITY_REQUIRED');
 });
 it('allows a balanced bank-to-bank transfer without treating it as expense',()=>{
  expect(validatePostingRuleAccounts([{...rule,cashDirection:'OUTFLOW',debitAccountId:'1010',creditAccountId:'1000'}],chart)).toBeNull();
 });
 it('rejects unknown accounts and same noncash debit/credit',()=>{
  expect(validatePostingRuleAccounts([{...rule,debitAccountId:'9999'}],chart)).toBe('REPORTING_POLICY_ACCOUNT_INVALID');
  expect(validatePostingRuleAccounts([{...rule,creditAccountId:'6100'}],chart)).toBe('REPORTING_POLICY_ACCOUNT_INVALID');
 });
 it('prevents duplicate source-classification-cash-direction mappings',()=>{
  expect(validatePostingRuleAccounts([rule,rule],chart)).toBe('REPORTING_POLICY_DUPLICATE');
 });
});
