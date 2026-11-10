import {evaluateStudy,internalRateOfReturn,type AdvancedAssumptions,type CapitalCategory,type FeasibilityStudy,type Scenario} from './engine';

export const categories:readonly CapitalCategory[]=['BUILDINGS','EQUIPMENT','UTILITIES','LICENCES','OTHER'];
export const illustratedLives:Readonly<Record<CapitalCategory,number>>={BUILDINGS:20,EQUIPMENT:10,UTILITIES:10,LICENCES:5,OTHER:5};
/** Must be explicitly reviewed; zero useful lives are intentionally not decision-ready. */
export function emptyAdvanced():AdvancedAssumptions{
 return {mode:'DIRECT',capacityMonthly:0,utilisationPct:0,saleablePct:100,
  lives:{BUILDINGS:0,EQUIPMENT:0,UTILITIES:0,LICENCES:0,OTHER:0},
  debtRatePct:0,debtYears:0,terminalCash:0};
}
export type AdvancedYear={year:number;volume:number;revenue:number;ebitda:number;depreciation:number;ebit:number;tax:number;fcf:number;interest:number;principal:number;debtBalance:number;equityFcf:number;dscr:number|null};
export type AdvancedResult={ready:boolean;equityReady:boolean;blockers:string[];equityBlockers:string[];annual:AdvancedYear[];
 monthlyVolume:number;initialInvestment:number;cashNeed:number;projectFlows:number[];equityFlows:number[];
 projectNpv:number|null;projectIrr:number|null;equityNpv:number|null;equityIrr:number|null;minDscr:number|null;};
const nonneg=(x:number)=>Number.isFinite(x)&&x>=0;
const npv=(flows:number[],rate:number)=>flows.reduce((sum,v,t)=>sum+v/Math.pow(1+rate,t),0);
const approximatelyEqual=(a:number,b:number)=>Math.abs(a-b)<=Math.max(.01,Math.abs(a)*1e-8);

/**
 * Discounted, simplified PROJECT cashflows are before debt. Equity cashflows deduct
 * debt service separately. Never post to an accounting ledger or infer legal tax bases.
 */
