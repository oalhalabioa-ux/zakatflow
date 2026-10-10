import {describe,it,expect} from 'vitest';
import {paymentCycleAssessmentId,paymentCycleDue} from '../lib/zakat-cycle-payment-basis';
describe('cycle payment basis',()=>{
 it('open recalculation replaces stale legacy final amount',()=>{
  const c={status:'ACTIVE',assessment_id:'latest',final_assessment_id:'old',final_zakat_due:45998.625};
  expect(paymentCycleAssessmentId(c)).toBe('latest');
  expect(paymentCycleDue(c,67337.683)).toBe(67337.683);
 });
 it('closed cycle keeps its final assessment and frozen amount',()=>{
  const c={status:'CLOSED',assessment_id:'latest',final_assessment_id:'final',final_zakat_due:500};
  expect(paymentCycleAssessmentId(c)).toBe('final');
  expect(paymentCycleDue(c,600)).toBe(500);
 });
 it('open cycle without a payable assessment has no invented liability',()=>{
  expect(paymentCycleDue({status:'OPEN',final_zakat_due:500},undefined)).toBe(0);
 });
});
