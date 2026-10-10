// Recalculation is a preview; payment always follows the frozen final liability.
export function paymentCycleAssessmentId(cycle:any):string|null {
  return cycle.final_assessment_id || null;
}
export function paymentCycleDue(cycle:any,assessmentDue:number|undefined):number {
  return Number(cycle.final_zakat_due ?? (cycle.final_assessment_id ? assessmentDue : 0) ?? 0);
}
