import {z} from 'zod';
import type {FeasibilityStudy} from './engine';
import {evaluateRawLand} from './raw-land';
import {evaluateWater} from './water-model';

const month=z.number().int().min(1).max(12);
const timing=z.object({from:month,to:month}).strict().refine(value=>value.from<=value.to);
export const monthlyLiquiditySchema=z.object({
 startMonth:z.string().regex(/^(?:19\d{2}|20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])$/).optional(),
 openingCash:z.number().finite().min(0).max(1e12),
 cashEquity:z.number().finite().min(0).max(1e12),
 timing:z.object({
  collections:timing.optional(),investment:timing.optional(),costs:timing.optional(),
  workingCapital:timing.optional(),debtDraw:timing.optional(),principal:timing.optional(),
  interest:timing.optional(),equity:timing.optional()
 }).strict()
}).strict();

export type MonthlyLiquidity=z.infer<typeof monthlyLiquiditySchema>;
type Stream=keyof MonthlyLiquidity['timing'];
type MonthlyAmounts=Record<Exclude<Stream,'equity'>,number>&{yearEnd:number;terminalPrincipal:number};
export const liquidityTiming={
 collections:{from:1,to:12},investment:{from:1,to:1},costs:{from:1,to:12},
 workingCapital:{from:1,to:12},debtDraw:{from:1,to:1},principal:{from:1,to:12},
 interest:{from:1,to:12},equity:{from:1,to:1}
} satisfies Record<Stream,{from:number;to:number}>;

const streams=Object.keys(liquidityTiming) as Stream[];
export const defaultMonthlyLiquidity:MonthlyLiquidity={openingCash:0,cashEquity:0,timing:{}};

export function monthlyLiquidityAmounts(study:FeasibilityStudy):MonthlyAmounts|null {
 if(study.water){
  const result=evaluateWater(study.water);
  const year=result.annual[0];
  if(!year)return null;
  return {
   collections:year.revenue,investment:-result.cashRequired,costs:-(year.variable+year.fixed+year.maintenance),
   workingCapital:-year.workingCapitalMovement,debtDraw:result.totalLoan,principal:-year.principal,
   interest:-year.interest,
   yearEnd:(year.workingCapitalRecovery??0)+(year.terminalAssetProceeds??0)
    -(year.equityTax??year.tax),terminalPrincipal:-(year.terminalDebtRepayment??0)
  };
 }
 if(study.rawLand){
  const result=evaluateRawLand(study.rawLand);
  if(result.issue)return null;
  const year=result.annual[0];
  if(!year)return null;
  return {
   collections:year.cashCollected,investment:study.rawLand.site.landPaymentMethod==='cash'?-result.land:0,
   costs:-(year.cashCost-year.interest),workingCapital:0,debtDraw:year.draw,principal:-year.repayment,
   interest:-year.interest,yearEnd:-year.performanceFee,terminalPrincipal:0
  };
 }
 return null;
}

export function evaluateMonthlyLiquidity(amounts:MonthlyAmounts,plan:MonthlyLiquidity){
 let closing=plan.openingCash;
 let lowestClosing=0;
 let peakMonth:number|null=null;
 const rows=Array.from({length:12},(_,index)=>{
  const month=index+1;
  const opening=closing;
  const {terminalPrincipal,...annual}=amounts;
  const totals={...annual,equity:plan.cashEquity};
  const allocated={...totals};
  allocated.yearEnd=month===12?amounts.yearEnd:0;
  for(const key of streams){
   const {from,to}=plan.timing[key]??liquidityTiming[key];
   allocated[key]=month>=from&&month<=to?totals[key]/(to-from+1):0;
  }
  if(month===12)allocated.principal+=terminalPrincipal;
  const net=Object.values(allocated).reduce((sum,value)=>sum+value,0);
  closing=opening+net;
  const roundedClosing=Math.round(closing*100)/100;
  if(roundedClosing<lowestClosing){
   lowestClosing=roundedClosing;
   peakMonth=month;
  }
  return {month,opening,closing,net,...allocated};
 });
 return {rows,closing,peakMonth,fundingGap:Math.abs(lowestClosing)};
}

export function liquidityMonthLabel(startMonth:string|undefined,month:number,locale:string){
 if(!startMonth)return new Intl.NumberFormat(locale).format(month);
 const [year,firstMonth]=startMonth.split('-').map(Number);
 return new Intl.DateTimeFormat(locale,{calendar:'gregory',month:'short',year:'numeric',timeZone:'UTC'})
  .format(new Date(Date.UTC(year,firstMonth+month-2,1)));
}
