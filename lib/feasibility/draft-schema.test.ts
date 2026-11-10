import {describe,expect,it} from 'vitest';
import {createStudy} from './engine';
import {cloudDraftWrite} from './draft-schema';
const id='6357a708-bae2-4634-9296-490404b1d8a4';
describe('feasibility QA cloud draft input',()=>{
 it('accepts a normal zero-input draft with an authenticated UUID',()=>{
  const study=createStudy(id,'Water factory');
  expect(cloudDraftWrite.safeParse({study}).success).toBe(true);
 });
 it('rejects non-uuid ID, non-finite cost and invalid reviewer fields',()=>{
  const study=createStudy(id,'Factory');
  expect(cloudDraftWrite.safeParse({study:{...study,id:'invalid'}}).success).toBe(false);
  expect(cloudDraftWrite.safeParse({study:{...study,owner_user_id:'forged'}}).success).toBe(false);
  expect(cloudDraftWrite.safeParse({study:{...study,landValue:Infinity}}).success).toBe(false);
  expect(cloudDraftWrite.safeParse({study:{...study,handoff:{mode:'EXISTING',organizationId:'forged'}}}).success).toBe(false);
 });
 it('requires an optimistic concurrency revision when patching (enforced by the route)',()=>{
  const study=createStudy(id,'Factory');
  expect(cloudDraftWrite.safeParse({study,revision:4}).success).toBe(true);
  expect(cloudDraftWrite.safeParse({study,revision:0}).success).toBe(false);
 });
});

describe('advanced study cash-cycle serialization',()=>{
 it('continues to accept prior drafts with no optional capital policy',()=>{
  const s=createStudy('6357a708-bae2-4634-9296-490404b1d8a4','Old study');
  expect(cloudDraftWrite.safeParse({study:s}).success).toBe(true);
 });
 it('accepts an explicit valid operating cycle but rejects out-of-range days',()=>{
  const s=createStudy('6357a708-bae2-4634-9296-490404b1d8a4','New study');
  s.advanced={mode:'DIRECT',capacityMonthly:0,utilisationPct:0,saleablePct:100,
   lives:{BUILDINGS:0,EQUIPMENT:0,UTILITIES:0,LICENCES:0,OTHER:0},
   debtRatePct:0,debtYears:0,terminalCash:0,contingencyPct:10,
   workingCapitalPolicy:{mode:'DAYS',receivableDays:30,inventoryDays:40,payableDays:20}};
  expect(cloudDraftWrite.safeParse({study:s}).success).toBe(true);
  s.advanced.workingCapitalPolicy!.receivableDays=500;
  expect(cloudDraftWrite.safeParse({study:s}).success).toBe(false);
 });
});
