import {describe,it,expect} from 'vitest';
import {createWaterModel,evaluateWater,legacyWaterFinancialPolicy,waterFinancialReadiness,waterAnnualDepreciation,waterCashCycle} from './water-model';
import {createIndustrialStarter} from './project-templates';
import {feasibilityDraftSchema} from './draft-schema';
import {handoffReadiness} from './handoff';

function model(){
 const m=createWaterModel();Object.assign(m.capex,{buildings:9000,line:1000,workingCapital:100});
 Object.assign(m.ops,{bottlesHour:12,hoursDay:1,daysMonth:10,bottlesCarton:12,litersBottle:1,priceCarton:10,variableCarton:4,
  fixedMonth:10,life:2,horizon:3,nwcPct:10,taxRate:20,discountRate:10,util:[100,100,100]});
 m.operationsPlan={sourceName:'Synthetic',permitReference:'Synthetic',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,collectionDays:30};
 return m;
}
describe('explicit water cash-cycle and depreciation policy',()=>{
 it('retains the entire original output until an owner explicitly changes a policy',()=>{
  const m=model(),before=structuredClone(m),original=evaluateWater(m);
  m.financialPolicy=legacyWaterFinancialPolicy();const r=evaluateWater(m);
  const {financialReadiness,...summary}=r;
  const annual=summary.annual.map(({receivables,inventory,payables,operatingFreeCashFlow,workingCapitalRecovery,terminalAssetProceeds,closingWorkingCapital,...legacy})=>legacy);
  expect({...summary,annual}).toEqual(original);expect(financialReadiness?.issues).toContain('LEGACY_OVERDEPRECIATION');
  delete m.financialPolicy;expect(m).toEqual(before);expect(evaluateWater(m)).toEqual(original);
 });
 it('limits straight-line depreciation to the asset cost and propagates the tax and cash effects',()=>{
  const m=model();m.financialPolicy={...legacyWaterFinancialPolicy(),depreciationMode:'CAPPED',evidence:'Synthetic assumptions'};
  const r=evaluateWater(m);expect(r.annual.map(x=>x.depreciation)).toEqual([5000,5000,0]);
  expect(r.annual.reduce((s,x)=>s+x.depreciation,0)).toBe(10000);
  expect(r.annual.map(x=>x.tax)).toEqual([0,0,120]);expect(r.annual.map(x=>x.freeCashFlow)).toEqual([580,600,480]);
  expect(r.npv).toBeCloseTo(-10100+580/1.1+600/1.1**2+480/1.1**3,8);
 });
 it('depreciates each class, allocates contingency once, and never depreciates land/working capital',()=>{
  const m=model();m.capex.contingencyPct=10;m.capex.licenses=300;m.deal.landValue=2000;
  m.financialPolicy={...legacyWaterFinancialPolicy(),depreciationMode:'CLASSES',assetLives:{buildings:3,line:1,licenses:2},evidence:'Synthetic independent lives'};
  const r=evaluateWater(m);expect(r.investment).toBe(11300);
  expect(r.annual.map(x=>x.depreciation)).toEqual([4550,3450,3300]);
  expect(r.annual.reduce((s,x)=>s+x.depreciation,0)).toBe(11300);
  expect(waterAnnualDepreciation(m,m.capex,4)).toBe(0);
  delete m.financialPolicy.assetLives.line;expect(waterFinancialReadiness(m).issues).toContain('ASSET_LIFE:line');expect(evaluateWater(m).ready).toBe(false);
 });
 it('uses collection, inventory and supplier days instead of adding the saved percentage estimate',()=>{
  const m=model();m.financialPolicy={...legacyWaterFinancialPolicy(),workingCapitalMode:'CYCLE',depreciationMode:'CAPPED',daysPerYear:360,inventoryDays:15,payableDays:45,evidence:'Synthetic cash cycle'};
  const before=structuredClone(m),r=evaluateWater(m);
  expect(waterCashCycle(m,1200,480)).toEqual({receivables:100,inventory:20,payables:60,target:60});
  expect(r.flows[0]).toBe(-10100);expect(r.annual.map(x=>x.workingCapital)).toEqual([60,60,60]);
  expect(r.annual.map(x=>x.workingCapitalMovement)).toEqual([-40,0,0]);expect(r.annual.map(x=>x.freeCashFlow)).toEqual([640,600,480]);
  expect(m).toEqual(before);m.ops.nwcPct=99;expect(evaluateWater(m)).toEqual(r); // Stored, inactive percentage cannot double working capital.
  m.operationsPlan!.collectionDays=60;const delayed=evaluateWater(m);expect(delayed.annual[0].receivables).toBe(200);
  expect(delayed.annual[0].freeCashFlow).toBe(540);expect(delayed.npv-r.npv).toBeCloseTo(-100/1.1,8);
  expect(delayed.investorShare).toBe(r.investorShare);expect(delayed.totalLoan).toBe(r.totalLoan);
 });
 it('adds explicit terminal proceeds/recovery once and excludes them from operating DSCR',()=>{
  const m=model();m.deal={...m.deal,investorLoan:300,loanYears:3,loanStart:1,loanInterest:10};
  m.financialPolicy={...legacyWaterFinancialPolicy(),workingCapitalMode:'CYCLE',depreciationMode:'CAPPED',daysPerYear:360,inventoryDays:15,payableDays:45,evidence:'Synthetic closure'};
  const base=evaluateWater(m);m.financialPolicy.workingCapitalRecoveryPct=100;m.financialPolicy.terminalAssetProceeds=200;const r=evaluateWater(m);
  expect(r.annual.map(x=>x.workingCapitalRecovery)).toEqual([0,0,60]);expect(r.annual.map(x=>x.terminalAssetProceeds)).toEqual([0,0,200]);
  expect(r.annual[2]).toMatchObject({workingCapital:60,closingWorkingCapital:0,operatingFreeCashFlow:480,freeCashFlow:740,afterDebt:630});
  expect(r.annual[2].dscr).toBeCloseTo(480/110,10);expect(r.annual[2].dscr).toBe(base.annual[2].dscr);
  expect(r.npv-base.npv).toBeCloseTo(260/1.1**3,8);expect(r.flows[0]).toBe(base.flows[0]);
  expect(r.irr).not.toBeNull();expect(r.flows.reduce((s,v,i)=>s+v/(1+r.irr!/100)**i,0)).toBeCloseTo(0,5);
 });
 it('settles negative working capital at closure instead of turning supplier credit into a fake recovery inflow',()=>{
  const m=model();m.financialPolicy={...legacyWaterFinancialPolicy(),workingCapitalMode:'CYCLE',depreciationMode:'CAPPED',daysPerYear:360,inventoryDays:15,payableDays:120,workingCapitalRecoveryPct:100,evidence:'Synthetic supplier credit'};
  const r=evaluateWater(m);expect(r.annual[0].workingCapital).toBe(-40);expect(r.annual[0].workingCapitalMovement).toBe(-140);
  expect(r.annual[2].workingCapitalRecovery).toBe(-40);expect(r.annual[2].freeCashFlow).toBe(440);expect(r.annual[2].closingWorkingCapital).toBe(0);
 });
 it('recomputes the cycle under scenario price/volume/cost changes and supports explicit cash sales',()=>{
  const m=model();m.financialPolicy={...legacyWaterFinancialPolicy(),workingCapitalMode:'CYCLE',depreciationMode:'CAPPED',daysPerYear:360,inventoryDays:15,payableDays:45,evidence:'Synthetic scenarios'};
  const r=evaluateWater(m,{price:110,volume:50,cost:120});expect(r.annual[0].revenue).toBeCloseTo(660);
  expect(r.annual[0].variable).toBe(288);expect(r.annual[0].workingCapital).toBeCloseTo(55+12-36);
  m.operationsPlan!.collectionDays=0;expect(waterFinancialReadiness(m).ready).toBe(true);expect(evaluateWater(m).annual[0].receivables).toBe(0);
  delete m.operationsPlan!.collectionDays;expect(waterFinancialReadiness(m).issues).toContain('COLLECTION_DAYS');
  m.operationsPlan!.collectionDays=361;expect(waterFinancialReadiness(m).issues).toContain('CYCLE_HORIZON');expect(evaluateWater(m).ready).toBe(false);
 });
 it('round-trips in the existing strict draft format and cannot pass readiness without financial evidence',()=>{
  const s=createIndustrialStarter('6cac7619-9896-4f4a-9b5a-035008a1feec','Synthetic','BOTTLED_WATER');s.water=model();s.water.financialPolicy={...legacyWaterFinancialPolicy(),depreciationMode:'CAPPED'};
  expect(feasibilityDraftSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(handoffReadiness(s).checks.find(x=>x.key==='financial-policy')?.passed).toBe(false);
  s.water.financialPolicy.evidence='Synthetic appraisal/lives/cycle evidence';expect(handoffReadiness(s).checks.find(x=>x.key==='financial-policy')?.passed).toBe(true);
  expect(feasibilityDraftSchema.safeParse({...s,water:{...s.water,financialPolicy:{...s.water.financialPolicy,workingCapitalRecoveryPct:101}}}).success).toBe(false);
 });
});
