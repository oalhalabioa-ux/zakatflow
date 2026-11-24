import {liquidityTiming,evaluateMonthlyLiquidity,type MonthlyLiquidity} from './monthly-liquidity';
import {allocatePartnerInstallments,type Partnership} from './partnership';
import {evaluateRawLand,type RawLand} from './raw-land';

export function evaluateLandPhasedLiquidity(land:RawLand,plan:MonthlyLiquidity,partnership?:Partnership){
 const annual=evaluateRawLand(land);
 if(annual.issue!==null||!annual.ready)return {issue:'annual-model'} as const;
 if(land.quantityDevelopment?.budget.enabled&&!annual.quantityReadiness?.ready){
  return {issue:'quantity-costs'} as const;
 }
 if(land.site.landPaymentMethod==='lease'&&land.site.annualLandRent===undefined){
  return {issue:'rent-assumption'} as const;
 }

 const useInstallments=plan.usePartnerInstallments===true;
 const funding=useInstallments?allocatePartnerInstallments(partnership,plan.startMonth,annual.annual.length*12):null;
 if(useInstallments&&(!funding||!partnership?.partners.some(partner=>partner.installments?.length))){
  return {issue:'installment-dates'} as const;
 }
 // The land facility services its own debt. The register records partner loan
 // receipts, but gives this model no separate schedule for servicing them.
 const hasPartnerLoans=partnership?.partners.some(partner=>
  partner.loanPaid>0||partner.installments?.some(row=>row.type==='LOAN'&&(row.amount>0||row.paid>0)));
 if(hasPartnerLoans)return {issue:'partner-loan-service'} as const;

 const cashAcquisition=land.site.landPaymentMethod==='cash'?annual.land:0;
 const beforeStartAcquisition=land.quantityDevelopment?.landTiming==='YEAR0'?cashAcquisition:0;
 const opening=plan.openingCash-beforeStartAcquisition;
 let closing=opening;
 let lowest=Math.min(0,Math.round(opening*100)/100);
 let peakMonth=lowest<0?0:null;
 let timingConflict=false;
 const years=annual.annual.map((year,index)=>{
  const offset=index*12;
  const hasPriorDebt=index>0&&annual.annual[index-1].closingDebt>.005;
  if(!hasPriorDebt&&year.draw>0){
   const drawMonth=(plan.timing.debtDraw??liquidityTiming.debtDraw).from;
   timingConflict||=([['principal',year.repayment],['interest',year.interest]] as const).some(
    ([key,value])=>value>0&&(plan.timing[key]??liquidityTiming[key]).from<drawMonth);
  }
  const scheduled=evaluateMonthlyLiquidity({
   collections:year.cashCollected,investment:index===0?-(cashAcquisition-beforeStartAcquisition):0,
   costs:-(year.cashCost-year.interest),workingCapital:0,debtDraw:year.draw,
   principal:-year.repayment,interest:-year.interest,yearEnd:-year.performanceFee,terminalPrincipal:0
  },{
   ...plan,openingCash:closing,cashEquity:index===0&&!useInstallments?plan.cashEquity:0,usePartnerInstallments:false
  });
  const rows=scheduled.rows.map(row=>{
   const datedEquity=funding?.rows[offset+row.month-1].equity??0;
   const equity=row.equity+datedEquity;
   const net=row.net+datedEquity;
   const opening=closing;
   closing+=net;
   const month=offset+row.month;
   const rounded=Math.round(closing*100)/100;
   if(rounded<lowest){
    lowest=rounded;
    peakMonth=month;
   }
   return {...row,month,opening,closing,equity,net};
  });
  return {year:year.year,rows,closing};
 });
 const lastYear=annual.annual[annual.annual.length-1];
 const excludedEquity=funding?funding.overdue+funding.undated+funding.futureActual+funding.undatedLegacy+funding.afterWindow:0;
 return {issue:null,years,beforeStartAcquisition,closing,peakMonth,fundingGap:Math.abs(lowest),excludedEquity,
  closingDebt:lastYear.closingDebt,timingConflict} as const;
}
