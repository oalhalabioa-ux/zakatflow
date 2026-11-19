import {describe,it,expect} from 'vitest';
import {compileBranchReport} from '../lib/financial-branch-report';
import {normalizeStatementSource,statementSourceExport} from '../lib/financial-statement-source';
import {matchesStatementRequest} from '../lib/financial-statement-request';
import {validStatementComparison} from '../lib/financial-statement-comparison';
import {branchFixture} from './financial-reporting/branch-report-fixture';
const branch='20000000-0000-4000-8000-000000000002';
const query=(p:ReturnType<typeof branchFixture>)=>({organization:p.source.organizationId,from:p.source.from,to:p.source.to});
describe('branch report source through report and export',()=>{
 it('produces different, reconciled headquarters and inactive-branch reports from the same live company',()=>{
  const p=branchFixture(),q=query(p),before=JSON.stringify(p);
  const company=normalizeStatementSource(p.source,q),a=compileBranchReport(p,q,branch),hq=compileBranchReport(p,q,null);
  expect(a).toMatchObject({scope:'BRANCH',branchId:branch,statements:{cash:{opening:'300.0000',closing:'185.0000'},income:{revenue:'0.0000',netProfit:'-107.5000'}}});
  expect(hq).toMatchObject({scope:'ORGANIZATION_DIRECT',branchId:null,statements:{cash:{opening:'200.0000',closing:'200.0000'},income:{revenue:'50.0000',netProfit:'50.0000'}}});
  expect(Number(a.statements.position.assets)+Number(hq.statements.position.assets)).toBe(Number(company.statements.position.assets));
  expect(Number(a.statements.income.netProfit)+Number(hq.statements.income.netProfit)).toBe(Number(company.statements.income.netProfit));
  expect(statementSourceExport(a,'position',true)).toContainEqual(['Branch',branch]);
  expect(matchesStatementRequest(a,{...q,currency:'SAR',origin:a.origin,branch})).toBe(true);
  expect(matchesStatementRequest(a,{...q,currency:'SAR',origin:a.origin})).toBe(false);
  expect(matchesStatementRequest(hq,{...q,currency:'SAR',origin:a.origin,branch})).toBe(false);
  expect(JSON.stringify(p)).toBe(before);
 });
 it('refuses incomplete attribution, foreign branches and stale opening approval',()=>{
  const p=branchFixture(),q=query(p);
  expect(()=>compileBranchReport(p,q,'foreign')).toThrow('REPORTING_BRANCH_ACCESS_DENIED');
  p.journalEvidence.links.pop();
  expect(()=>compileBranchReport(p,q,branch)).toThrow('REPORTING_BRANCH_RECONCILIATION_REQUIRED');
  const stale=branchFixture();stale.workspace.version++;
  expect(()=>compileBranchReport(stale,q,branch)).toThrow('REPORTING_BRANCH_OPENING_INVALID');
 });
 it('rejects mismatched branch comparisons even when organization and periods match',()=>{
  const p=branchFixture(),a=compileBranchReport(p,query(p),branch),prior=structuredClone(a);
  Object.assign(prior.statements,{from:'2025-01-01',to:'2025-12-31'});
  expect(validStatementComparison(a,prior)).toBe(prior);
  prior.branchId='another-branch';expect(validStatementComparison(a,prior)).toBeNull();
 });
});
