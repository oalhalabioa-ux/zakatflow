import {describe,expect,it} from 'vitest';
import {annualPhaseWeights,createRawLand,evaluateRawLand} from './raw-land';
import {feasibilityDraftSchema} from './draft-schema';
import {createRawLandStarter} from './project-templates';

const id='bd43c52e-a187-4fcc-a7a7-f07fc662e74f';

function synthetic(){
 const model=createRawLand();
 model.project={startYear:2027,years:2,discountRate:.1};
 Object.assign(model.site,{areaAfterPriorTransfers:10000,excludedValley:1000,extraExcluded:500,
  otherConstraintsSqm:500,serviceRatio:.25,landPricePerNetSqm:20});
 model.sales.mix=[
  {name:'Use A',share:.6,price:100,annualGrowthAdjustment:0,enabled:true},
  {name:'Use B',share:.4,price:200,annualGrowthAdjustment:.1,enabled:true}
 ];
 model.sales.scenarios[2]={name:'Base',priceMultiplier:1,annualGrowth:.1,initialPricePremium:0,costMultiplier:1,salesDelayYears:1};
 model.phasing.sales=[.25,.25,.25,.25];
 model.cost.developmentPerNetSqm=10;
 model.finance.facility=10000;
 model.waterfall.incentiveRate=.2;
 model.waterfall.hurdleRate=.1;
 return model;
}

describe('general land development model',()=>{
 it.each([1,2,4,7,10,15])('allocates all sales across %i years plus the scenario delay',years=>{
  const weights=annualPhaseWeights([0,.05,.5,.45],years,3);
  expect(weights).toHaveLength(years+3);
  expect(weights.slice(0,3)).toEqual([0,0,0]);
  expect(weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,12);
 });
 it('applies compound growth by use and actual year, and keeps land economic and equity cash separate',()=>{
  const model=synthetic();
  const result=evaluateRawLand(model);
  if(result.issue)throw Error(result.issue);
  expect(result.net).toBe(8000);
  expect(result.saleArea).toBe(6000);
  expect(result.annual.map(y=>y.year)).toEqual([2027,2028,2029]);
  expect(result.annual[1].salesValue).toBeCloseTo(486000);
  expect(result.annual[2].salesValue).toBeCloseTo(563400);
  expect(result.totalCost).toBe(240000);
  expect(result.revenue).toBeCloseTo(1049400);
  expect(result.incentive).toBeCloseTo(140892);
  expect(result.irr).not.toBeNull();
  expect(result.annual.reduce((total,year,i)=>total+year.projectCash/(1+(result.irr??0)/100)**i,0)).toBeCloseTo(0,4);
  expect(result.annual.at(-1)?.closingDebt).toBe(0);
  const cash=evaluateRawLand({...model,site:{...model.site,landPaymentMethod:'cash'}});
  if(cash.issue)throw Error(cash.issue);
  expect(cash.npv).toBe(result.npv);
  expect(result.annual[0].equityCash-cash.annual[0].equityCash).toBe(160000);
 });
 it('updates sales, financing, valuation, and cost phase checks without persisting invalid study output',()=>{
  const model=synthetic();
  const baseline=evaluateRawLand(model);
  if(baseline.issue)throw Error(baseline.issue);
  model.site.serviceRatio=.5;
  model.finance.interestMode='dynamic';
  model.finance.benchmarkRate=.08;
  model.finance.spreadRate=.02;
  const changed=evaluateRawLand(model);
  if(changed.issue)throw Error(changed.issue);
  expect(changed.saleArea).toBe(4000);
  expect(changed.revenue).toBeLessThan(baseline.revenue);
  expect(changed.costs.interestBudget).toBeGreaterThan(0);
  model.sales.mix[0].share=.5;
  expect(evaluateRawLand(model).issue).toBe('mix');
  model.sales.mix[0].share=.6;
  model.phasing.development=[.2,.2,.2,.2];
  expect(evaluateRawLand(model).issue).toBe('phasing');
 });
 it('uses detailed quantity estimates in place of the aggregate development cost',()=>{
  const model=synthetic();
  model.cost.developmentItems=[{name:'Earthworks',quantity:120,unitCost:200},{name:'Utilities',quantity:600,unitCost:20}];
  const result=evaluateRawLand(model);
  if(result.issue)throw Error(result.issue);
  expect(result.costs.development).toBe(36000);
  expect(result.totalCost).toBe(196000);
 });
 it('round-trips through the same strict draft schema without real study details or cross-model data',()=>{
  const study=createRawLandStarter(id,'New land project');
  expect(study.country).toBe('');
  expect(study.rawLand?.site.areaAfterPriorTransfers).toBe(0);
  expect(study.rawLand?.sales.mix[0].price).toBe(0);
  expect(feasibilityDraftSchema.parse(JSON.parse(JSON.stringify(study)))).toEqual(study);
  expect(feasibilityDraftSchema.safeParse({...study,sector:'INDUSTRIAL'}).success).toBe(false);
  expect(feasibilityDraftSchema.safeParse({...study,rawLand:synthetic()}).success).toBe(true);
 });
});
