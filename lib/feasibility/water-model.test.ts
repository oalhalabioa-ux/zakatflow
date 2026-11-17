import {describe,expect,it} from 'vitest';
import {createStudy} from './engine';
import {cloudDraftWrite,feasibilityDraftSchema} from './draft-schema';
import {appendImportedStudies,parseCloudStudyRows,parseInstitutionalCloudRows,parseLocalStudyCache,parseStudyBackup,FEASIBILITY_BACKUP_SCHEMA} from './local-drafts';
import {feasibilityCsv} from './report-export';
import {importWaterBackup} from './water-backup';
import {createWaterModel,emptyWaterOperationsPlan,evaluateWater,waterVariableCostBreakdown,waterModelSchema,waterOperationalRequirements,waterProductionBalance} from './water-model';

const existingId='3cadcbaa-e175-453a-9822-83dede84ef3d';
const newId='17f24edc-3c5a-409d-8609-8ebf4e40dc8b';
const ownerId='c8d17f6b-ef25-444c-9a3a-22a289d4b627';
const orgId='c8d17f6b-ef25-444c-9a3a-22a289d4b628';
const foreignOrg='c8d17f6b-ef25-444c-9a3a-22a289d4b629';

// Synthetic inputs evaluated by the original HTML's calc() and scenarioModel().
const fixture=createWaterModel();
Object.assign(fixture.deal,{landValue:120000,landArea:2000,rightValue:45000,licenseValue:70000,leaseMonth:2000,
 investorLoan:180000,loanInterest:7,loanYears:4,loanStart:2,extraFunding:32000,extraType:'loan'});
Object.assign(fixture.capex,{buildings:100000,line:170000,treatment:60000,power:20000,lab:10000,vehicles:25000,
 licenses:18000,others:5000,contingencyPct:8,workingCapital:42000});
Object.assign(fixture.ops,{bottlesHour:3500,hoursDay:10,daysMonth:24,bottlesCarton:12,litersBottle:.75,waterLossPct:18,
 licensedWaterM3Day:25,priceCarton:5.4,variableCarton:1.9,fixedMonth:19000,priceGrowth:4,costGrowth:3,
 fixedGrowth:2,maintenancePct:3,nwcPct:9,discountRate:13,taxRate:18,life:8,horizon:6,util:[48,58,68,78,87,94]});

const legacy={
 version:1,...fixture,meta:{name:'QA water factory',region:'QA',owner:'Analyst',asof:'2026-01-01',notes:'Test'},
 legal:[{id:'legal',title:'Water rights',group:'Water',critical:true,desc:'Verify source',assignee:'A',due:'2026-03-01',evidence:'ref',status:'review'}],
 tasks:[{id:'task',title:'Verify title',phase:'Legal',priority:'عالية',owner:'B',due:'2026-04-01',note:'Doc',status:'blocked'}],
 risks:[{id:'risk',title:'Power interruption',category:'Ops',impact:5,likelihood:4,mitigation:'Redundancy',owner:'C',status:'mitigated'}],
 quotes:[{id:'quote',vendor:'Example',category:'Line',amount:900,capacity:110,lead:8,warranty:'12 months',note:'Quote 1',status:'selected'}],
 decisions:[{id:'decision',date:'2026-02-02',title:'Land',detail:'Under discussion',owner:'D',status:'open'}],
 ui:{tab:'ops'}
};

