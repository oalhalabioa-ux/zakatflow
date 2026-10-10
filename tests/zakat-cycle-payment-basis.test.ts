import {describe,it,expect} from 'vitest';
import {paymentCycleAssessmentId,paymentCycleDue} from '../lib/zakat-cycle-payment-basis';
describe('cycle payment basis',()=>{
 it('recalculation cannot replace a frozen final liability even with a legacy active status',()=>{
  const c={status:'ACTIVE',assessment_id:'latest',final_assessment_id:'original',final_zakat_due:45998.625};
  expect(paymentCycleAssessmentId(c)).toBe('original');
  expect(paymentCycleDue(c,67337.683)).toBe(45998.625);
 });
 it('closed cycle keeps its final assessment and frozen amount',()=>{
  const c={status:'CLOSED',assessment_id:'latest',final_assessment_id:'final',final_zakat_due:500};
  expect(paymentCycleAssessmentId(c)).toBe('final');expect(paymentCycleDue(c,600)).toBe(500);
 });
 it('unfinalized calculation is not a payable liability',()=>{
  const c={status:'ACTIVE',assessment_id:'preview'};
  expect(paymentCycleAssessmentId(c)).toBeNull();expect(paymentCycleDue(c,600)).toBe(0);
 });
 it('legacy final amount remains visible while missing final reference requires review',()=>{
  expect(paymentCycleDue({status:'OPEN',final_zakat_due:500},undefined)).toBe(500);
 });
});
