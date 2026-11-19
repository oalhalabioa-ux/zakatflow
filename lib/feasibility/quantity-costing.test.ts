import {describe,it,expect} from 'vitest';
import {createWaterModel,evaluateWater,effectiveWaterInputs,legacyWaterFinancialPolicy,waterPeakFundingGap,type WaterModel} from './water-model';
import {createRawLand,evaluateRawLand} from './raw-land';
import {quantityBudgetSchema,evaluateQuantityBudget,type QuantityLine} from './quantity-costs';
import {quantityPresets} from './quantity-presets';
import {costingReportRows} from './costing-report';
import {createIndustrialStarter,createRawLandStarter} from './project-templates';
import {feasibilityDraftSchema} from './draft-schema';
import {handoffReadiness} from './handoff';
import {applyWaterCapexQuote} from './water-capex';

const row=(id:string,basis:QuantityLine['basis'],quantity:number,unitCost:number,category='buildings'):QuantityLine=>
 ({id,name:'Synthetic '+id,basis,quantity,unitCost,category,unit:basis==='MANUAL'?'unit':'m²',source:'Synthetic independent quote 2026-01-01'});
function water(){
 const m=createWaterModel();
 Object.assign(m.deal,{landArea:1000,landValue:123,investorLoan:20000,loanYears:4,loanStart:1,loanInterest:5});
 Object.assign(m.capex,{buildings:999999,line:888888,workingCapital:5000,contingencyPct:10});
 Object.assign(m.ops,{bottlesHour:1200,hoursDay:8,daysMonth:25,bottlesCarton:12,litersBottle:1,priceCarton:12,variableCarton:3,
  fixedMonth:98765,life:10,discountRate:10,horizon:5,nwcPct:10,util:[50,60,70,80,90]});
 m.quantityCosting={builtArea:200,capital:{enabled:true,items:[row('building','BUILT_AREA',1,300),row('equipment','MANUAL',2,5000,'line')]},
  fixed:{enabled:true,items:[row('workers','MANUAL',4,500,'labour')]},materialsEnabled:false,materialSource:'',landByArea:true,landUnitPrice:20,landSource:'Synthetic appraisal',assumptionSource:'Synthetic documented operations, sales and finance'};
 return m;
}
function land(){
 const m=createRawLand();
 Object.assign(m.site,{areaAfterPriorTransfers:1000,excludedValley:200,serviceRatio:.25,landPricePerNetSqm:10});
 m.project={years:4,startYear:2030,discountRate:.1};
 m.sales.mix=[{name:'Synthetic use',enabled:true,share:1,price:100,annualGrowthAdjustment:0}];
 m.cost.developmentPerNetSqm=999;m.cost.developmentItems=[{name:'Old manual',quantity:999,unitCost:999}];
 m.quantityDevelopment={roadLength:100,networkLength:50,serviceArea:999,serviceAreaFromSite:true,assumptionSource:'Synthetic infrastructure and sales study',budget:{enabled:true,items:[
  row('roads','ROAD_LENGTH',1,20,'roads'),row('grading','NET_AREA',1,3,'earthworks'),row('network','NETWORK_LENGTH',1,10,'water')
 ]}};
 return m;
}
describe('quantity costing: synthetic water acceptance',()=>{
 it('links built area, equipment and land once, replacing retained manual amounts',()=>{
  const m=water(),before=JSON.stringify(m),r=evaluateWater(m);
  expect(r).toMatchObject({hard:70000,contingency:7000,investment:77000,cashRequired:82000,land:20000,shareholderLoan:20000,investorEquity:62000,totalEquity:82000,totalLoan:20000});
  expect(r.flows[0]).toBe(-102000);expect(r.partnerShare).toBeCloseTo(20000/82000*100);
  expect(r.annual[0].fixed).toBe(24000);expect(r.annual[0].principal).toBe(5000);expect(r.annual[0].interest).toBe(1000);
  expect(r.annual[0].dscr).toBeCloseTo(r.annual[0].freeCashFlow/6000);
  expect(JSON.stringify(m)).toBe(before);
  expect(effectiveWaterInputs(m).readiness.ready).toBe(true);
 });
 it('matches the entire original-method output with the identical effective manual inputs',()=>{
  const m=water(),e=effectiveWaterInputs(m),manual:WaterModel={...m,capex:e.capex,ops:e.ops,deal:e.deal};delete manual.quantityCosting;
  const {purchaseLand,costingReadiness,...actual}=evaluateWater(m);
  expect(actual).toEqual(evaluateWater(manual));expect(purchaseLand).toBe(0);expect(costingReadiness?.ready).toBe(true);
  expect(actual.irr).not.toBeNull();
  for(const scenario of m.scenarios){
   const {purchaseLand:_p,costingReadiness:_r,...scenarioResult}=evaluateWater(m,scenario);
   expect(scenarioResult).toEqual(evaluateWater(manual,scenario));
  }
 });
 it('recalculates building dependencies including maintenance, depreciation, financing, NPV and IRR',()=>{
  const m=water();m.ops.maintenancePct=2;const a=evaluateWater(m);
  m.quantityCosting!.builtArea=300;const b=evaluateWater(m);
  expect(b.hard-a.hard).toBe(30000);expect(b.cashRequired-a.cashRequired).toBe(33000);
  expect(b.annual[0].depreciation-a.annual[0].depreciation).toBe(3300);
  expect(b.annual[0].maintenance-a.annual[0].maintenance).toBe(660);
  expect(b.investorEquity-a.investorEquity).toBe(33000);expect(b.npv).toBeLessThan(a.npv);expect(b.irr!).toBeLessThan(a.irr!);
  expect(b.partnerShare!).toBeLessThan(a.partnerShare!);
  m.quantityCosting!.builtArea=2000;expect(effectiveWaterInputs(m).readiness.ready).toBe(true); // Total floor area may span multiple storeys.
 });
 it('classifies cash purchase outside land-partner equity and includes acquisition fees exactly once',()=>{
  const m=water(),a=evaluateWater(m);m.deal.landMode='purchase';m.deal.acquisitionFees=1000;const b=evaluateWater(m);
  expect(b).toMatchObject({purchaseLand:21000,cashRequired:103000,land:0,investorEquity:83000,partnerShare:0,investorShare:100});
  expect(b.flows[0]).toBe(-103000);expect(b.npv-a.npv).toBeCloseTo(-1000);expect(b.annual).toEqual(a.annual);
  m.deal.landMode='lease';m.deal.leaseMonth=400;const lease=evaluateWater(m);
  expect(lease.purchaseLand).toBe(0);expect(lease.land).toBe(0);expect(lease.annual[0].fixed).toBe(28800);
  m.deal.landMode='right';m.deal.rightValue=7000;expect(evaluateWater(m).land).toBe(7000);
 });
 it('leaves manual calculations recoverable and declines quote replacement while the quantity mode is active',()=>{
  const m=water();m.quantityCosting!.capital.enabled=false;m.quantityCosting!.fixed.enabled=false;m.quantityCosting!.landByArea=false;
  const {quantityCosting,...legacy}=m;const {purchaseLand:_p,costingReadiness:_r,...actual}=evaluateWater(m);
  expect(actual).toEqual(evaluateWater(legacy));
  expect(m.capex.buildings).toBe(999999);expect(m.ops.fixedMonth).toBe(98765);expect(m.deal.landValue).toBe(123);
  quantityCosting!.capital.enabled=true;
  expect(applyWaterCapexQuote(m,[], 'quote','line','USD',true)).toBeNull();
 });
 it('integrates materials, energy, raw water and trips without adding the old variable cost',()=>{
  const m=water();m.ops.waterLossPct=20;
  m.operationsPlan={sourceName:'Synthetic source',permitReference:'Synthetic permit',packagingLossPct:20,kwhPerThousandBottles:10,
   cartonsPerTrip:100,roundTripKm:20,unitCosts:{bottle:.1,cap:.02,label:.01,carton:.5,kwh:.2,rawWaterM3:2,distributionKm:.5}};
  m.quantityCosting!.materialsEnabled=true;m.quantityCosting!.materialSource='Synthetic prices';
  const e=effectiveWaterInputs(m),r=evaluateWater(m);
  expect(e.material!.packaging).toBeCloseTo(2.575);expect(e.material!.electricity).toBeCloseTo(.024);expect(e.material!.water).toBeCloseTo(.03);expect(e.material!.distribution).toBeCloseTo(.1);
  expect(e.ops.variableCarton).toBeCloseTo(2.729);expect(r.annual[0].variable).toBeCloseTo(r.annual[0].volume*2.729);
  expect(m.ops.variableCarton).toBe(3);
 });
 it('applies finished-product waste only when explicitly enabled and keeps the full production cost',()=>{
  const m=water();m.operationsPlan={sourceName:'Synthetic source',permitReference:'Synthetic permit',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,finishedBottleLossPct:10};
  m.ops.licensedWaterM3Day=20;const legacy=evaluateWater(m);m.quantityCosting!.productionEnabled=true;const detailed=evaluateWater(m);
  expect(detailed.annual[0].revenue).toBeCloseTo(legacy.annual[0].revenue*.9);expect(detailed.annual[0].variable).toBe(legacy.annual[0].variable);
  expect(detailed.npv).toBeLessThan(legacy.npv);m.ops.licensedWaterM3Day=1;
  expect(effectiveWaterInputs(m).readiness.blockers).toContain('LICENSED_WATER_CAPACITY');
  m.operationsPlan.sourceType='well';expect(effectiveWaterInputs(m).readiness.blockers).toContain('PUMP_INPUTS');
  m.operationsPlan.pumpingM3Hour=1;m.operationsPlan.sourceHoursDay=1;expect(effectiveWaterInputs(m).readiness.blockers).toContain('PUMP_CAPACITY');
  m.ops.hoursDay=25;expect(effectiveWaterInputs(m).readiness.blockers).toContain('OPERATING_INPUTS');
 });
 it('reconciles the water funding gap as area, capacity, input price and collection terms change',()=>{
  const m=water();
  Object.assign(m.capex,{workingCapital:100,contingencyPct:0});
  Object.assign(m.deal,{landValue:0,investorLoan:200,loanYears:2,loanInterest:10});
  Object.assign(m.ops,{bottlesHour:12,hoursDay:1,daysMonth:10,priceCarton:10,life:2,horizon:2,util:[50,100]});
  const q=m.quantityCosting!;
  Object.assign(q,{builtArea:20,landByArea:false,materialsEnabled:true,materialSource:'Synthetic packaging costs'});
  q.capital.items[0].unitCost=30;q.capital.items[1].unitCost=200;q.fixed.items[0].unitCost=10;
  m.operationsPlan={sourceName:'',permitReference:'',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,
   collectionDays:60,unitCosts:{bottle:0,cap:0,label:0,carton:4,kwh:0,rawWaterM3:0,distributionKm:0}};
  m.financialPolicy={...legacyWaterFinancialPolicy(),workingCapitalMode:'CYCLE',depreciationMode:'CAPPED',daysPerYear:360};
  const a=evaluateWater(m);
  expect(a).toMatchObject({investment:1000,cashRequired:1100,investorEquity:900,capacity:120});
  expect(a.flows).toEqual([-1100,-120,140]);
  expect(a.annual.map(y=>y.afterDebt)).toEqual([-240,30]);
  expect(waterPeakFundingGap(a.annual)).toBe(240);
  const s=createIndustrialStarter('793e128a-66d1-44ec-9380-49acf36ed59a','Synthetic','BOTTLED_WATER');
  s.water=m;
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(false);
  q.builtArea=30;m.ops.bottlesHour=24;
  const b=evaluateWater(m);
  expect(b).toMatchObject({investment:1300,cashRequired:1400,investorEquity:1200,capacity:240});
  expect(b.annual.map(y=>y.afterDebt)).toEqual([20,650]);
  expect(waterPeakFundingGap(b.annual)).toBe(0);
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(true);
  m.operationsPlan.unitCosts!.carton=5;m.operationsPlan.collectionDays=90;
  const c=evaluateWater(m);
  expect(c.annual.map(y=>y.afterDebt)).toEqual([-200,310]);
  expect(waterPeakFundingGap(c.annual)).toBe(200);
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(false);
 });
 it('blocks undocumented prices and high risks in investment readiness without losing the draft',()=>{
  const s=createIndustrialStarter('793e128a-66d1-44ec-9380-49acf36ed59a','Synthetic','BOTTLED_WATER');s.water=water();
  s.water.quantityCosting!.capital.items[0].source='';s.water.quantityCosting!.assumptionSource='';
  s.risks=[{id:'risk',title:'Synthetic risk',impact:5,likelihood:5,response:'',status:'OPEN'}];
  const checks=handoffReadiness(s).checks;
  for(const key of ['quantity','assumptions','risk'])expect(checks.find(x=>x.key===key)?.passed).toBe(false);
  expect(feasibilityDraftSchema.safeParse(s).success).toBe(true);
 });
});
describe('quantity costing: synthetic raw-land acceptance',()=>{
 it('computes roads, networks and net-area earthworks once and preserves legacy rates',()=>{
  const m=land(),before=JSON.stringify(m),r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);
  expect(r).toMatchObject({net:800,saleArea:600,land:8000,costs:{development:4900},totalCost:12900,revenue:60000});
  expect(r.annual.reduce((s,x)=>s+x.cashCost,0)).toBe(4900);expect(JSON.stringify(m)).toBe(before);
  m.quantityDevelopment!.budget.items.push(row('services','SERVICE_AREA',1,4,'services'));
  const services=evaluateRawLand(m);if(services.issue)throw Error(services.issue);
  expect(services.costs.development).toBe(5700); // 200 m² × 4, not the stale 999 override.
  m.site.serviceRatio=.5;const changed=evaluateRawLand(m);if(changed.issue)throw Error(changed.issue);
  expect(changed.costs.development).toBe(6500);expect(changed.saleArea).toBe(400);
 });
 it('matches the entire legacy engine output for equal development amounts and preserves original phasing',()=>{
  const m=land(),manual={...m,cost:{...m.cost,developmentItems:[{name:'Equivalent total',quantity:1,unitCost:4900}]}};delete manual.quantityDevelopment;
  const r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);const {acquisitionArea,quantityReadiness,financeMetrics,...actual}=r;
  expect(acquisitionArea).toBe(800);expect(quantityReadiness?.ready).toBe(true);expect(actual).toEqual(evaluateRawLand(manual));
  for(const years of [1,2,7,15]){m.project.years=years;const v=evaluateRawLand(m);if(v.issue)throw Error(v.issue);expect(v.annual.reduce((s,x)=>s+x.cashCost,0)).toBeCloseTo(4900,8);}
 });
 it('separates contractual acquisition area from saleable area and cash/in-kind financing',()=>{
  const m=land();m.site.acquisitionBasis='GROSS';let r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);
  expect(r.land).toBe(10000);expect(r.saleArea).toBe(600);const inKindCash=r.annual[0].equityCash;
  m.site.landPaymentMethod='cash';r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);expect(r.annual[0].equityCash).toBe(inKindCash-10000);
  m.site.acquisitionBasis='MANUAL';m.site.acquisitionArea=900;r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);expect(r.land).toBe(9000);
 });
 it('allocates infrastructure items independently and rejects incomplete item phases',()=>{
  const m=land();m.quantityDevelopment!.budget.items[0].phasing=[1,0,0,0];
  m.quantityDevelopment!.budget.items[1].phasing=[0,0,0,1];m.quantityDevelopment!.budget.items[2].phasing=[0,0,1,0];
  const a=evaluateRawLand(m);if(a.issue)throw Error(a.issue);expect(a.annual.map(x=>x.cashCost)).toEqual([2000,0,500,2400]);
  m.project.years=2;const b=evaluateRawLand(m);if(b.issue)throw Error(b.issue);expect(b.annual.map(x=>x.cashCost)).toEqual([2000,2900]);
  m.quantityDevelopment!.budget.items[0].phasing=[.1,0,0,0];expect(evaluateRawLand(m).issue).toBe('phasing');
 });
 it('makes year-zero investment timing explicit and reconciles payback, IRR, NPV and DSCR',()=>{
  const m=land();m.finance={...m.finance,facility:3000,interestMode:'dynamic',benchmarkRate:.1};
  const before=evaluateRawLand(m);if(before.issue)throw Error(before.issue);expect(before.financeMetrics?.payback).toBeNull();
  m.quantityDevelopment!.landTiming='YEAR0';const after=evaluateRawLand(m);if(after.issue)throw Error(after.issue);
  expect(after.financeMetrics!.projectFlows[0]).toBe(-8000);
  expect(after.annual[0].projectCash-before.annual[0].projectCash).toBe(8000);
  expect(after.npv-before.npv).toBeCloseTo(-8000+8000/1.1,6);
  expect(after.financeMetrics!.payback).toBeGreaterThan(0);expect(after.irr).not.toBeNull();
  expect(after.financeMetrics!.projectFlows.reduce((s,v,i)=>s+v/(1+after.irr!/100)**i,0)).toBeCloseTo(0,6);
  const y=after.annual[0];expect(after.financeMetrics!.dscr[0]).toBeCloseTo((y.cashCollected-y.cashCost+y.interest-y.performanceFee)/(y.repayment+y.interest));
  m.finance.facility=0;const zero=evaluateRawLand(m);if(zero.issue)throw Error(zero.issue);expect(zero.financeMetrics!.dscr.every(x=>x===null)).toBe(true);
  m.site.landPaymentMethod='cash';
  const s=createRawLandStarter('793e128a-66d1-44ec-9380-49acf36ed59b','Synthetic');s.rawLand=m;
  const financialBefore=evaluateRawLand(m);if(financialBefore.issue)throw Error(financialBefore.issue);
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(false);
  m.quantityDevelopment!.committedEquity=financialBefore.peakEquityDeficit;
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(true);
  expect(evaluateRawLand(m)).toEqual(financialBefore); // Funding commitment is evidence, not extra project revenue or ownership.
 });
 it('carries the early collection repayment target to later staged draws',()=>{
  const m=land();
  m.project.years=2;
  m.quantityDevelopment!.landTiming='YEAR0';
  m.site.landPaymentMethod='cash';
  m.sales.mix[0].salesPhasing=[1,0,0,0];
  m.sales.mix[0].collectionPhasing=[.5,.5,0,0];
  m.finance={...m.finance,facility:3000,loanDrawFirstYear:.25,interestMode:'dynamic',benchmarkRate:.1};
  const a=evaluateRawLand(m);if(a.issue)throw Error(a.issue);
  expect(a.annual.map(y=>[y.cashCollected,y.draw,y.repayment,y.closingDebt,y.interest]))
   .toEqual([[30000,750,750,0,0],[30000,2250,2250,0,0]]);
  expect(a.financeMetrics!.projectFlows).toEqual([-8000,27550,27550]);
  expect(a.peakEquityDeficit).toBe(8000);
  expect(a.npv).toBeCloseTo(-8000+27550/1.1+27550/1.21);
  m.quantityDevelopment!.roadLength=150;m.quantityDevelopment!.networkLength=70;
  m.site.serviceRatio=.5;
  m.quantityDevelopment!.budget.items[0].phasing=[1,0,0,0];
  const b=evaluateRawLand(m);if(b.issue)throw Error(b.issue);
  expect(b).toMatchObject({saleArea:400,revenue:40000,costs:{development:6100},peakEquityDeficit:8000});
  expect(b.annual.map(y=>y.cashCost)).toEqual([4550,1550]);
  expect(b.financeMetrics!.projectFlows).toEqual([-8000,15450,18450]);
  expect(b.annual.at(-1)!.closingDebt).toBe(0);
 });
 it('allocates detailed land repayment by cash value even for immediate collection',()=>{
  const m=land();
  m.project.years=2;
  m.sales.mix=[
   {name:'First use',enabled:true,share:.5,price:100,annualGrowthAdjustment:0,salesPhasing:[1,0,0,0]},
   {name:'Second use',enabled:true,share:.5,price:300,annualGrowthAdjustment:0,salesPhasing:[0,0,0,1]}
  ];
  m.finance={...m.finance,facility:3000,loanDrawFirstYear:1};
  const r=evaluateRawLand(m);if(r.issue)throw Error(r.issue);
  expect(r.annual.map(y=>[y.soldArea,y.cashCollected,y.repayment,y.closingDebt]))
   .toEqual([[300,30000,750,2250],[300,90000,2250,0]]);
 });
 it('separates land project and equity returns without treating in-kind land as cash funding',()=>{
  const m=land();m.project.years=2;
  m.quantityDevelopment!.landTiming='YEAR0';
  m.finance={...m.finance,facility:3000,loanDrawFirstYear:1,interestMode:'dynamic',benchmarkRate:.1,arrangementRate:.02};
  m.waterfall.incentiveRate=.1;
  const a=evaluateRawLand(m);if(a.issue)throw Error(a.issue);
  const returns=a.financeMetrics!.returns!;
  expect(a.annual.map(y=>y.interest)).toEqual([75,75]);
  expect(a.incentive).toBe(4689);
  expect(returns.unleveredFlows).toEqual([-8000,27550,22840]);
  expect(returns.equityFlows).toEqual([-8000,28945,21256]);
  expect(a.financeMetrics!.initialEquity).toBe(0);
  expect(a.peakEquityDeficit).toBe(0);
  expect(returns.unleveredNpv).toBeCloseTo(-8000+27550/1.1+22840/1.21);
  for(const [series,irr] of [[returns.unleveredFlows,returns.unleveredIrr],[returns.equityFlows,returns.equityIrr]] as const){
   expect(irr).not.toBeNull();
   expect(series.reduce((sum,flow,i)=>sum+flow/(1+irr!/100)**i,0)).toBeCloseTo(0,6);
  }
  m.site.landPaymentMethod='cash';
  const cash=evaluateRawLand(m);if(cash.issue)throw Error(cash.issue);
  expect(cash.financeMetrics!.returns).toEqual(returns);
  expect(cash.peakEquityDeficit).toBe(8000);
  m.finance.facility=0;
  const noDebt=evaluateRawLand(m);if(noDebt.issue)throw Error(noDebt.issue);
  expect(noDebt.financeMetrics!.returns!.unleveredFlows).toEqual(returns.unleveredFlows);
  expect(noDebt.financeMetrics!.returns!.equityFlows).toEqual(returns.unleveredFlows);
  m.quantityDevelopment!.landTiming='YEAR1';
  const legacyTiming=evaluateRawLand(m);if(legacyTiming.issue)throw Error(legacyTiming.issue);
  expect(legacyTiming.financeMetrics!.returns).toBeUndefined();
 });
 it('propagates area, scenario multiplier, growth, collection delay and financing without cost duplication',()=>{
  const m=land();m.sales.scenarios[2].costMultiplier=1.2;m.cost.contingencyRate=.1;
  m.finance={...m.finance,facility:3000,benchmarkRate:.1,interestMode:'dynamic'};
  m.sales.mix[0].collectionPhasing=[.5,.5,0,0];const before=evaluateRawLand(m);if(before.issue)throw Error(before.issue);
  expect(before.costs.development).toBe(5880);expect(before.costs.contingency).toBe(588);
  expect(before.annual.reduce((s,x)=>s+x.draw,0)).toBe(3000);expect(before.annual.reduce((s,x)=>s+x.repayment,0)).toBeCloseTo(3000);
  expect(before.annual.at(-1)!.closingDebt).toBeCloseTo(0);expect(before.annual.at(-1)!.receivables).toBeCloseTo(0);
  m.sales.scenarios[2].annualGrowth=.1;const higher=evaluateRawLand(m);if(higher.issue)throw Error(higher.issue);expect(higher.npv).toBeGreaterThan(before.npv);
  m.site.areaAfterPriorTransfers=2000;const larger=evaluateRawLand(m);if(larger.issue)throw Error(larger.issue);
  expect(larger.costs.development).toBe((2000+1800*3+500)*1.2);expect(larger.saleArea).toBe(1350);
 });
});
describe('quantity costing: persistence, evidence and neutral public templates',()=>{
 it.each(['water','land'] as const)('ships only zero-valued, independently allocated %s suggestions',sector=>{
  const first=quantityPresets(sector),second=quantityPresets(sector);expect(first.length).toBeGreaterThan(5);
  expect(first.every(x=>x.quantity===0&&x.unitCost===0&&x.source==='')).toBe(true);
  first[0].unitCost=900;expect(second[0].unitCost).toBe(0);
 });
 it('round-trips both detailed models through cloud/JSON schemas and retains cost evidence for reporting',()=>{
  const w=createIndustrialStarter('793e128a-66d1-44ec-9380-49acf36ed59a','Synthetic','BOTTLED_WATER');w.water=water();
  const l=createRawLandStarter('793e128a-66d1-44ec-9380-49acf36ed59b','Synthetic');l.rawLand=land();
  for(const s of [w,l]){
   const restored=feasibilityDraftSchema.parse(JSON.parse(JSON.stringify(s)));expect(restored).toEqual(s);
   expect(costingReportRows(restored)).toEqual(costingReportRows(s));expect(costingReportRows(s)).toHaveLength(3);
   expect(costingReportRows(s).every(x=>x.source.includes('Synthetic'))).toBe(true);
  }
 });
 it('rejects negative/nonfinite quantities and prevents undocumented, empty, duplicated or overflowing budgets from readiness',()=>{
  expect(quantityBudgetSchema.safeParse({enabled:true,items:[row('a','MANUAL',-1,1)]}).success).toBe(false);
  expect(quantityBudgetSchema.safeParse({enabled:true,items:[row('a','MANUAL',1,Infinity)]}).success).toBe(false);
  expect(evaluateQuantityBudget({enabled:true,items:[]},{}).ready).toBe(false);
  const a=row('a','MANUAL',1e12,1e12);expect(evaluateQuantityBudget({enabled:true,items:[a,a]},{}).blockers).toEqual(expect.arrayContaining(['DUPLICATE_IDS','TOTAL_LIMIT']));
 });
});
