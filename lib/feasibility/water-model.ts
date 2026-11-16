import {z} from 'zod';
import {internalRateOfReturn, type FeasibilityStudy} from './engine';

const amount=z.number().finite().min(0).max(1e12);
const pct=z.number().finite().min(0).max(100);
const multiplier=z.number().finite().min(0).max(1000);
export const waterScenarioSchema=z.object({
 name:z.string().trim().min(1).max(120),volume:multiplier,price:multiplier,cost:multiplier
}).strict();
export const waterModelSchema=z.object({
 deal:z.object({
  landMode:z.enum(['transfer','lease','right']),landValue:amount,landArea:amount,rightValue:amount,
  leaseMonth:amount,licenseValue:amount,investorLoan:amount,loanInterest:pct,
  loanYears:z.number().int().min(0).max(60),loanStart:z.number().int().min(0).max(60),
  extraFunding:amount,extraType:z.enum(['loan','equity'])
 }).strict(),
 capex:z.object({
  buildings:amount,line:amount,treatment:amount,power:amount,lab:amount,vehicles:amount,
  licenses:amount,others:amount,contingencyPct:multiplier,workingCapital:amount
 }).strict(),
 ops:z.object({
  bottlesHour:amount,hoursDay:amount,daysMonth:amount,bottlesCarton:amount,litersBottle:amount,
  waterLossPct:pct,licensedWaterM3Day:amount,priceCarton:amount,variableCarton:amount,
  fixedMonth:amount,priceGrowth:multiplier,costGrowth:multiplier,fixedGrowth:multiplier,
  maintenancePct:multiplier,nwcPct:multiplier,discountRate:multiplier,taxRate:pct,
  life:z.number().int().min(0).max(60),horizon:z.number().int().min(3).max(10),
  util:z.array(pct).max(10)
 }).strict(),
 scenarios:z.array(waterScenarioSchema).max(20)
}).strict();
export type WaterModel=z.infer<typeof waterModelSchema>;
export type WaterScenario=z.infer<typeof waterScenarioSchema>;

export function createWaterModel():WaterModel{
 return {
  deal:{landMode:'transfer',landValue:0,landArea:0,rightValue:0,leaseMonth:0,licenseValue:0,
   investorLoan:0,loanInterest:0,loanYears:0,loanStart:0,extraFunding:0,extraType:'loan'},
  capex:{buildings:0,line:0,treatment:0,power:0,lab:0,vehicles:0,licenses:0,others:0,contingencyPct:0,workingCapital:0},
  ops:{bottlesHour:0,hoursDay:0,daysMonth:0,bottlesCarton:0,litersBottle:0,waterLossPct:0,
   licensedWaterM3Day:0,priceCarton:0,variableCarton:0,fixedMonth:0,priceGrowth:0,costGrowth:0,
   fixedGrowth:0,maintenancePct:0,nwcPct:0,discountRate:0,taxRate:0,life:0,horizon:7,util:Array(10).fill(0)},
  scenarios:[
   {name:'Conservative',volume:75,price:95,cost:110},
   {name:'Base',volume:100,price:100,cost:100},
   {name:'Optimistic',volume:120,price:105,cost:98}
  ]
 };
}

