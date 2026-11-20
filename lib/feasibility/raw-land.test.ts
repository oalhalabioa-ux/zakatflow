import {describe,expect,it} from 'vitest';
import {annualPhaseWeights,compareRawLandAlternatives,createRawLand,evaluateRawLand,rawLandSchema} from './raw-land';
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
 it('separates signed sales, collected instalments, and outstanding receivables by use',()=>{
  const model=synthetic();
  model.sales.scenarios[2].salesDelayYears=0;
  model.sales.scenarios[2].annualGrowth=0;
  model.sales.mix[0].salesPhasing=[1,0,0,0];
  model.sales.mix[0].collectionPhasing=[.25,0,.75,0];
  model.sales.mix[1].salesPhasing=[0,0,1,0];
  model.sales.mix[1].annualGrowthAdjustment=0;
  const result=evaluateRawLand(model);
  if(result.issue)throw Error(result.issue);
  expect(result.annual.map(row=>row.soldArea)).toEqual([3600,2400,0]);
  expect(result.annual.map(row=>row.salesValue)).toEqual([360000,480000,0]);
  expect(result.annual.map(row=>row.cashCollected)).toEqual([90000,480000,270000]);
  expect(result.annual.map(row=>row.receivables)).toEqual([270000,270000,0]);
  expect(result.annual.reduce((sum,row)=>sum+row.cashCollected,0)).toBe(result.revenue);
  expect(result.annual.at(-1)?.closingDebt).toBeCloseTo(0,10);
  model.sales.mix[0].collectionPhasing=[.25,0,.5,0];
  expect(evaluateRawLand(model).issue).toBe('phasing');
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


it('compares all three land arrangements on the same scenario without changing the saved choice',()=>{
 const model=synthetic();
 model.cost.landAcquisitionFees=5000;
 model.landAlternatives={purchasePricePerSqm:25,inKindValuePerSqm:25,annualRent:1200,leaseAllowsProjectedRevenue:true};
 const parsed=rawLandSchema.parse(model);
 const [purchase,lease,inKind]=compareRawLandAlternatives(parsed);
 expect(purchase).toMatchObject({issue:null,cashPurchase:200000,inKindValue:0,totalRent:0});
 expect(lease).toMatchObject({issue:null,cashPurchase:0,inKindValue:0,totalRent:3600});
 expect(inKind).toMatchObject({issue:null,cashPurchase:0,inKindValue:200000,totalRent:0});
 if(purchase.issue||lease.issue||inKind.issue)throw Error('Comparison is incomplete');
 expect(purchase.npv).toBeCloseTo(inKind.npv);
 expect(purchase.peakEquityDeficit-inKind.peakEquityDeficit).toBeCloseTo(200000);
 expect(lease.npv).toBeGreaterThan(purchase.npv);
 const changed=compareRawLandAlternatives({...parsed,landAlternatives:{...parsed.landAlternatives,annualRent:2400}})[1];
 expect(changed).toMatchObject({issue:null,totalRent:7200});
 if(changed.issue)throw Error(changed.issue);
 expect(changed.npv).toBeLessThan(lease.npv);
 expect(parsed.site.landPaymentMethod).toBe('in_kind');
 expect(parsed.site.landPricePerNetSqm).toBe(20);
});

it('shows pending inputs for an unpriced purchase and a lease with unconfirmed revenue rights',()=>{
 const model=synthetic();
 model.landAlternatives={annualRent:0};
 const [purchase,lease,inKind]=compareRawLandAlternatives(model);
 expect(purchase).toMatchObject({issue:'LAND_VALUE'});
 expect(lease).toMatchObject({issue:'LEASE_TERMS'});
 expect(inKind).toMatchObject({issue:null,inKindValue:160000});
 expect(compareRawLandAlternatives({...model,landAlternatives:{annualRent:0,leaseAllowsProjectedRevenue:true}})[1])
  .toMatchObject({issue:null,totalRent:0});
});
