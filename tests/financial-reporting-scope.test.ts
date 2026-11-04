import {describe,it,expect} from 'vitest';
import {currentWorkspaceScope,isFinancialReportingPage,workspaceScopeHref} from '../lib/topbar-navigation';

describe('institutional financial chart navigation',()=>{
 it('resolves chart of accounts to the organization regardless of remembered personal scope',()=>{
  expect(isFinancialReportingPage('chart-of-accounts')).toBe(true);
  expect(currentWorkspaceScope('chart-of-accounts','','PERSONAL')).toBe('ORGANIZATION');
  expect(currentWorkspaceScope('chart-of-accounts','?scope=PERSONAL','PERSONAL')).toBe('ORGANIZATION');
 });
 it('returns to the personal dashboard when leaving an organization-only financial page',()=>{
  expect(workspaceScopeHref('ar','chart-of-accounts','','PERSONAL')).toBe('/ar/dashboard?scope=PERSONAL');
  expect(workspaceScopeHref('en','chart-of-accounts','','ORGANIZATION')).toBe('/en/chart-of-accounts?scope=ORGANIZATION');
 });
 it('does not force unrelated personal asset pages into the institution',()=>{
  expect(currentWorkspaceScope('assets','?scope=PERSONAL','ORGANIZATION')).toBe('PERSONAL');
 });
});
