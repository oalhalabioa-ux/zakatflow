import {describe,expect,it} from 'vitest';
import {createStudy,evaluateStudy,type Sector} from './engine';
import {emptyAdvanced,evaluateAdvanced,illustratedLives} from './advanced-model';
import {createIndustrialStarter} from './project-templates';
import {cloudDraftWrite} from './draft-schema';
import {FEASIBILITY_BACKUP_SCHEMA,appendImportedStudies,parseStudyBackup} from './local-drafts';
import {createRawLand,evaluateRawLand} from './raw-land';
import {createWaterModel,evaluateWater} from './water-model';
import {defaultWaterFinancingPolicy} from './water-financing';
import {defaultMonthlyLiquidity,evaluateMonthlyLiquidity,liquidityMonthLabel,monthlyLiquidityAmounts,
 type MonthlyLiquidity} from './monthly-liquidity';

const id='3cadcbaa-e175-453a-9822-83dede84ef3d';
const at=(month:number)=>({from:month,to:month});

describe('monthly feasibility liquidity',()=>{
 it('finds a shortfall hidden by the year-end cash surplus and recalculates after a timed equity injection',()=>{
  const amounts={collections:2400,investment:0,costs:-1200,workingCapital:0,debtDraw:500,
   principal:-500,interest:0,yearEnd:0,terminalPrincipal:0};
  const plan:MonthlyLiquidity={openingCash:0,cashEquity:0,timing:{collections:at(12),debtDraw:at(4),principal:at(12)}};
  const result=evaluateMonthlyLiquidity(amounts,plan);
  expect(result.rows).toHaveLength(12);
  expect(result).toMatchObject({fundingGap:600,peakMonth:11,closing:1200});
  const funded=evaluateMonthlyLiquidity(amounts,{...plan,cashEquity:600,timing:{...plan.timing,equity:at(1)}});
  expect(funded).toMatchObject({fundingGap:0,peakMonth:null,closing:1800});
 });
 it.each<Sector>(['INDUSTRIAL','COMMERCIAL','REAL_ESTATE','SERVICES','AGRICULTURE','CUSTOM'])(
  'reconciles the general %s template with its first annual cash flow',sector=>{
   const study={...createStudy(id,'General',sector),years:1,landValue:500,landTransferred:true,
    investorEquity:210,partnerCashEquity:90,workingCapital:100,monthlyUnits:100,unitPrice:2,
    variableCost:1,monthlyFixedCost:10,annualMaintenance:60,indicativeTaxRatePct:10};
   study.capex[0].amount=1000;
   const annual=evaluateStudy(study);
   const amounts=monthlyLiquidityAmounts(study)!;
   const result=evaluateMonthlyLiquidity(amounts,{...defaultMonthlyLiquidity,cashEquityFromStudy:true});
   expect(amounts).toMatchObject({investment:-1100,variableCosts:-1200,costs:-180,general:{basis:'simple',cashEquity:300}});
   expect(result.closing).toBeCloseTo(annual.flows[0]+annual.landAsset+annual.annual[0].freeCashFlow+annual.cashEquity);
   expect(result.rows[11].yearEnd).toBeCloseTo(100-annual.annual[0].taxEstimate);
  });
 it('retains dairy procurement costs and annual cash while later collections raise the peak funding need',()=>{
  const study={...createIndustrialStarter(id,'Dairy','DAIRY_CHEESE'),monthlyUnits:100,unitPrice:2,
   variableCost:1,monthlyFixedCost:20,investorEquity:1000};
  study.capex[0].amount=1000;
  const amounts=monthlyLiquidityAmounts(study)!;
  const plan:MonthlyLiquidity={...defaultMonthlyLiquidity,cashEquity:50,cashEquityFromStudy:true,
   timing:{variableCosts:{from:1,to:6}}};
  const prompt=evaluateMonthlyLiquidity(amounts,plan);
  const delayed=evaluateMonthlyLiquidity(amounts,{...plan,timing:{...plan.timing,collections:{from:4,to:12}}});
  expect(delayed.rows[0]).toMatchObject({variableCosts:-200,costs:-20,equity:1000});
  expect(delayed).toMatchObject({fundingGap:660,peakMonth:3});
  expect(delayed.fundingGap).toBeGreaterThan(prompt.fundingGap);
  expect(delayed.closing).toBeCloseTo(prompt.closing);
  expect(delayed.closing).toBeCloseTo(960);
  expect(cloudDraftWrite.parse({study:{...study,monthlyLiquidity:plan}}).study.monthlyLiquidity).toEqual(plan);
 });
 it('reconciles advanced debt service and working capital using capacity inputs',()=>{
  const study={...createStudy(id,'Advanced'),unitPrice:4,variableCost:1,monthlyFixedCost:20,
   investorLoan:300,otherDebt:200,investorEquity:600,volumeGrowthPct:10,years:2,
   advanced:{...emptyAdvanced(),mode:'CAPACITY' as const,capacityMonthly:100,utilisationPct:50,
    lives:{...illustratedLives},debtYears:2,debtRatePct:10,
    workingCapitalPolicy:{mode:'DAYS' as const,receivableDays:15,inventoryDays:0,payableDays:0}}};
  study.capex[0].amount=1000;
  const advanced=evaluateAdvanced(study);
  const amounts=monthlyLiquidityAmounts(study)!;
  const plan:MonthlyLiquidity={...defaultMonthlyLiquidity,cashEquityFromStudy:true,
   timing:{debtDraw:at(4),principal:at(12),interest:at(12)}};
  const result=evaluateMonthlyLiquidity(amounts,plan);
  expect(amounts).toMatchObject({collections:2400,principal:-250,interest:-50,general:{basis:'advanced'}});
  expect(amounts.workingCapital).toBeCloseTo(-advanced.annual[0].workingCapitalMovement);
  expect(result.rows[3].debtDraw).toBe(500);
  expect(result.rows[11]).toMatchObject({principal:-250,interest:-50});
  expect(result.closing).toBeCloseTo(-advanced.cashNeed+1100+advanced.annual[0].equityFcf);
  const incomplete=monthlyLiquidityAmounts({...study,advanced:undefined})!;
  expect(incomplete.general?.basis).toBe('simple');
  expect(incomplete.interest).toBe(0);
 });
 it('reconciles water startup cash, operating cash, regular and terminal loan settlements without counting in-kind land',()=>{
  const water=createWaterModel();
  Object.assign(water.capex,{line:1000,workingCapital:100});
  Object.assign(water.deal,{landValue:700,landMode:'transfer',investorLoan:500,loanInterest:10,loanYears:2,loanStart:1});
  Object.assign(water.ops,{horizon:1,bottlesHour:100,hoursDay:1,daysMonth:20,bottlesCarton:10,priceCarton:2,
   variableCarton:1,util:[100],nwcPct:10,taxRate:10});
  water.financingPolicy={...defaultWaterFinancingPolicy(),terminalDebt:'SETTLE',interestTaxMode:'PAID'};
  const yearly=evaluateWater(water);
  const amounts=monthlyLiquidityAmounts({...createStudy(id,'Water'),water})!;
  const plan={...defaultMonthlyLiquidity,cashEquity:600};
  const monthly=evaluateMonthlyLiquidity(amounts,plan);
  expect(amounts).toMatchObject({investment:-1100,debtDraw:500,interest:-50,principal:-250,terminalPrincipal:-250});
  expect(monthly.rows[11].principal).toBeCloseTo(-250-250/12,8);
  expect(monthly.closing).toBeCloseTo(yearly.annual[0].afterDebt,8);
 });
 it.each(['cash','in_kind'] as const)('reconciles land cash and loan flows for %s acquisition',payment=>{
  const rawLand=createRawLand();
  rawLand.site={...rawLand.site,areaAfterPriorTransfers:1000,landPricePerNetSqm:8,landPaymentMethod:payment};
  rawLand.cost.developmentPerNetSqm=4;
  rawLand.finance.facility=3000;
  rawLand.quantityDevelopment={roadLength:0,networkLength:0,serviceArea:0,serviceAreaFromSite:true,assumptionSource:'',
   budget:{enabled:false,items:[]},landTiming:'YEAR0'};
  const yearly=evaluateRawLand(rawLand);
  if(yearly.issue)throw new Error(yearly.issue);
  const amounts=monthlyLiquidityAmounts({...createStudy(id,'Land','REAL_ESTATE'),rawLand})!;
  const monthly=evaluateMonthlyLiquidity(amounts,defaultMonthlyLiquidity);
  expect(amounts.investment).toBeCloseTo(yearly.financeMetrics!.initialEquity,8);
  expect(amounts.interest).toBeCloseTo(-yearly.annual[0].interest,8);
  expect(monthly.closing).toBeCloseTo(yearly.annual[0].cumulativeEquity,8);
 });
 it('restores the optional timing through backup, copy and cloud validation and rejects reversed ranges',()=>{
  const original={...createStudy(id,'Water'),water:createWaterModel()};
  const plan={startMonth:'2026-11',openingCash:100,cashEquity:1000,timing:{collections:{from:3,to:12}}};
  const restored=parseStudyBackup(JSON.parse(JSON.stringify({
   schema:FEASIBILITY_BACKUP_SCHEMA,studies:[{...original,monthlyLiquidity:plan}]
  })))!;
  expect(cloudDraftWrite.parse({study:restored[0]}).study.monthlyLiquidity).toEqual(plan);
  expect(cloudDraftWrite.parse({study:original}).study.monthlyLiquidity).toBeUndefined();
  const copied=appendImportedStudies([original],restored,()=>'17f24edc-3c5a-409d-8609-8ebf4e40dc8b')!;
  expect(copied.studies[0].monthlyLiquidity).toEqual(plan);
  expect(cloudDraftWrite.safeParse({study:{...original,monthlyLiquidity:{...plan,timing:{collections:{from:12,to:3}}}}}).success).toBe(false);
  expect(liquidityMonthLabel(plan.startMonth,3,'en')).toBe('Jan 2027');
 });
});