describe('original bottled-water model financial parity',()=>{
 it('matches ownership, capital, volumes, NPV, IRR, payback and the annual profit and cash/debt schedule',()=>{
  const result=evaluateWater(fixture);
  expect(result).toMatchObject({hard:390000,contingency:31200,investment:439200,cashRequired:481200,
   land:120000,shareholderLoan:180000,totalLoan:212000,investorEquity:301200,totalEquity:421200,capacity:840000});
  expect(result.partnerShare).toBeCloseTo(28.49002849002849,9);
  expect(result.investorShare).toBeCloseTo(71.5099715099715,9);
  expect(result.waterDemand).toBeCloseTo(32.012195121951216,9);
  expect(result.npv).toBeCloseTo(5664096.39681198,5);
  expect(result.cashNpv).toBeCloseTo(5784096.39681198,5);
  expect(result.irr).toBeCloseTo(167.89949880565877,8);
  expect(result.payback).toBeCloseTo(.7578519360015974,8);
  expect(result.breakEven).toBeCloseTo(72000,5);
  expect(result.flows[0]).toBe(-601200);
  const actual=result.annual.map(y=>[
   y.revenue,y.ebitda,y.tax,y.workingCapitalMovement,y.freeCashFlow,y.principal,y.interest,y.debtBalance,y.afterDebt
  ]);
  const expected=[
   [2177280,1159200,198774,153955.2,793294.8,0,0,212000,793294.8],
   [2736115.2,1525624.8,264730.464,50295.168,1197423.168,53000,14840,159000,1129583.168],
   [3336173.568,1922619.216,336189.45888,54005.25312,1519248.504,53000,11130,106000,1455118.504],
   [3979858.82112,2352120.41736,413499.6751248,57931.6727808,1867513.0694544,53000,7420,53000,1807093.0694544],
   [4616636.2324992,2781071.835318002,490710.9303572404,57309.967024128,2219874.937936634,53000,3710,0,2163164.937936634],
   [5187613.311369217,3170195.611734985,560753.2101122973,51387.937098301,2544878.464524386,0,0,0,2544878.464524386]
  ];
  expected.forEach((row,i)=>row.forEach((number,j)=>expect(actual[i][j]).toBeCloseTo(number,5)));
 });

 it('keeps debt out of ownership and changes project NPV only for project cash flows and land',()=>{
  const base=evaluateWater(fixture);
  const equity=evaluateWater({...fixture,deal:{...fixture.deal,extraType:'equity'}});
  expect(equity).toMatchObject({totalLoan:180000,investorEquity:333200,totalEquity:453200});
  expect(equity.npv).toBe(base.npv);
  expect(equity.investorShare).toBeGreaterThan(base.investorShare!);
  const lease=evaluateWater({...fixture,deal:{...fixture.deal,landMode:'lease',investorLoan:9e6}});
  expect(lease).toMatchObject({land:0,shareholderLoan:481200,investorEquity:0,investorShare:null,partnerShare:null});
  expect(lease.npv).toBeCloseTo(base.cashNpv,5);
  const right=evaluateWater({...fixture,deal:{...fixture.deal,landMode:'right'}});
  expect(right.land).toBe(45000);
  expect(right.npv-base.npv).toBeCloseTo(75000,5);
 });

 it('matches editable scenarios and NPV sensitivity without mutating inputs',()=>{
  const before=JSON.stringify(fixture);
  const expected=[
   [3184471.0245919134,107.00281004201604,1551312],
   [5664096.39681198,167.89949880565877,2177280],
   [7595664.625696801,219.43830497457145,2743372.8]
  ];
  fixture.scenarios.forEach((scenario,i)=>{
   const result=evaluateWater(fixture,scenario);
   expect(result.npv).toBeCloseTo(expected[i][0],5);
   expect(result.irr).toBeCloseTo(expected[i][1],8);
   expect(result.annual[0].revenue).toBeCloseTo(expected[i][2],5);
   expect(result.annual.every(y=>y.utilization<=100)).toBe(true);
  });
  expect(evaluateWater(fixture,{volume:70,price:90,cost:100}).npv).toBeCloseTo(2763621.4169871425,5);
  expect(evaluateWater(fixture,{volume:130,price:110,cost:100}).npv).toBeCloseTo(8655228.100039627,5);
  expect(JSON.stringify(fixture)).toBe(before);
 });

 it('reports debt service coverage only in servicing years and preserves negative coverage',()=>{
  const result=evaluateWater(fixture);
  expect(result.annual[0].dscr).toBeNull();
  expect(result.annual[1].dscr).toBeCloseTo(1197423.168/67840,10);
  expect(result.annual[5].dscr).toBeNull();
  const loss=evaluateWater({...fixture,ops:{...fixture.ops,priceCarton:.01}});
  expect(loss.annual[1].dscr).toBeLessThan(0);
  expect(evaluateWater(createWaterModel()).annual.every(year=>year.dscr===null)).toBe(true);
 });

 it('keeps unfinished inputs and an all-loss forecast from implying a measurable IRR',()=>{
  expect(evaluateWater(createWaterModel())).toMatchObject({ready:false,irr:null,investorShare:null});
  expect(evaluateWater({...fixture,ops:{...fixture.ops,priceCarton:.01}}).irr).toBeNull();
 });
});

