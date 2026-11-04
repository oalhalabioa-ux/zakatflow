import {describe,expect,it} from 'vitest';
import {financialPostingCoverage} from '../lib/financial-posting-coverage';
import type {RecognitionEvent} from '../lib/financial-event-ledger';

const source=(id:string,classificationId:string,cashDirection:'INFLOW'|'OUTFLOW'|'NON_CASH'='NON_CASH'):RecognitionEvent=>({
 id,organizationId:'fixture',currency:'SAR',date:'2026-01-02',eventType:'EXPENSE',sourceModule:'core',sourceKey:id,status:'ACTUAL',
 lines:[{id:id+'-line',classificationId,baseAmount:'100.0000',cashDirection,recognitionSign:1}],
});
const rule=(classificationId:string,cashDirection:'INFLOW'|'OUTFLOW'|'NON_CASH'='NON_CASH')=>({eventType:'EXPENSE',sourceModule:'core',classificationId,cashDirection,debitAccountId:'610001',creditAccountId:'2100'});

describe('financial source-to-chart posting coverage',()=>{
 it('counts every canonical voucher line exactly once, without creating financial amounts',()=>{
  const result=financialPostingCoverage([source('one','office'),source('two','office'),source('three','travel')],[rule('office')]);
  expect(result).toMatchObject({eventCount:3,lineCount:3,mappedLines:2,missingLines:1,ambiguousLines:0});
  expect(result.groups.find(g=>g.classificationId==='office')).toMatchObject({lineCount:2,matchingRules:1,status:'MAPPED'});
  expect(result.groups.find(g=>g.classificationId==='travel')).toMatchObject({lineCount:1,matchingRules:0,status:'MISSING'});
 });
 it('reports ambiguous mappings without silently selecting either ledger account',()=>{
  const result=financialPostingCoverage([source('one','office')],[rule('office'),rule('office')]);
  expect(result).toMatchObject({mappedLines:0,missingLines:0,ambiguousLines:1});
  expect(result.groups[0]).toMatchObject({status:'AMBIGUOUS',matchingRules:2});
 });
 it('requires an exact cash direction and source module',()=>{
  const result=financialPostingCoverage([source('one','office','OUTFLOW')],[rule('office','NON_CASH'),{...rule('office','OUTFLOW'),sourceModule:'vat'}]);
  expect(result).toMatchObject({mappedLines:0,missingLines:1});
 });
 it('does not count an unconfigured form row as a mapped posting',()=>{
  const result=financialPostingCoverage([source('one','office')],[{...rule('office'),creditAccountId:''}]);
  expect(result).toMatchObject({missingLines:1,mappedLines:0});
 });
 it('allows a new institution or empty fiscal year to prepare a policy safely',()=>{
  expect(financialPostingCoverage([],[])).toEqual({eventCount:0,emptyEvents:0,lineCount:0,mappedLines:0,missingLines:0,ambiguousLines:0,groups:[]});
 });
 it('flags a voucher with no accounting lines instead of certifying it as complete',()=>{
  const empty={...source('one','office'),lines:[]};
  expect(financialPostingCoverage([empty],[])).toMatchObject({eventCount:1,emptyEvents:1,lineCount:0});
 });
});
