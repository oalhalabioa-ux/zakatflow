import {describe,it,expect} from 'vitest';
import {applyWaterCapexQuote} from './water-capex';
import {createWaterModel,evaluateWater,waterModelSchema,type WaterCapexItemKey} from './water-model';
import type {StudySupplier} from './engine';

const quote:StudySupplier={id:'synthetic-quote',vendor:'Synthetic vendor',item:'Synthetic equipment',offer:5000,notes:''};
describe('explicit water CAPEX quote replacement',()=>{
 it('requires consent, a current-study quote, valid currency and an unambiguous allowed item',()=>{
  const water=createWaterModel();
  expect(applyWaterCapexQuote(water,[quote],quote.id,'line','USD',false)).toBeNull();
  expect(applyWaterCapexQuote(water,[],quote.id,'line','USD',true)).toBeNull();
  expect(applyWaterCapexQuote(water,[quote,quote],quote.id,'line','USD',true)).toBeNull();
  expect(applyWaterCapexQuote(water,[quote],quote.id,'workingCapital' as WaterCapexItemKey,'USD',true)).toBeNull();
  expect(applyWaterCapexQuote(water,[quote],quote.id,'line','',true)).toBeNull();
  expect(applyWaterCapexQuote(water,[{...quote,status:'REJECTED'}],quote.id,'line','USD',true)).toBeNull();
  for(const offer of [NaN,Infinity,-1,1e12+1])expect(applyWaterCapexQuote(water,[{...quote,offer}],quote.id,'line','USD',true)).toBeNull();
 });
 it('replaces rather than adds, preserves all other inputs and snapshots provenance',()=>{
  const water=createWaterModel();water.capex.line=1200;water.deal.landValue=9000;
  const before=structuredClone(water),quotesBefore=structuredClone([quote]);
  const imported=applyWaterCapexQuote(water,[quote],quote.id,'line','USD',true,'2026-11-19T00:00:00Z')!;
  expect(imported.capex.line).toBe(5000);
  expect(imported.deal).toEqual(water.deal);
  expect(imported.ops).toEqual(water.ops);
  expect(imported.capexQuoteSources!.line).toEqual({quoteId:quote.id,vendor:quote.vendor,item:quote.item,amount:5000,currency:'USD',importedAt:'2026-11-19T00:00:00.000Z'});
  expect(waterModelSchema.parse(JSON.parse(JSON.stringify(imported)))).toEqual(imported);
  expect(water).toEqual(before);expect([quote]).toEqual(quotesBefore);
  const reapplied=applyWaterCapexQuote(imported,[quote],quote.id,'line','USD',true)!;
  expect(reapplied.capex.line).toBe(5000);
  const changedQuotes=[{...quote,offer:8000}];
  expect(changedQuotes[0].offer).toBe(8000);
  expect(imported.capex.line).toBe(5000);
 });
 it('matches manual-entry financial results and retains evidence after a manual cost edit',()=>{
  const water=createWaterModel();
  Object.assign(water.capex,{buildings:1000,power:1000});
  Object.assign(water.ops,{bottlesHour:2000,hoursDay:8,daysMonth:22,bottlesCarton:12,priceCarton:5,variableCarton:2,fixedMonth:100,life:7,discountRate:12,util:Array(10).fill(70)});
  const manual={...water,capex:{...water.capex,line:quote.offer}};
  const imported=applyWaterCapexQuote(water,[quote],quote.id,'line','USD',true)!;
  expect(evaluateWater(imported).ready).toBe(true);
  expect(evaluateWater(imported)).toEqual(evaluateWater(manual));
  imported.capex.line=6000;
  expect(imported.capexQuoteSources!.line!.amount).toBe(5000);
  expect(evaluateWater(imported)).toEqual(evaluateWater({...manual,capex:{...manual.capex,line:6000}}));
 });
});