describe('original water backup recovery',()=>{
 it('round-trips typed imported data through local, personal and institutional storage validation',()=>{
  const study=importWaterBackup(legacy,existingId)!;
  expect(study).toMatchObject({id:existingId,currency:'USD',preparedBy:'Analyst',studyDate:'2026-01-01',notes:'Test',
   water:fixture,legal:[{status:'UNDER_REVIEW',owner:'A',critical:true,notes:'ref'}],
   tasks:[{status:'BLOCKED',priority:'HIGH',phase:'Legal',notes:'Doc'}],
   risks:[{status:'MITIGATED',category:'Ops',owner:'C'}],
   suppliers:[{status:'SELECTED',capacity:110,leadDays:8,warranty:'12 months'}],
   decisions:[{status:'OPEN',owner:'D',notes:'Under discussion'}]
  });
  expect(cloudDraftWrite.parse({study,revision:2}).study).toEqual(study);
  const cache={version:1,studies:[study],selectedId:study.id};
  expect(parseLocalStudyCache(JSON.parse(JSON.stringify(cache)))?.studies).toEqual([study]);
  expect(parseStudyBackup({schema:FEASIBILITY_BACKUP_SCHEMA,studies:[study]})).toEqual([study]);
  expect(parseCloudStudyRows([{id:study.id,study,owner_user_id:ownerId,revision:1}])?.[0].study).toEqual(study);
  const orgRow={id:study.id,study,organization_id:orgId,owner_user_id:null,created_by_user_id:ownerId,
   title:study.title,revision:1,updated_at:study.updatedAt};
  expect(parseInstitutionalCloudRows([orgRow],orgId)?.[0].study).toEqual(study);
  expect(parseInstitutionalCloudRows([orgRow],foreignOrg)).toBeNull();
 });

 it('appends fresh IDs, preserves existing documents and rejects collisions or ownership fields',()=>{
  const existing=createStudy(existingId,'Saved dairy draft');
  const saved=JSON.stringify(existing);
  const copy=importWaterBackup(legacy,existingId)!;
  const result=appendImportedStudies([existing],[copy],()=>newId);
  expect(result?.selectedId).toBe(newId);
  expect(result?.studies[0]).toMatchObject({id:newId,water:fixture});
  expect(JSON.stringify(result?.studies[1])).toBe(saved);
  expect(appendImportedStudies([existing],[copy],()=>existingId)).toBeNull();
  expect(importWaterBackup({...legacy,organizationId:orgId},existingId)).toBeNull();
  expect(importWaterBackup({...legacy,deal:{...legacy.deal,role:'OWNER'}},existingId)).toBeNull();
  expect(importWaterBackup({...legacy,ops:{...legacy.ops,util:[101]}},existingId)).toBeNull();
  expect(importWaterBackup({...legacy,tasks:[...legacy.tasks,...legacy.tasks]},existingId)).toBeNull();
  expect(importWaterBackup({...legacy,capex:{...legacy.capex,buildings:Infinity}},existingId)).toBeNull();
  expect(feasibilityDraftSchema.safeParse({...copy,organization_id:orgId}).success).toBe(false);
 });

 it('protects exported spreadsheet text without changing negative financial amounts',()=>{
  expect(feasibilityCsv([['=SUM(1,2)','  +cmd','hello, "test"',-12]])).toBe(
   '\uFEFF"\'=SUM(1,2)","\'  +cmd","hello, ""test""","-12"'
  );
 });
});


describe('detailed water operating requirements',()=>{
 it('estimates procurement, extraction, electricity and transport from projected production',()=>{
  const study=structuredClone(fixture);
  study.operationsPlan={...emptyWaterOperationsPlan,packagingLossPct:4,kwhPerThousandBottles:40,cartonsPerTrip:60,roundTripKm:52};
  const requirements=waterOperationalRequirements(study,{volume:100});
  expect(requirements).toMatchObject({
   bottles:1200,filledLitres:900,bottleInputs:1250,
   cartonInputs:105,electricityKwh:48,trips:2,distributionKm:104,
  });
  expect(requirements?.sourceWaterM3).toBeCloseTo(900/820);
  expect(evaluateWater(study)).toEqual(evaluateWater(fixture));
 });

 it('accepts older drafts and distinguishes missing assumptions from zero output',()=>{
  expect(waterModelSchema.parse(fixture).operationsPlan).toBeUndefined();
  const study=structuredClone(fixture);
  expect(waterOperationalRequirements(study,{volume:100})).toMatchObject({
   bottles:1200,bottleInputs:1200,cartonInputs:100,electricityKwh:null,trips:null,distributionKm:null,
  });
  study.operationsPlan={...emptyWaterOperationsPlan,kwhPerThousandBottles:40,cartonsPerTrip:60,roundTripKm:52};
  expect(waterOperationalRequirements(study,{volume:0})).toMatchObject({
   bottles:0,electricityKwh:0,trips:0,distributionKm:0,
  });
  study.ops.bottlesCarton=0;
  expect(waterOperationalRequirements(study,{volume:100})).toBeNull();
  expect(waterModelSchema.safeParse({...study,operationsPlan:{...study.operationsPlan,packagingLossPct:100}}).success).toBe(false);
 });
});


