import {Workbook} from 'exceljs';
import {describe,expect,it} from 'vitest';
import golden from '../../tests/feasibility/original-template-golden.json';
import {emptyAdvanced,evaluateGeneralForecast} from './advanced-model';
import {createStudy,evaluateStudy} from './engine';
import {handoffReadiness} from './handoff';
import {investmentAssessment} from './investment-assessment';
import {defaultMonthlyLiquidity,evaluateMonthlyLiquidity,monthlyLiquidityAmounts} from './monthly-liquidity';
import {type ProductionPlan} from './production-lines';
import {evaluateRawLand,rawLandSchema} from './raw-land';
import {feasibilityCsv,feasibilityXlsx,generalForecastRows} from './report-export';
import {evaluateWater,waterModelSchema} from './water-model';

const discount=(flows:readonly number[],rate:number)=>flows.reduce((value,flow,index)=>value+flow/(1+rate)**index,0);
const compareFlows=(actual:readonly number[],expected:readonly number[])=>{
 expect(actual).toHaveLength(expected.length);
 expected.forEach((value,index)=>expect(actual[index]).toBeCloseTo(value,6));
};

function services(){
 const study=createStudy('61148a93-165c-4d02-8c0f-a5f69a082b40','Synthetic services','SERVICES');
 Object.assign(study,{country:'SA',currency:'SAR',years:2,discountRatePct:10,monthlyUnits:100,unitPrice:10,
  variableCost:2,monthlyFixedCost:100,investorEquity:7200,investorLoan:3000,workingCapital:200});
 study.capex=[{id:'equipment',label:'Equipment',amount:10000,category:'EQUIPMENT'}];
 study.advanced={...emptyAdvanced(),debtYears:2,debtRatePct:10,lives:{...emptyAdvanced().lives,EQUIPMENT:5},terminalCash:300};
 return study;
}

describe('four-template financial acceptance on synthetic and approved golden data',()=>{
 it('replays the approved water cash flows and independently discounts them without changing the source',()=>{
  const fixture=golden.water[0],input=waterModelSchema.parse(fixture.input),snapshot=structuredClone(input);
  const result=evaluateWater(input);
  compareFlows(result.flows,fixture.expected.flows);
  expect(result.cashRequired).toBe(82000);
  expect(result.flows[0]).toBe(-102000);
  expect(result.npv).toBeCloseTo(discount(fixture.expected.flows,input.ops.discountRate/100),6);
  expect(discount(result.flows,result.irr!/100)).toBeCloseTo(0,6);
  expect(result.payback).toBeCloseTo(102000/fixture.expected.flows[1],6);
  const down=evaluateWater(input,{price:90,volume:100,cost:100});
  expect(down.annual[0].revenue).toBeCloseTo(result.annual[0].revenue*.9,6);
  expect(down.flows[0]).toBe(result.flows[0]);
  expect(down.npv).toBeLessThan(result.npv);
  expect(input).toEqual(snapshot);
 });
 it('reconciles hourly and independent daily dairy production, yield, recipes and the annual report',()=>{
  const milk={id:'milk',name:'Raw milk',unit:'KG',unitCost:2} as const;
  const product=(id:string,allocationPct:number,pricePerTonne:number,usage:number)=>({
   id,name:id,allocationPct,pricePerTonne,yieldPct:90,soldPct:80,packagingPerSaleableTonne:10,
   recipe:[{materialId:'milk',quantityPerGrossTonne:usage}]
  });
  const plan:ProductionPlan={enabled:true,daysPerMonth:20,materials:[milk],payroll:[{id:'operator',name:'Operator',headcount:2,monthlyCostPerPerson:500}],lines:[
   {id:'cultured',name:'Cultured',basis:'HOURLY',capacity:2,hoursPerDay:8,utilizationPct:75,products:[product('Labneh',25,1000,90),product('Laban',75,800,80)]},
   {id:'cheese',name:'Cheese',basis:'DAILY',capacity:3,hoursPerDay:0,utilizationPct:100,products:[product('Cheese',100,1200,150)]},
   {id:'curd',name:'Curd',basis:'DAILY',capacity:1,hoursPerDay:0,utilizationPct:100,products:[product('Curd',100,950,60)]}
  ]};
  const study=createStudy('03f1862b-bd4f-41d7-b931-2048235e90a9','Synthetic dairy');
  study.productionPlan=plan;study.capex[1].amount=100000;study.investorEquity=100000;study.monthlyFixedCost=2000;
  const gross=[60,180,60,20];
  const revenue=gross.reduce((sum,g,i)=>sum+g*.9*.8*[1000,800,1200,950][i],0);
  const variable=gross.reduce((sum,g,i)=>sum+g*(2*[90,80,150,60][i]+.9*10),0);
  const first=evaluateStudy(study);
  compareFlows(first.production!.lines.flatMap(line=>line.products.map(row=>row.gross)),gross);
  expect(first.annual[0].revenue).toBeCloseTo(revenue*12,6);
  expect(first.annual[0].ebitda).toBeCloseTo((revenue-variable-3000)*12,6);
  expect(monthlyLiquidityAmounts(study)?.collections).toBeCloseTo(revenue*12,6);
  const changed=structuredClone(study);
  changed.productionPlan!.lines[1].capacity=4;
  const recomputed=evaluateStudy(changed);
  expect(recomputed.annual[0].revenue-first.annual[0].revenue).toBeCloseTo(20*.9*.8*1200*12,6);
  expect(recomputed.annual[0].variable-first.annual[0].variable).toBeCloseTo(20*(300+9)*12,6);
  expect(recomputed.flows[0]).toBe(first.flows[0]);
 });
 it('reconciles the approved land sale area, cost and never duplicates collections when payment timing moves',()=>{
  const fixture=golden.land[0],input=rawLandSchema.parse(fixture.input),snapshot=structuredClone(input);
  const result=evaluateRawLand(input);
  if(result.issue)throw Error(result.issue);
  expect(result.net).toBe(800);expect(result.saleArea).toBe(600);
  expect(result.totalCost).toBeCloseTo(fixture.expected.totalCost,6);
  expect(result.npv).toBeCloseTo(fixture.expected.npv,6);
  expect(result.annual.reduce((sum,year)=>sum+year.cashCollected,0)).toBeCloseTo(63000,6);
  const moved=structuredClone(input);
  moved.sales.mix=moved.sales.mix.map(item=>({...item,collectionPhasing:[0,1,0,0]}));
  const deferred=evaluateRawLand(moved);
  if(deferred.issue)throw Error(deferred.issue);
  expect(deferred.revenue).toBeCloseTo(result.revenue,6);
  expect(deferred.annual.reduce((sum,year)=>sum+year.cashCollected,0)).toBeCloseTo(63000,6);
  expect(deferred.npv).toBeLessThan(result.npv);
  expect(input).toEqual(snapshot);
 });
 it('reconciles general cash flow, principal, interest, coverage and exact workbook values across the report and CSV',async()=>{
  const study=services(),snapshot=structuredClone(study);
  const forecast=evaluateGeneralForecast(study),advanced=forecast.advanced!;
  const ebitda=12000-2400-1200;
  expect(advanced.annual[0].ebitda).toBe(ebitda);
  compareFlows(advanced.projectFlows,[-10200,8400,8900]);
  compareFlows(advanced.equityFlows,[-7200,6600,7250]);
  expect(advanced.annual.map(year=>year.principal)).toEqual([1500,1500]);
  expect(advanced.annual.map(year=>year.interest)).toEqual([300,150]);
  expect(advanced.minDscr).toBeCloseTo(8400/1800,6);
  expect(advanced.projectNpv).toBeCloseTo(discount([-10200,8400,8900],.1),6);
  expect(discount(advanced.projectFlows,advanced.projectIrr!/100)).toBeCloseTo(0,6);
  const firstYear=monthlyLiquidityAmounts(study)!;
  const schedule=evaluateMonthlyLiquidity(firstYear,{...defaultMonthlyLiquidity,cashEquityFromStudy:true});
  expect(schedule.closing).toBeCloseTo(6600,6);
  const rows=generalForecastRows(forecast);
  const csv=feasibilityCsv(rows);
  const book=new Workbook();
  await book.xlsx.load(await feasibilityXlsx('Forecast',rows,false));
  expect(csv).toContain('"8400","1500","300","1500","6600"');
  expect(rows[1][8]).toBe(8400);
  expect(book.worksheets[0].getCell('I2').value).toBe(8400);
  expect(book.worksheets[0].getCell('M2').value).toBe(6600);
  expect(study).toEqual(snapshot);
 });
});