export function evaluateAdvanced(s:FeasibilityStudy,scenario:Scenario='BASE'):AdvancedResult {
 const a=s.advanced??emptyAdvanced(),blockers:string[]=[],equityBlockers:string[]=[];
 const values=[a.capacityMonthly,a.utilisationPct,a.saleablePct,a.debtRatePct,a.debtYears,a.terminalCash,...Object.values(a.lives)];
 if(values.some(v=>!nonneg(v))||a.utilisationPct>100||a.saleablePct>100||a.debtRatePct>100||
  !Number.isInteger(a.debtYears)||categories.some(c=>!Number.isInteger(a.lives[c])||a.lives[c]>60)||
  !nonneg(s.indicativeTaxRatePct)||s.indicativeTaxRatePct>100||!nonneg(s.discountRatePct)||s.discountRatePct>100||
  ![s.volumeGrowthPct,s.priceGrowthPct,s.fixedCostGrowthPct].every(v=>nonneg(v)&&v<=100))
  blockers.push('INVALID_ASSUMPTIONS');
 let monthlyVolume=s.monthlyUnits;
 if(a.mode==='CAPACITY'){
  if(a.capacityMonthly<=0||a.utilisationPct<=0||a.saleablePct<=0)blockers.push('CAPACITY_INCOMPLETE');
  monthlyVolume=a.capacityMonthly*a.utilisationPct/100*a.saleablePct/100;
 }else if(a.mode!=='DIRECT')blockers.push('INVALID_ASSUMPTIONS');
 const base=evaluateStudy({...s,monthlyUnits:monthlyVolume},scenario);
 if(base.capex<=0||s.unitPrice<=0||monthlyVolume<=0)blockers.push('BASIC_INPUT_MISSING');
 const grouped=Object.fromEntries(categories.map(category=>[category,s.capex.filter(x=>x.category===category).reduce((v,x)=>v+x.amount,0)])) as Record<CapitalCategory,number>;
 if(categories.some(category=>grouped[category]>0&&a.lives[category]<=0))blockers.push('USEFUL_LIVES_MISSING');
 const debt=s.investorLoan+s.otherDebt,years=s.years,working=s.workingCapital;
 if(![debt,working,s.investorLoan,s.otherDebt,s.investorEquity,s.partnerCashEquity,s.landValue,s.annualMaintenance].every(nonneg)||
  s.capex.some(x=>!nonneg(x.amount)))blockers.push('INVALID_ASSUMPTIONS');
 if(debt>0&&a.debtYears<1)blockers.push('DEBT_TERM_MISSING');
 if(debt>0&&a.debtYears>years)blockers.push('DEBT_EXCEEDS_HORIZON');
 if(debt>base.capex+working)blockers.push('DEBT_OVERFUNDED');
 if(!Number.isFinite(base.totalInvestment)||!base.annual.every(y=>[y.revenue,y.volume,y.ebitda].every(Number.isFinite)))
  blockers.push('NONFINITE_PROJECTION');
 const initialInvestment=base.totalInvestment,cashNeed=base.capex+working;
 const fail=():AdvancedResult=>({ready:false,equityReady:false,blockers:[...new Set(blockers)],equityBlockers:[],annual:[],monthlyVolume,initialInvestment,cashNeed,
  projectFlows:[],equityFlows:[],projectNpv:null,projectIrr:null,equityNpv:null,equityIrr:null,minDscr:null});
 if(blockers.length)return fail();
 let balance=debt,minDscr:number|null=null;
 const annual:AdvancedYear[]=[];
 const projectFlows=[-initialInvestment];
 for(const y of base.annual){
  const depreciation=categories.reduce((total,category)=>total+
   (a.lives[category]>0&&y.year<=a.lives[category]?grouped[category]/a.lives[category]:0),0);
  const ebit=y.ebitda-depreciation;
  const tax=Math.max(0,ebit)*s.indicativeTaxRatePct/100;
  // Annual maintenance is modeled as a CASH capital expense, not recurring tax deduction.
  const fcf=y.ebitda-tax-s.annualMaintenance+(y.year===years?working+a.terminalCash:0);
  const interest=balance*a.debtRatePct/100;
  const principal=debt>0&&y.year<=a.debtYears?Math.min(balance,debt/a.debtYears):0;
  balance=Math.max(0,balance-principal);
  const service=interest+principal;
  const dscr=service>0?(y.ebitda-tax-s.annualMaintenance)/service:null;
  if(dscr!==null)minDscr=Math.min(minDscr??dscr,dscr);
  annual.push({year:y.year,volume:y.volume,revenue:y.revenue,ebitda:y.ebitda,depreciation,ebit,tax,fcf,interest,principal,debtBalance:balance,equityFcf:fcf-service,dscr});
  projectFlows.push(fcf);
 }
 if(projectFlows.some(x=>!Number.isFinite(x))||annual.some(x=>Object.values(x).some(v=>v!==null&&!Number.isFinite(v)))){
  blockers.push('NONFINITE_PROJECTION');return fail();
 }
 const fundedCash=base.cashEquity+debt;
 if(!approximatelyEqual(cashNeed,fundedCash))equityBlockers.push(fundedCash<cashNeed?'FUNDING_GAP':'UNMODELED_SURPLUS');
 if(studyLandInvalid(s))equityBlockers.push('LAND_VALUE_REQUIRED');
 const economicEquity=base.cashEquity+base.landAsset;
 if(economicEquity<=0)equityBlockers.push('EQUITY_UNFUNDED');
 const equityReady=equityBlockers.length===0;
 const equityFlows=equityReady?[-economicEquity,...annual.map(y=>y.equityFcf)]:[];
 const discount=s.discountRatePct/100;
 return {ready:true,equityReady,blockers:[],equityBlockers,annual,monthlyVolume,initialInvestment,cashNeed,
  projectFlows,equityFlows,projectNpv:npv(projectFlows,discount),projectIrr:internalRateOfReturn(projectFlows),
  equityNpv:equityReady?npv(equityFlows,discount):null,equityIrr:equityReady?internalRateOfReturn(equityFlows):null,minDscr};
}
function studyLandInvalid(s:FeasibilityStudy){return s.landTransferred&&s.landValue<=0}
