import Decimal from 'decimal.js';
/** Only each cycle's referenced snapshot participates; historical revisions are excluded. */
export function zakatLiabilitySummary(cycles:any[],assessments:any[],allocations:any[],payments:any[]){
 const n=(v:any)=>new Decimal(v??0),byId=new Map(assessments.map(a=>[a.id,a]));
 let finalDue=n(0),finalPaid=n(0),finalRemaining=n(0),openEstimate=n(0);
 for(const c of cycles){
  if(c.snapshot?.historical_settled)continue;
  if(c.final_assessment_id){
   const due=n(c.final_zakat_due??byId.get(c.final_assessment_id)?.zakat_due??0);
   const paid=allocations.filter(a=>a.hawl_cycle_id===c.id&&a.assessment_id===c.final_assessment_id).reduce((s,a)=>s.add(n(a.allocated_amount)),n(0));
   finalDue=finalDue.add(due);finalPaid=finalPaid.add(paid);finalRemaining=finalRemaining.add(Decimal.max(0,due.sub(paid)));
  }else if(['OPEN','ACTIVE'].includes(c.status)){
   const a=byId.get(c.assessment_id);
   if(a&&!a.superseded_by&&!['DRAFT','CANCELLED'].includes(a.status))openEstimate=openEstimate.add(n(a.zakat_due));
  }
 }
 const allPaid=payments.reduce((s,p)=>s.add(n(p.base_amount)),n(0));
 const allAllocated=allocations.reduce((s,a)=>s.add(n(a.allocated_amount)),n(0));
 const credit=Decimal.max(0,allPaid.sub(allAllocated)),asOf=finalRemaining.add(openEstimate);
 return {finalDue,finalPaid,finalRemaining,openEstimate,credit,asOf,afterCredit:Decimal.max(0,asOf.sub(credit)),paymentPercent:finalDue.gt(0)?Decimal.min(100,finalPaid.div(finalDue).mul(100)):n(0)};
}
