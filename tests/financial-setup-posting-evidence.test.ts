import {describe,it,expect} from 'vitest';
import {evaluatePostingPolicy} from '../lib/financial-setup-posting-evidence';
import type {RecognitionEvent} from '../lib/financial-event-ledger';

const event:RecognitionEvent={
 id:'event-1',organizationId:'company',currency:'SAR',date:'2026-01-15',
 eventType:'EXPENSE',sourceModule:'core',sourceKey:'event-1',
 status:'ACTUAL',lines:[{id:'line-1',classificationId:'office:BASE',
 baseAmount:'200',cashDirection:'NON_CASH',recognitionSign:1}],
};
const rule={eventType:'EXPENSE',sourceModule:'core',classificationId:'office:BASE',
 cashDirection:'NON_CASH',debitAccountId:'6100',creditAccountId:'2100'};
describe('posting policy evidence used by setup readiness',()=>{
 it('never considers an approved zero-rule policy a configured posting matrix',()=>{
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[]},[])).toMatchObject({
   approvalStatus:'APPROVED',ruleCount:0,configured:false,
  });
 });
 it('does not confuse a draft rule with approved posting',()=>{
  expect(evaluatePostingPolicy({status:'DRAFT',rules:[rule]},[event]).configured).toBe(false);
 });
 it('requires exact source classification and cash direction coverage',()=>{
  const result=evaluatePostingPolicy({status:'APPROVED',rules:[rule]},[event]);
  expect(result).toMatchObject({configured:true,sourceLines:1,mappedLines:1,missingLines:0,ruleCount:1});
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[{...rule,cashDirection:'OUTFLOW'}]},[event]))
   .toMatchObject({configured:false,missingLines:1});
 });
 it('blocks a later event that the approved policy does not cover',()=>{
  const event2={...event,id:'event-2',sourceKey:'event-2',lines:[{...event.lines[0],id:'line-2',classificationId:'utilities:BASE'}]};
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[rule]},[event,event2]))
    .toMatchObject({configured:false,sourceLines:2,mappedLines:1,missingLines:1});
 });
 it('rejects duplicate matching rules and empty source-event details',()=>{
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[rule,rule]},[event]).configured).toBe(false);
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[rule]},[{...event,lines:[]}]))
   .toMatchObject({configured:false,emptyEvents:1});
 });
 it('fails closed if source events are unavailable or untrusted rules are malformed',()=>{
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[rule]},null).configured).toBe(false);
  expect(evaluatePostingPolicy({status:'APPROVED',rules:[{...rule,debitAccountId:''}]},[event]).configured).toBe(false);
  expect(evaluatePostingPolicy(null,[event]).configured).toBe(false);
 });
 it('accepts explicitly configured future signatures but does not claim source transactions exist',()=>{
  const result=evaluatePostingPolicy({status:'APPROVED',rules:[rule]},[]);
  expect(result).toMatchObject({configured:true,sourceLines:0,mappedLines:0,ruleCount:1});
 });
});
