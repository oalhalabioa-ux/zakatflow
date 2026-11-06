import {describe,expect,it} from 'vitest';
import {rollupAuthorizedTrialBalances,type AuthorizedTrialBalance,type RollupInput} from '../lib/financial-group-rollup';

const first='10000000-0000-4000-8000-000000000001';
const second='10000000-0000-4000-8000-000000000002';
const request=():RollupInput&{members:AuthorizedTrialBalance[];expectedOrganizationIds:string[]}=>({
 expectedOrganizationIds:[first,second],from:'2026-01-01',to:'2026-12-31',currency:'SAR',
 parents:[{code:'1000',kind:'ASSET'},{code:'3100',kind:'EQUITY'},{code:'4000',kind:'REVENUE'}],
 members:[
  {organizationId:first,from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
   {accountId:'first-bank',code:'100001',reportingCode:'1000',kind:'ASSET',debit:'100.0000',credit:'0'},
   {accountId:'first-capital',code:'310001',reportingCode:'3100',kind:'EQUITY',debit:'0',credit:'100.0000'},
  ]},
  {organizationId:second,from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
   {accountId:'second-bank',code:'100002',reportingCode:'1000',kind:'ASSET',debit:'200.0000',credit:'0'},
   {accountId:'second-capital',code:'310002',reportingCode:'3100',kind:'EQUITY',debit:'0',credit:'200.0000'},
  ]},
 ],
});

describe('group trial-balance staging (unadjusted, non-statutory)',()=>{
 it('aggregates only validated 4-digit parents, retaining exact member drilldown',()=>{
  const report=rollupAuthorizedTrialBalances(request());
  expect(report.status).toBe('PRE_ELIMINATION_ONLY');
  expect(report).toMatchObject({totalDebit:'300.0000',totalCredit:'300.0000',currency:'SAR'});
  expect(report.byParent.find(p=>p.code==='1000')).toMatchObject({debit:'300.0000',netDebit:'300.0000',members:[
   {organizationId:first,debit:'100.0000'},{organizationId:second,debit:'200.0000'},
  ]});
  expect(report.byParent.find(p=>p.code==='3100')?.netDebit).toBe('-300.0000');
 });

 it('does not duplicate a member or accept incomplete member sets',()=>{
  const duplicate=request();duplicate.members[1]=duplicate.members[0];
  expect(()=>rollupAuthorizedTrialBalances(duplicate)).toThrow('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
  const missing=request();missing.members.pop();
  expect(()=>rollupAuthorizedTrialBalances(missing)).toThrow('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
  const unexpected=request();unexpected.expectedOrganizationIds=[first,'10000000-0000-4000-8000-000000000009'];
  expect(()=>rollupAuthorizedTrialBalances(unexpected)).toThrow('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
 });

 it('refuses foreign currencies and incompatible cutoffs, with no fabricated FX',()=>{
  const fx=request();fx.members[1].currency='USD';
  expect(()=>rollupAuthorizedTrialBalances(fx)).toThrow('REPORTING_ROLLUP_CURRENCY_MISMATCH');
  const dates=request();dates.members[1].from='2026-07-01';
  expect(()=>rollupAuthorizedTrialBalances(dates)).toThrow('REPORTING_ROLLUP_PERIOD_MISMATCH');
  const invalid=request();invalid.to='2026-02-30';
  expect(()=>rollupAuthorizedTrialBalances(invalid)).toThrow('REPORTING_ROLLUP_PERIOD_INVALID');
 });

 it('rejects missing, changed and cross-category child-account mappings',()=>{
  const missing=request();missing.members[0].details[0].reportingCode='1999';
  expect(()=>rollupAuthorizedTrialBalances(missing)).toThrow('REPORTING_ROLLUP_MAPPING_INVALID');
  const wrongPrefix=request();wrongPrefix.members[0].details[0].code='200001';
  expect(()=>rollupAuthorizedTrialBalances(wrongPrefix)).toThrow('REPORTING_ROLLUP_MAPPING_INVALID');
  const wrongKind=request();wrongKind.members[0].details[0].kind='LIABILITY';
  expect(()=>rollupAuthorizedTrialBalances(wrongKind)).toThrow('REPORTING_ROLLUP_MAPPING_INVALID');
 });

 it('does not silently accept an unbalanced or duplicated source account',()=>{
  const unbalanced=request();unbalanced.members[0].details[0].debit='99.9999';
  expect(()=>rollupAuthorizedTrialBalances(unbalanced)).toThrow('REPORTING_ROLLUP_UNBALANCED_MEMBER');
  const duplicate=request();duplicate.members[0].details.push({...duplicate.members[0].details[0],accountId:'other'});
  expect(()=>rollupAuthorizedTrialBalances(duplicate)).toThrow('REPORTING_ROLLUP_ACCOUNT_DUPLICATE');
  const doubleSided=request();doubleSided.members[1].details[0].credit='1';
  expect(()=>rollupAuthorizedTrialBalances(doubleSided)).toThrow('REPORTING_ROLLUP_AMOUNT_INVALID');
 });

 it('supports a new company with zero opening transactions without an invented entry',()=>{
  const empty=request();empty.members[1].details=[];
  const r=rollupAuthorizedTrialBalances(empty);
  expect(r.totalDebit).toBe('100.0000');
  expect(r.byParent.find(p=>p.code==='1000')?.members[1].netDebit).toBe('0.0000');
 });
});
