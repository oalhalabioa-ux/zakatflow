
import {internalRateOfReturn,type FeasibilityStudy,type IndustrialProductionSchedule,
 type PropertyStage,type PropertyDevelopmentSchedule} from './engine';

export function blankIndustrialSchedule():IndustrialProductionSchedule {
 return {kind:'INDUSTRIAL',ratedCapacityMonthly:0,operatingMonths:0,utilizationPct:0,
  saleableYieldPct:0,productionCashCostPerGrossUnit:0};
}
export function blankPropertySchedule():PropertyDevelopmentSchedule {
 return {kind:'REAL_ESTATE',stages:[]};
}
const validCash=(n:number)=>Number.isFinite(n)&&n>=0&&n<=1e12;
const sum=(n:number[])=>n.reduce((a,b)=>a+b,0);
const npv=(flows:readonly number[],discountRatePct:number)=>
 flows.reduce((v,c,i)=>v+c/Math.pow(1+discountRatePct/100,i),0);
export type IndustrialResult={
 ready:boolean;blockers:string[];grossProduction:number;saleableUnits:number;
 soldUnits:number;rejectedUnits:number;unsoldUnits:number;
 revenue:number;productionCashCosts:number;fixedCashCosts:number;operatingCashContribution:number;
};
export function evaluateIndustrialProduction(study:FeasibilityStudy):IndustrialResult{
 const x=study.sectorSchedule?.kind==='INDUSTRIAL'?study.sectorSchedule:blankIndustrialSchedule();
 const blockers:string[]=[];
 if(study.sector!=='INDUSTRIAL')blockers.push('SECTOR_MISMATCH');
 if(![x.ratedCapacityMonthly,x.operatingMonths,x.utilizationPct,x.saleableYieldPct,
   x.productionCashCostPerGrossUnit,study.monthlyUnits,study.unitPrice,study.monthlyFixedCost]
   .every(validCash) || !Number.isInteger(x.operatingMonths) || x.operatingMonths>12||
   x.utilizationPct>100 || x.saleableYieldPct>100)blockers.push('INVALID_INPUT');
 if(x.ratedCapacityMonthly<=0||x.operatingMonths<=0||x.utilizationPct<=0||
   x.saleableYieldPct<=0)blockers.push('CAPACITY_INCOMPLETE');
 if(study.monthlyUnits<=0||study.unitPrice<=0)blockers.push('DEMAND_OR_PRICE_MISSING');
 const empty=():IndustrialResult=>({
  ready:false,blockers:[...new Set(blockers)],grossProduction:0,saleableUnits:0,
  soldUnits:0,rejectedUnits:0,unsoldUnits:0,revenue:0,productionCashCosts:0,
  fixedCashCosts:0,operatingCashContribution:0
 });
 if(blockers.length)return empty();
 const grossProduction=x.ratedCapacityMonthly*x.operatingMonths*x.utilizationPct/100;
 const saleableUnits=grossProduction*x.saleableYieldPct/100;
 const soldUnits=Math.min(saleableUnits,study.monthlyUnits*12);
 const rejectedUnits=grossProduction-saleableUnits;
 const unsoldUnits=saleableUnits-soldUnits;
 const revenue=soldUnits*study.unitPrice;
 // Conservative production-cash proxy: includes produced rejects/unsold units.
 // Unsold product is NOT capitalised as accounting inventory.
 const productionCashCosts=grossProduction*x.productionCashCostPerGrossUnit;
 const fixedCashCosts=study.monthlyFixedCost*12;
 const operatingCashContribution=revenue-productionCashCosts-fixedCashCosts;
 if(![grossProduction,saleableUnits,soldUnits,rejectedUnits,unsoldUnits,revenue,
  productionCashCosts,fixedCashCosts,operatingCashContribution].every(Number.isFinite)){
  blockers.push('NONFINITE_RESULT');return empty();
 }
 return {ready:true,blockers:[],grossProduction,saleableUnits,soldUnits,
  rejectedUnits,unsoldUnits,revenue,productionCashCosts,fixedCashCosts,operatingCashContribution};
}
export type PropertyYear={
 year:number;contractedUnits:number;bookedContracts:number;cashCollections:number;
 constructionCashCost:number;sellingCashCost:number;netCashFlow:number;
 outstandingReceivables:number;fundingBalance:number;
};
export type PropertyResult={
 ready:boolean;blockers:string[];years:PropertyYear[];
 bookings:number;collections:number;outstandingReceivables:number;
 initialCashOutlay:number;initialEconomicOutlay:number;peakCashFundingNeed:number;
 cashFlows:number[];economicFlows:number[];
 projectNpv:number|null;projectIrr:number|null;
};
const emptyStage=(year:number):PropertyStage=>({
 year,contractedUnits:0,contractPricePerUnit:0,cashCollections:0,constructionCashCost:0,sellingCashCost:0
});
export function evaluatePropertyStages(study:FeasibilityStudy):PropertyResult{
 const x=study.sectorSchedule?.kind==='REAL_ESTATE'?study.sectorSchedule:blankPropertySchedule();
 const blockers:string[]=[];
 if(study.sector!=='REAL_ESTATE')blockers.push('SECTOR_MISMATCH');
 if(!Number.isInteger(study.years)||study.years<1||study.years>20)blockers.push('BAD_HORIZON');
 if(!validCash(study.discountRatePct)||study.discountRatePct>100||
  !validCash(study.landValue) ||study.capex.some(y=>!validCash(y.amount)))blockers.push('INVALID_INPUT');
 if(x.stages.length===0)blockers.push('STAGES_MISSING');
 const used=new Set<number>();
 for(const stage of x.stages){
  if(!Number.isInteger(stage.year)||stage.year<1||stage.year>study.years||
    !Number.isInteger(stage.contractedUnits)||
    ![stage.contractedUnits,stage.contractPricePerUnit,stage.cashCollections,
      stage.constructionCashCost,stage.sellingCashCost].every(validCash)){
   blockers.push('INVALID_STAGE');continue;
  }
  if(used.has(stage.year))blockers.push('DUPLICATE_YEAR');
  used.add(stage.year);
  if(stage.contractedUnits>0&&stage.contractPricePerUnit<=0)blockers.push('PRICE_REQUIRED');
 }
 const initialCashOutlay=sum(study.capex.map(y=>y.amount));
 const initialEconomicOutlay=initialCashOutlay+(study.landTransferred?study.landValue:0);
 const fail=():PropertyResult=>({ready:false,blockers:[...new Set(blockers)],years:[],
  bookings:0,collections:0,outstandingReceivables:0,initialCashOutlay,initialEconomicOutlay,
  peakCashFundingNeed:0,cashFlows:[],economicFlows:[],projectNpv:null,projectIrr:null});
 if(blockers.length)return fail();
 const stages=new Map(x.stages.map(z=>[z.year,z]));
 let outstandingReceivables=0,bookings=0,collections=0;
 let fundingBalance=-initialCashOutlay,peakCashFundingNeed=Math.max(0,-fundingBalance);
 const years:PropertyYear[]=[];
 const cashFlows=[-initialCashOutlay],economicFlows=[-initialEconomicOutlay];
 for(let year=1;year<=study.years;year++){
  const stage=stages.get(year)??emptyStage(year);
  const bookedContracts=stage.contractedUnits*stage.contractPricePerUnit;
  bookings+=bookedContracts;collections+=stage.cashCollections;
  outstandingReceivables=bookings-collections;
  if(outstandingReceivables < -Math.max(.01,bookings*1e-10))blockers.push('COLLECTIONS_EXCEED_CONTRACTS');
  const netCashFlow=stage.cashCollections-stage.constructionCashCost-stage.sellingCashCost;
  fundingBalance+=netCashFlow;
  peakCashFundingNeed=Math.max(peakCashFundingNeed,-fundingBalance);
  years.push({year,contractedUnits:stage.contractedUnits,bookedContracts,
   cashCollections:stage.cashCollections,constructionCashCost:stage.constructionCashCost,
   sellingCashCost:stage.sellingCashCost,netCashFlow,
   outstandingReceivables:Math.max(0,outstandingReceivables),fundingBalance});
  cashFlows.push(netCashFlow);
  economicFlows.push(netCashFlow);
 }
 if(bookings<=0)blockers.push('NO_CONTRACTS');
 if(![bookings,collections,initialCashOutlay,initialEconomicOutlay,peakCashFundingNeed,
   ...cashFlows,...economicFlows].every(Number.isFinite))blockers.push('NONFINITE_RESULT');
 if(blockers.length)return fail();
 return {ready:true,blockers:[],years,bookings,collections,
  outstandingReceivables:Math.max(0,outstandingReceivables),
  initialCashOutlay,initialEconomicOutlay,peakCashFundingNeed,cashFlows,economicFlows,
  projectNpv:npv(economicFlows,study.discountRatePct),
  projectIrr:internalRateOfReturn(economicFlows)};
}