export function evaluateWater(model:WaterModel,scenario?:Omit<WaterScenario,'name'>){
 const {deal,capex,ops}=model;
 const hard=capex.buildings+capex.line+capex.treatment+capex.power+capex.lab+capex.vehicles+capex.others;
 const contingency=hard*capex.contingencyPct/100;
 const investment=hard+contingency+capex.licenses;
 const cashRequired=investment+capex.workingCapital;
 const land=deal.landMode==='transfer'?deal.landValue:deal.landMode==='right'?deal.rightValue:0;
 const shareholderLoan=Math.min(deal.investorLoan,cashRequired);
 const investorEquity=cashRequired-shareholderLoan+(deal.extraType==='equity'?deal.extraFunding:0);
 const totalEquity=investorEquity+land;
 const totalLoan=shareholderLoan+(deal.extraType==='loan'?deal.extraFunding:0);
 const capacity=ops.bottlesHour*ops.hoursDay*ops.daysMonth*12/Math.max(1,ops.bottlesCarton);
 const waterDemand=ops.bottlesHour*ops.hoursDay*ops.litersBottle/(1000*Math.max(0.01,1-Math.min(99,ops.waterLossPct)/100));
 const initialPrice=ops.priceCarton*(scenario?.price??100)/100;
 const initialCost=ops.variableCarton*(scenario?.cost??100)/100;
 const initialFixed=(ops.fixedMonth+deal.leaseMonth)*12;
 const depreciation=investment/Math.max(1,ops.life);
 const maintenance=investment*ops.maintenancePct/100;
 let workingCapital=capex.workingCapital;
 let debtBalance=totalLoan;
 const annual=Array.from({length:ops.horizon},(_,i)=>{
  const year=i+1;
  const utilization=Math.min(100,(ops.util[i]??ops.util.at(-1)??0)*(scenario?.volume??100)/100);
  const volume=capacity*utilization/100;
  const price=initialPrice*(1+ops.priceGrowth/100)**i;
  const unitCost=initialCost*(1+ops.costGrowth/100)**i;
  const revenue=volume*price;
  const variable=volume*unitCost;
  const fixed=initialFixed*(1+ops.fixedGrowth/100)**i;
  const ebitda=revenue-variable-fixed;
  const ebit=ebitda-depreciation;
  const tax=Math.max(0,ebit)*ops.taxRate/100;
  const nextWorkingCapital=revenue*ops.nwcPct/100;
  const workingCapitalMovement=nextWorkingCapital-workingCapital;
  workingCapital=nextWorkingCapital;
  const freeCashFlow=ebitda-tax-maintenance-workingCapitalMovement;
  const servicing=year>=Math.max(1,deal.loanStart)&&debtBalance>0;
  const principal=servicing?Math.min(debtBalance,totalLoan/Math.max(1,deal.loanYears)):0;
  const interest=servicing?debtBalance*deal.loanInterest/100:0;
  debtBalance=Math.max(0,debtBalance-principal);
  const debtService=principal+interest;
  return {year,utilization,volume,price,unitCost,revenue,variable,fixed,ebitda,depreciation,ebit,tax,
   workingCapital,workingCapitalMovement,maintenance,freeCashFlow,principal,interest,debtBalance,debtService,
   afterDebt:freeCashFlow-debtService,dscr:debtService>0?freeCashFlow/debtService:null};
 });
 const flows=[-(cashRequired+land),...annual.map(year=>year.freeCashFlow)];
 const npv=flows.reduce((total,flow,year)=>total+flow/(1+ops.discountRate/100)**year,0);
 let cumulative=flows[0];
 let payback:number|null=null;
 for(const year of annual){
  const previous=cumulative;
  cumulative+=year.freeCashFlow;
  if(previous<0&&cumulative>=0){
   payback=year.year-1-previous/year.freeCashFlow;
   break;
  }
 }
 return {hard,contingency,investment,cashRequired,land,investorEquity,totalEquity,shareholderLoan,totalLoan,
  investorShare:totalEquity?investorEquity/totalEquity*100:null,partnerShare:totalEquity?land/totalEquity*100:null,
  capacity,waterDemand,annual,flows,npv,cashNpv:npv+land,irr:internalRateOfReturn(flows),payback,
  breakEven:initialPrice>initialCost?initialFixed/(initialPrice-initialCost):null,
  ready:investment>0&&capacity>0&&ops.bottlesCarton>0&&initialPrice>0&&annual.some(year=>year.volume>0)};
}

export function studyReportReadiness(study:FeasibilityStudy){
 return {
  openCritical:study.legal.filter(item=>item.critical&&item.status!=='VERIFIED'),
  openTasks:study.tasks.filter(item=>item.status!=='DONE'),
  highRisks:study.risks.filter(item=>item.status!=='MITIGATED'&&item.impact*item.likelihood>=15)
 };
}
