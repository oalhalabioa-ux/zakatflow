import {describe,expect,it} from 'vitest';
import {createStudy} from './engine';
import {cloudDraftWrite} from './draft-schema';
import {monthlyLiquidityAmounts} from './monthly-liquidity';
import {createWaterModel,effectiveWaterInputs,emptyWaterOperationsPlan,emptyWaterUnitCosts,evaluateWater,waterOperationalRequirements,waterProductionBalance} from './water-model';
import type {WaterPackMix} from './water-pack-mix';

function fixture(){
 const model=createWaterModel();
 model.capex.line=120_000;
 Object.assign(model.ops,{daysMonth:20,util:[50],waterLossPct:20,licensedWaterM3Day:100});
 model.operationsPlan={...emptyWaterOperationsPlan,finishedBottleLossPct:10,returnsPct:5};
 const mix:WaterPackMix={enabled:true,lines:[
  {id:'shared',name:'Shared',bottlesPerHour:1200,hoursPerDay:8,packs:[
   {id:'small',name:'Small',allocationPct:75,litersPerBottle:.5,bottlesPerCarton:24,pricePerCarton:5,costPerCarton:2},
   {id:'large',name:'Large',allocationPct:25,litersPerBottle:1.5,bottlesPerCarton:12,pricePerCarton:8,costPerCarton:3}
  ]},
  {id:'separate',name:'Separate',bottlesPerHour:300,hoursPerDay:4,packs:[
   {id:'medium',name:'Medium',allocationPct:100,litersPerBottle:1,bottlesPerCarton:12,pricePerCarton:7,costPerCarton:4}
  ]}
 ]};
 model.packMix=mix;
 return {model,mix};
}

describe('optional water packaging mix',()=>{
 it('reconciles carton economics, water losses and annual and monthly collections',()=>{
  const {model}=fixture();
  const result=evaluateWater(model);
  const year=result.annual[0];
  expect(effectiveWaterInputs(model).mix?.daily).toEqual({bottles:10800,cartons:600,litres:8400,revenue:3800,cost:1600});
  expect(result.ready).toBe(true);
  expect(result.capacity).toBe(144000);
  expect(result.waterDemand).toBeCloseTo(10.5,10);
  expect(year.netVolume).toBeCloseTo(61560,10);
  expect(year.revenue).toBeCloseTo(389880,6);
  expect(year.variable).toBeCloseTo(192000,6);
  expect(waterProductionBalance(model)).toMatchObject({nominalBottles:216000,saleableCartons:10800,requiredM3Day:10.5});
  expect(waterOperationalRequirements(model,year)).toMatchObject({bottles:1296000,filledLitres:1008000,sourceWaterM3:1260});
  const study={...createStudy('00000000-0000-4000-8000-000000000001','Bottling'),water:model};
  expect(cloudDraftWrite.safeParse({study}).success).toBe(true);
  expect(monthlyLiquidityAmounts(study)?.collections).toBe(year.revenue);
 });
 it('uses an optional pack-specific speed only for the hours allocated to that pack',()=>{
  const {model,mix}=fixture();
  mix.lines[0].packs[1].bottlesPerHour=600;
  expect(effectiveWaterInputs(model).mix?.daily).toEqual({bottles:9600,cartons:500,litres:6600,revenue:3000,cost:1300});
  expect(evaluateWater(model).waterDemand).toBe(8.25);
 });
 it('uses pack-specific quantities when detailed cost is enabled without adding the manual costs',()=>{
  const {model}=fixture();
  model.quantityCosting={builtArea:0,capital:{enabled:false,items:[]},fixed:{enabled:false,items:[]},
   materialsEnabled:true,materialSource:'Example quote',landByArea:false,landUnitPrice:0,landSource:''};
  model.operationsPlan={...model.operationsPlan!,unitCosts:{...emptyWaterUnitCosts,bottle:.1,carton:1,rawWaterM3:2}};
  const expectedDailyCost=10800*.1+600+10.5*2;
  expect(effectiveWaterInputs(model).mix?.daily.cost).toBeCloseTo(expectedDailyCost,8);
  expect(evaluateWater(model).annual[0].variable).toBeCloseTo(expectedDailyCost*120,6);
 });
 it('blocks overscheduling and flags a source demand above the entered permit',()=>{
  const {model,mix}=fixture();
  model.ops.licensedWaterM3Day=10;
  expect(evaluateWater(model)).toMatchObject({ready:false,costingReadiness:{blockers:['LICENSED_WATER_CAPACITY']}});
  model.ops.licensedWaterM3Day=100;
  mix.lines[0].packs[0].allocationPct=80;
  expect(evaluateWater(model)).toMatchObject({ready:false,capacity:0,costingReadiness:{blockers:['PACK_MIX_INPUTS']}});
 });
 it('keeps the original single-format calculation until the optional mix is enabled',()=>{
  const {model}=fixture();
  Object.assign(model.ops,{bottlesHour:1200,hoursDay:8,bottlesCarton:24,litersBottle:.5,priceCarton:5,variableCarton:2});
  model.packMix!.enabled=false;
  expect(evaluateWater(model)).toEqual(evaluateWater({...model,packMix:undefined}));
 });
});
