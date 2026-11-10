
import {describe,it,expect} from 'vitest';
import {createStudy,evaluateStudy} from './engine';
import {blankIndustrialSchedule,blankPropertySchedule,evaluateIndustrialProduction,
 evaluatePropertyStages} from './sector-analysis';
import {cloudDraftWrite} from './draft-schema';
const id='6357a708-bae2-4634-9296-490404b1d8a4';

describe('industrial unit cash economics, not statutory inventory',()=>{
 function study(){
  const s=createStudy(id,'Industrial','INDUSTRIAL');
  s.monthlyUnits=750;s.unitPrice=20;s.monthlyFixedCost=2000;
  s.sectorSchedule={kind:'INDUSTRIAL',ratedCapacityMonthly:1000,operatingMonths:12,
   utilizationPct:80,saleableYieldPct:90,productionCashCostPerGrossUnit:5};
  return s;
 }
 it('does not confuse nominal capacity, good units, demand, rejected stock and cash cost',()=>{
  const r=evaluateIndustrialProduction(study());
  expect(r.ready).toBe(true);
  expect(r.grossProduction).toBe(9600);
  expect(r.saleableUnits).toBe(8640);
  expect(r.soldUnits).toBe(8640);
  expect(r.rejectedUnits).toBe(960);
  expect(r.unsoldUnits).toBe(0);
  expect(r.productionCashCosts).toBe(48000);
  expect(r.operatingCashContribution).toBe(8640*20-48000-24000);
 });
 it('limits sales by demand and still counts cost of all produced units',()=>{
  const s=study();s.monthlyUnits=500;
  const r=evaluateIndustrialProduction(s);
  expect(r.soldUnits).toBe(6000);
  expect(r.unsoldUnits).toBe(2640);
  expect(r.productionCashCosts).toBe(48000);
 });
 it('blocks missing production inputs and does not rewrite the core model',()=>{
  const s=study();
  const baseline=evaluateStudy(s);
  s.sectorSchedule=blankIndustrialSchedule();
  expect(evaluateIndustrialProduction(s).ready).toBe(false);
  expect(evaluateStudy(s)).toEqual(baseline);
 });
});
describe('real-estate staged contracts and cash, not automatic revenue recognition',()=>{
 function study(){
  const s=createStudy(id,'Development','REAL_ESTATE');
  s.years=3;s.discountRatePct=10;
  s.capex=[{id:'site',label:'Initial site',amount:100,category:'BUILDINGS'}];
  s.sectorSchedule={kind:'REAL_ESTATE',stages:[
   {year:1,contractedUnits:4,contractPricePerUnit:100,cashCollections:100,constructionCashCost:150,sellingCashCost:10},
   {year:2,contractedUnits:1,contractPricePerUnit:100,cashCollections:250,constructionCashCost:100,sellingCashCost:10},
   {year:3,contractedUnits:0,contractPricePerUnit:0,cashCollections:150,constructionCashCost:0,sellingCashCost:10}
  ]};
  return s;
 }
 it('values bookings separately from phased collections and construction cash outlay',()=>{
  const r=evaluatePropertyStages(study());
  expect(r.ready).toBe(true);
  expect(r.bookings).toBe(500);
  expect(r.collections).toBe(500);
  expect(r.cashFlows).toEqual([-100,-60,140,140]);
  expect(r.years.map(x=>x.outstandingReceivables)).toEqual([300,150,0]);
  expect(r.peakCashFundingNeed).toBe(160);
  expect(r.projectNpv).toBeCloseTo(-100-60/1.1+140/1.21+140/1.331);
 });
 it('never assumes uncollected contracts become year-end cash',()=>{
  const s=study();(s.sectorSchedule as Extract<NonNullable<typeof s.sectorSchedule>,{kind:'REAL_ESTATE'}>).stages[2].cashCollections=0;
  const r=evaluatePropertyStages(s);
  expect(r.ready).toBe(true);expect(r.outstandingReceivables).toBe(150);
  expect(r.cashFlows.at(-1)).toBe(-10);
 });
 it('transferred land counts as economic investment but not spendable cash',()=>{
  const s=study();s.landValue=200;s.landTransferred=true;
  const r=evaluatePropertyStages(s);
  expect(r.initialCashOutlay).toBe(100);
  expect(r.initialEconomicOutlay).toBe(300);
  expect(r.cashFlows[0]).toBe(-100);
  expect(r.economicFlows[0]).toBe(-300);
 });
 it('fails closed on overcollections, duplicate years and missing schedules',()=>{
  const s=study();const x=s.sectorSchedule;
  if(!x||x.kind!=='REAL_ESTATE')throw Error('invalid test fixture');
  x.stages[0].cashCollections=500;
  expect(evaluatePropertyStages(s).blockers).toContain('COLLECTIONS_EXCEED_CONTRACTS');
  x.stages[0].cashCollections=100;
  x.stages.push({...x.stages[0]});
  expect(evaluatePropertyStages(s).blockers).toContain('DUPLICATE_YEAR');
  s.sectorSchedule=blankPropertySchedule();
  expect(evaluatePropertyStages(s).ready).toBe(false);
 });
 it('validates serialization and preserves historic study forecasts',()=>{
  const s=study();const before=evaluateStudy(s);
  expect(cloudDraftWrite.safeParse({study:s}).success).toBe(true);
  expect(evaluateStudy(s)).toEqual(before);
  const x=s.sectorSchedule;
  if(!x||x.kind!=='REAL_ESTATE')throw Error('wrong fixture');
  x.stages[0].year=25;
  expect(cloudDraftWrite.safeParse({study:s}).success).toBe(false);
 });
});
