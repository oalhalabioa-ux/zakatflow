import {describe,expect,it} from 'vitest';
import {evaluateLandPhasedLiquidity} from './land-phased-liquidity';
import {defaultMonthlyLiquidity} from './monthly-liquidity';
import type {Partnership} from './partnership';
import {createRawLand,evaluateRawLand} from './raw-land';

function project(){
 const land=createRawLand();
 land.project={startYear:2027,years:2,discountRate:.1};
 Object.assign(land.site,{areaAfterPriorTransfers:100,landPricePerNetSqm:10,landPaymentMethod:'cash'});
 land.sales.mix[0]={name:'Plots',enabled:true,share:1,price:100,annualGrowthAdjustment:0,
  salesPhasing:[1,0,0,0],collectionPhasing:[.25,0,.75,0]};
 land.sales.scenarios[2].salesDelayYears=1;
 land.cost.developmentPerNetSqm=20;
 land.finance.facility=1200;
 land.finance.interestMode='dynamic';
 land.finance.benchmarkRate=.1;
 land.waterfall.incentiveRate=.1;
 return land;
}

const plan={...defaultMonthlyLiquidity,startMonth:'2027-01',openingCash:50,cashEquity:200,
 timing:{collections:{from:12,to:12},costs:{from:1,to:1}}};
const partnership:Partnership={asOf:'2027-02-28',partners:[{
 id:'5b901bb6-a900-4164-a872-f2cccf682ae2',name:'Partner A',
 ownershipPct:100,profitPct:100,cashCommitted:500,cashPaid:0,loanPaid:0,
 installments:[{id:'5fdbfa0e-8c85-4506-8e35-19a2fa62ab55',type:'EQUITY',amount:500,
  expectedOn:'2028-04-15',paid:100,paidOn:'2027-02-20'}]
}]};

describe('full land development monthly cash flow',()=>{
 it.each(['cash','in_kind','lease'] as const)('reconciles phases, deferred collections and facility service for %s',method=>{
  const land=project();
  land.site.landPaymentMethod=method;
  land.site.annualLandRent=60;
  const result=evaluateLandPhasedLiquidity(land,plan);
  const annual=evaluateRawLand(land);
  if(result.issue||annual.issue)throw Error('Synthetic land should evaluate');
  expect(result.years.map(year=>year.rows.length)).toEqual([12,12,12,12]);
  expect(result.years.map(year=>year.rows[11].collections)).toEqual([0,2500,0,7500]);
  const rows=result.years.flatMap(year=>year.rows);
  const total=(key:'investment'|'equity'|'debtDraw'|'principal'|'interest')=>rows.reduce((sum,row)=>sum+row[key],0);
  expect(total('investment')).toBe(method==='cash'?-1000:0);
  expect(total('equity')).toBe(200);
  expect(total('debtDraw')).toBe(1200);
  expect(total('principal')).toBeCloseTo(-1200);
  expect(total('interest')).toBeLessThan(0);
  for(const [i,year] of result.years.entries()){
   expect(year.rows[0].opening).toBe(i===0?50:result.years[i-1].closing);
   expect(year.rows.reduce((sum,row)=>sum+row.net,0)).toBeCloseTo(annual.annual[i].equityCash+(i===0?200:0));
  }
  expect(result.closing).toBeCloseTo(250+annual.annual.reduce((sum,year)=>sum+year.equityCash,0));
  expect(result.fundingGap).toBeCloseTo(-Math.min(...rows.map(row=>row.closing)),2);
  expect(result.peakMonth).toBeGreaterThan(12);
 });
 it('allocates each dated installment once, including partially paid equity after month 12',()=>{
  const result=evaluateLandPhasedLiquidity(project(),{...plan,usePartnerInstallments:true},partnership);
  if(result.issue)throw Error(result.issue);
  const rows=result.years.flatMap(year=>year.rows);
  expect(rows.filter(row=>row.equity).map(row=>[row.month,row.equity])).toEqual([[2,100],[16,400]]);
  expect(result.excludedEquity).toBe(0);
 });
 it('recognizes a year-zero purchase once even when the monthly purchase is set later',()=>{
  const land=project();
  land.quantityDevelopment={budget:{enabled:false,items:[]},roadLength:0,networkLength:0,serviceArea:0,landTiming:'YEAR0'};
  const result=evaluateLandPhasedLiquidity(land,{...plan,timing:{debtDraw:{from:12,to:12}}});
  if(result.issue)throw Error(result.issue);
  expect(result.beforeStartAcquisition).toBe(1000);
  expect(result.years[0].rows[0].opening).toBe(-950);
  expect(result.years.flatMap(year=>year.rows).every(row=>row.investment===0)).toBe(true);
  expect(result.timingConflict).toBe(true);
 });
 it('shows a pre-period shortfall even if the first month closes with cash',()=>{
  const land=project();
  land.cost.developmentPerNetSqm=0;
  land.quantityDevelopment={budget:{enabled:false,items:[]},roadLength:0,networkLength:0,serviceArea:0,landTiming:'YEAR0'};
  const result=evaluateLandPhasedLiquidity(land,{...plan,cashEquity:2000});
  if(result.issue)throw Error(result.issue);
  expect(result.peakMonth).toBe(0);
  expect(result.fundingGap).toBe(950);
 });
 it('does not extend a forecast with a selected but incomplete quantity budget',()=>{
  const land=project();
  land.quantityDevelopment={budget:{enabled:true,items:[]},roadLength:0,networkLength:0,serviceArea:0};
  expect(evaluateLandPhasedLiquidity(land,plan).issue).toBe('quantity-costs');
 });
 it('refuses to publish a full-horizon estimate for missing assumptions, dates, or unmodeled partner loans',()=>{
  expect(evaluateLandPhasedLiquidity(createRawLand(),plan).issue).toBe('annual-model');
  expect(evaluateLandPhasedLiquidity(project(),{...plan,usePartnerInstallments:true}).issue).toBe('installment-dates');
  const lease=project();
  lease.site.landPaymentMethod='lease';
  expect(evaluateLandPhasedLiquidity(lease,plan).issue).toBe('rent-assumption');
  lease.site.annualLandRent=0;
  expect(evaluateLandPhasedLiquidity(lease,plan).issue).toBeNull();
  const withLoan={...partnership,partners:partnership.partners.map(partner=>({...partner,loanPaid:50}))};
  expect(evaluateLandPhasedLiquidity(project(),plan,withLoan).issue).toBe('partner-loan-service');
 });
});
