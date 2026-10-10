export function paymentCycleAssessmentId(cycle:any):string|null {
  return (['OPEN','ACTIVE'].includes(cycle.status)?cycle.assessment_id:cycle.final_assessment_id||cycle.assessment_id)||null;
}
export function paymentCycleDue(cycle:any,assessmentDue:number|undefined):number {
  // An open cycle may contain a legacy final amount from a previous calculation.
  // Its payable basis follows the current saved assessment; closed amounts stay frozen.
  if(['OPEN','ACTIVE'].includes(cycle.status))return Number(assessmentDue??0);
  return Number(cycle.final_zakat_due??assessmentDue??0);
}