describe('water production balance',()=>{
 it('limits the daily source by both pumping capacity and the entered permit volume',()=>{
  const study=structuredClone(fixture);
  study.ops={...study.ops,bottlesHour:6000,hoursDay:8,daysMonth:26,litersBottle:0.5,
   waterLossPct:20,bottlesCarton:12,licensedWaterM3Day:28};
  const savedForecast=evaluateWater(study);
  study.operationsPlan={...emptyWaterOperationsPlan,pumpingM3Hour:4,sourceHoursDay:8,
   finishedBottleLossPct:2,collectionDays:45};
  const balance=waterProductionBalance(study);
  expect(balance).toEqual({
   pumpedM3Day:32,licensedM3Day:28,availableM3Day:28,requiredM3Day:30,
   nominalBottles:1248000,finishedWaste:24960,saleableBottles:1223040,saleableCartons:101920,
  });
  expect(evaluateWater(study)).toEqual(savedForecast);
  expect(waterModelSchema.safeParse(study).success).toBe(true);
  study.operationsPlan.sourceHoursDay=25;
  expect(waterModelSchema.safeParse(study).success).toBe(false);
 });

 it('keeps legacy source names and validates a selected source independently of financial assumptions',()=>{
  const study=structuredClone(fixture);
  study.operationsPlan={...emptyWaterOperationsPlan,sourceName:'Test supply'};
  expect(waterModelSchema.parse(study).operationsPlan).toMatchObject({sourceName:'Test supply'});
  expect(waterModelSchema.parse(study).operationsPlan?.sourceType).toBeUndefined();
  const financials=evaluateWater(study);
  study.operationsPlan.sourceType='public-network';
  expect(waterModelSchema.parse(JSON.parse(JSON.stringify(study))).operationsPlan).toMatchObject({
   sourceName:'Test supply',sourceType:'public-network',
  });
  expect(evaluateWater(study)).toEqual(financials);
  expect(waterModelSchema.safeParse({...study,operationsPlan:{...study.operationsPlan,sourceType:'permit-verified'}}).success).toBe(false);
 });

 it('keeps source availability unknown when just one of the required inputs is missing',()=>{
  const study=structuredClone(fixture);
  study.ops.licensedWaterM3Day=50;
  expect(waterProductionBalance(study)).toMatchObject({licensedM3Day:50,pumpedM3Day:null,availableM3Day:null});
  study.operationsPlan={...emptyWaterOperationsPlan,pumpingM3Hour:5,sourceHoursDay:6};
  study.ops.licensedWaterM3Day=0;
  expect(waterProductionBalance(study)).toMatchObject({licensedM3Day:null,pumpedM3Day:30,availableM3Day:null});
 });
});


it('stores valuation document dates without changing the water project calculations',()=>{
 const study=structuredClone(fixture);
 study.deal={...study.deal,appraisalDate:'2026-11-12',appraisalApprovalDate:'2026-11-17'};
 expect(waterModelSchema.parse(study).deal.appraisalApprovalDate).toBe('2026-11-17');
 expect(evaluateWater(study)).toEqual(evaluateWater(fixture));
 expect(waterModelSchema.safeParse({...study,deal:{...study.deal,appraisalDate:'2026-02-30'}}).success).toBe(false);
});

it('prices water packaging, power and distribution per carton without changing the approved financial forecast',()=>{
 const study=structuredClone(fixture);
 Object.assign(study.ops,{bottlesCarton:10,litersBottle:1,waterLossPct:20});
 const original=evaluateWater(study);
 study.operationsPlan={...emptyWaterOperationsPlan,packagingLossPct:20,kwhPerThousandBottles:200,
  cartonsPerTrip:100,roundTripKm:50,unitCosts:{bottle:.1,cap:.04,label:.06,carton:1,kwh:.5,rawWaterM3:8,distributionKm:2}};
 expect(waterVariableCostBreakdown(study)?.total).toBeCloseTo(5.85);
 expect(evaluateWater(study)).toEqual(original);
 expect(waterModelSchema.safeParse(study).success).toBe(true);
});
