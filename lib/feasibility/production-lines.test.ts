import {describe,expect,it} from 'vitest';
import {evaluateProductionPlan,emptyProductionPlan,type ProductionPlan,type ProductionProduct} from './production-lines';
import {createStudy,evaluateStudy} from './engine';
import {emptyAdvanced,evaluateAdvanced} from './advanced-model';
import {monthlyLiquidityAmounts} from './monthly-liquidity';
import {cloudDraftWrite} from './draft-schema';

function product(id:string,allocationPct:number,pricePerTonne:number,kg:number):ProductionProduct{
 return {id,name:id,allocationPct,pricePerTonne,yieldPct:100,soldPct:100,packagingPerSaleableTonne:0,
  recipe:[{materialId:'milk',quantityPerGrossTonne:kg}]};
}
function dairy():ProductionPlan{
 return {...emptyProductionPlan,enabled:true,
  materials:[{id:'milk',name:'Milk-equivalent input',unit:'KG',unitCost:1}],
  payroll:[
   {id:'operators',name:'Operations',headcount:8,monthlyCostPerPerson:500},
   {id:'admin',name:'Administration',headcount:2,monthlyCostPerPerson:900}
  ],
  lines:[
   {id:'shared',name:'Cultured products',basis:'HOURLY',capacity:1,hoursPerDay:16,utilizationPct:100,
    products:[product('Labneh',100/3,600,400),product('Laban',200/3,300,250)]},
   {id:'cheese',name:'Cheese line',basis:'DAILY',capacity:1.6,hoursPerDay:0,utilizationPct:100,
    products:[product('Cheese',100,2000,1250)]},
   {id:'qareesha',name:'Qareesha line',basis:'DAILY',capacity:1.6,hoursPerDay:0,utilizationPct:100,
    products:[product('Qareesha',100,1500,1000)]}
  ]};
}
const studyId='00000000-0000-4000-8000-000000000001';
function study(){
 const result=createStudy(studyId,'Dairy');
 result.capex[1].amount=100_000;
 result.investorEquity=100_000;
 result.monthlyFixedCost=10_000;
 result.productionPlan=dairy();
 return result;
}

describe('industrial production lines',()=>{
 it('reconciles the four-product sample with a shared 16-hour line and two independent lines',()=>{
  const base=study();
  const plan=evaluateProductionPlan(base.productionPlan!);
  expect(plan.ready).toBe(true);
  const output=plan.lines.flatMap(line=>line.products.map(row=>row.gross));
  [160,320,48,48].forEach((quantity,index)=>expect(output[index]).toBeCloseTo(quantity,8));
  expect(plan.totals.sold).toBeCloseTo(576,8);
  expect(plan.totals.revenue).toBeCloseTo(360_000,6);
  expect(plan.totals.variable).toBeCloseTo(252_000,2);
  expect(plan.payroll).toBe(5_800);

  const annual=evaluateStudy(base).annual[0];
  expect(annual.revenue).toBeCloseTo(4_320_000,6);
  expect(annual.ebitda/12).toBeCloseTo(92_200,2);
  base.advanced={...emptyAdvanced(),mode:'CAPACITY',lives:{...emptyAdvanced().lives,EQUIPMENT:10}};
  expect(evaluateAdvanced(base).annual[0].revenue).toBe(annual.revenue);
  expect(monthlyLiquidityAmounts(base)?.collections).toBe(annual.revenue);
  expect(cloudDraftWrite.safeParse({study:base}).success).toBe(true);
 });
 it('changes line speeds independently, supports a product-specific hourly rate and caps growth at allocated capacity',()=>{
  const base=study();
  const plan=base.productionPlan!;
  plan.lines[0].capacity=5;
  plan.lines[0].products[1].tonnesPerHour=3;
  plan.lines[0].utilizationPct=75;
  base.volumeGrowthPct=100;
  const [first,second]=evaluateStudy(base).annual;
  const sharedAtCapacity=(5*16/3+3*16*2/3)*30;
  expect(first.volume/12).toBeCloseTo(sharedAtCapacity*.75+96);
  expect(second.volume/12).toBeCloseTo(sharedAtCapacity+96);
  expect(evaluateProductionPlan(plan,3).lines[1].products[0].gross).toBe(48);
 });
 it('separates gross costs, saleable yield and sales, and recomputes material unit cost changes',()=>{
  const plan=dairy();
  const item=plan.lines[0].products[0];
  item.yieldPct=80;
  item.soldPct=50;
  item.packagingPerSaleableTonne=10;
  plan.materials[0].unitCost=2;
  const result=evaluateProductionPlan(plan).lines[0].products[0];
  expect(result.gross).toBeCloseTo(160,8);
  expect(result.saleable).toBeCloseTo(128,8);
  expect(result.sold).toBeCloseTo(64,8);
  expect(result.revenue).toBeCloseTo(38_400,6);
  expect(result.variable).toBeCloseTo(160*800+1280);
 });
 it('allows incomplete drafts but withholds forecasts when the shared allocation exceeds capacity',()=>{
  const base=study();
  base.productionPlan!.lines[0].products[0].allocationPct=80;
  expect(cloudDraftWrite.safeParse({study:base}).success).toBe(true);
  expect(evaluateStudy(base)).toMatchObject({ready:false,annual:[],npv:null});
  expect(evaluateAdvanced(base).blockers).toContain('BASIC_INPUT_MISSING');
  expect(monthlyLiquidityAmounts(base)).toBeNull();
 });
 it('keeps the existing model intact until enabled and rejects broken recipe references',()=>{
  const base=study();
  base.monthlyUnits=10;
  base.unitPrice=20;
  const old=evaluateStudy({...base,productionPlan:undefined});
  base.productionPlan!.enabled=false;
  expect(evaluateStudy(base)).toEqual(old);
  base.productionPlan!.materials=[];
  expect(cloudDraftWrite.safeParse({study:base}).success).toBe(false);
 });
});
