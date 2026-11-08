import {describe,it,expect} from 'vitest';
import {canDeferSetupStep,setupJourneyStepState,financialSetupJourneyCounts} from '../lib/financial-setup-journey-policy';
import type {FinancialSetupReadiness} from '../lib/financial-setup-readiness';
const ready:FinancialSetupReadiness={
 organizationId:'org',mode:'EXISTING',fiscalStart:'2026-01-01',
 ready:false,sourceChecked:true,certification:'NOT_CERTIFIED',
 statuses:{organization:'READY',regulatory:'NOT_STARTED',structure:'NOT_STARTED',chart:'IN_PROGRESS',fiscal:'IN_PROGRESS',
 posting:'IN_PROGRESS',banking:'IN_PROGRESS',opening:'IN_PROGRESS',users:'READY',
 review:'BLOCKED',finished:'BLOCKED'},
};
describe('setup journey deferred steps are never accounting approvals',()=>{
 it('allows deferral only if next work can be inspected independently',()=>{
  expect(canDeferSetupStep('organization','EXISTING',ready.statuses)).toBe(false);
  expect(canDeferSetupStep('chart','EXISTING',ready.statuses)).toBe(false);
  expect(canDeferSetupStep('fiscal','EXISTING',ready.statuses)).toBe(false);
  expect(canDeferSetupStep('posting','EXISTING',ready.statuses)).toBe(true);
  expect(canDeferSetupStep('banking','EXISTING',ready.statuses)).toBe(true);
  expect(canDeferSetupStep('opening','EXISTING',ready.statuses)).toBe(true);
  expect(canDeferSetupStep('structure','EXISTING',ready.statuses)).toBe(true);
  expect(canDeferSetupStep('regulatory','EXISTING',ready.statuses)).toBe(true);
  expect(canDeferSetupStep('review','EXISTING',ready.statuses)).toBe(false);
  expect(canDeferSetupStep('posting',null,ready.statuses)).toBe(false);
 });
 it('does not let a deferred flag overwrite real readiness or mark a missing source complete',()=>{
  expect(setupJourneyStepState('posting',ready,['posting'],[],ready.mode)).toBe('DEFERRED');
  expect(setupJourneyStepState('posting',ready,[],[],ready.mode)).toBe('INCOMPLETE');
  expect(setupJourneyStepState('posting',{...ready,statuses:{...ready.statuses,posting:'READY'}},['posting'],[],ready.mode)).toBe('COMPLETE');
  expect(setupJourneyStepState('structure',ready,[],[],ready.mode)).toBe('OPTIONAL');
  expect(setupJourneyStepState('regulatory',ready,[],['regulatory'],ready.mode)).toBe('REVIEWED');
  expect(setupJourneyStepState('regulatory',ready,['regulatory'],[],ready.mode)).toBe('DEFERRED');
 });
 it('keeps unfinished or deferred work out of real readiness percentage',()=>{
  expect(financialSetupJourneyCounts(ready,['posting','banking'])).toEqual({total:7,complete:2,remaining:5,deferred:2,percent:29});
 });
 it('does not permit finishing from a deferred or missing prerequisite',()=>{
  expect(canDeferSetupStep('finished','EXISTING',ready.statuses)).toBe(false);
  expect(canDeferSetupStep('posting','EXISTING',{...ready.statuses,organization:'BLOCKED'})).toBe(false);
 });
});
