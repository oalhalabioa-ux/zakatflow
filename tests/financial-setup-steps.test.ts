import {describe,it,expect} from 'vitest';
import {nextSetupStep} from '../lib/financial-setup-steps';
describe('financial setup navigation follows actual opening-source evidence',()=>{
 it('new company skips opening only once independent zero-opening proof is READY',()=>{
  expect(nextSetupStep('banking','NEW',false)).toBe('users');
  expect(nextSetupStep('banking','NEW',true)).toBe('opening');
  expect(nextSetupStep('opening','NEW',true)).toBe('users');
 });
 it('existing companies always review opening balances',()=>{
  expect(nextSetupStep('banking','EXISTING')).toBe('opening');
 });
 it('preserves the approved chart-before-fiscal order',()=>{
  expect(nextSetupStep('organization','NEW')).toBe('regulatory');
  expect(nextSetupStep('regulatory','NEW')).toBe('structure');
  expect(nextSetupStep('structure','NEW')).toBe('chart');
  expect(nextSetupStep('chart','EXISTING')).toBe('fiscal');
  expect(nextSetupStep('fiscal','EXISTING')).toBe('posting');
 });
});