describe('financial calculation and investment evidence are independent',()=>{
 it('distinguishes an evidential gap, a pure calculation, and a material funding gap',()=>{
  const study=services();
  study.legal=study.legal.map(item=>({...item,status:'VERIFIED'}));
  const check=()=>investmentAssessment(study,handoffReadiness(study).checks);
  expect(check()).toMatchObject({calculated:true,status:'NEEDS_EVIDENCE'});
  expect(check().evidence.map(item=>item.key)).toContain('cost-source');
  study.suppliers=[{id:'qa-quote',item:'Equipment',vendor:'Synthetic supplier',offer:10000,notes:'QA document',status:'SELECTED'}];
  expect(check()).toMatchObject({calculated:true,status:'CALCULATED'});
  expect(handoffReadiness(study).ready).toBe(false);
  study.legal[0]={...study.legal[0],critical:true,notes:''};
  expect(check()).toMatchObject({calculated:true,status:'BLOCKED'});
  expect(check().blockers.map(item=>item.key)).toContain('legal');
  study.legal[0].notes='Verified document reference';
  expect(check()).toMatchObject({calculated:true,status:'CALCULATED'});
  study.investorEquity-=100;
  expect(check()).toMatchObject({calculated:true,status:'BLOCKED'});
  expect(check().blockers.map(item=>item.key)).toContain('finance');
 });
 it('uses planned water demand for known constraints without altering calculated flows',()=>{
  const study=createStudy('c0752ee7-f71b-44fa-b507-39f730c9a48c','Synthetic water');
  study.water=waterModelSchema.parse(golden.water[0].input);
  study.water.ops.licensedWaterM3Day=1;
  const result=evaluateWater(study.water);
  const assessment=investmentAssessment(study,handoffReadiness(study).checks,result);
  expect(assessment.blockers.map(item=>item.key)).toContain('water-capacity');
  compareFlows(result.flows,golden.water[0].expected.flows);
 });
});
