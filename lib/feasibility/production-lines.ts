import {z} from 'zod';

const id=z.string().min(1).max(100);
const name=z.string().max(120);
const amount=z.number().finite().min(0).max(1e12);
const percent=z.number().min(0).max(100);
const hours=z.number().min(0).max(24);
const unique=(rows:{id:string}[])=>new Set(rows.map(row=>row.id)).size===rows.length;

const productSchema=z.object({
 id,name,allocationPct:percent,tonnesPerHour:amount.optional(),yieldPct:percent,soldPct:percent,
 pricePerTonne:amount,packagingPerSaleableTonne:amount,
 recipe:z.array(z.object({materialId:id,quantityPerGrossTonne:amount}).strict()).max(50)
}).strict();

export const productionPlanSchema=z.object({
 enabled:z.boolean(),daysPerMonth:z.number().int().min(1).max(31),
 materials:z.array(z.object({id,name,unit:z.enum(['KG','L','UNIT']),unitCost:amount}).strict()).max(50).refine(unique),
 payroll:z.array(z.object({id,name,headcount:z.number().int().min(0).max(100000),monthlyCostPerPerson:amount}).strict()).max(50).refine(unique),
 lines:z.array(z.object({
  id,name,basis:z.enum(['HOURLY','DAILY']),capacity:amount,hoursPerDay:hours,utilizationPct:percent,
  products:z.array(productSchema).max(20).refine(unique)
 }).strict()).max(20).refine(unique)
}).strict().refine(plan=>{
 const materials=new Set(plan.materials.map(material=>material.id));
 return plan.lines.every(line=>line.products.every(product=>
  new Set(product.recipe.map(row=>row.materialId)).size===product.recipe.length&&
  product.recipe.every(row=>materials.has(row.materialId))));
},{message:'Recipe materials must exist and may only be used once per recipe'});

export type ProductionPlan=z.infer<typeof productionPlanSchema>;
export type ProductionLine=ProductionPlan['lines'][number];
export type ProductionProduct=ProductionLine['products'][number];
export const emptyProductionPlan:ProductionPlan={enabled:false,daysPerMonth:30,lines:[],materials:[],payroll:[]};

export function evaluateProductionPlan(plan:ProductionPlan, demandFactor=1){
 const materials=new Map(plan.materials.map(material=>[material.id,material]));
 const catalogueIncomplete=plan.materials.some(material=>!material.name.trim());
 const payroll=plan.payroll.reduce((sum,role)=>sum+role.headcount*role.monthlyCostPerPerson,0);
 const payrollIncomplete=plan.payroll.some(role=>role.headcount>0&&(!role.name.trim()||role.monthlyCostPerPerson<=0));
 const lines=plan.lines.map(line=>{
  const allocation=line.products.reduce((sum,product)=>sum+product.allocationPct,0);
  const overallocated=allocation>100+1e-8;
  const products=line.products.map(product=>{
   const grossDaily=line.basis==='HOURLY'
    ?(product.tonnesPerHour??line.capacity)*line.hoursPerDay*product.allocationPct/100
    :line.capacity*product.allocationPct/100;
   const gross=grossDaily*plan.daysPerMonth*Math.min(1,line.utilizationPct/100*demandFactor);
   const saleable=gross*product.yieldPct/100;
   const sold=saleable*product.soldPct/100;
   const revenue=sold*product.pricePerTonne;
   const materialCost=product.recipe.reduce((sum,row)=>sum+row.quantityPerGrossTonne*(materials.get(row.materialId)?.unitCost??0),0);
   const variable=gross*materialCost+saleable*product.packagingPerSaleableTonne;
   return {id:product.id,gross,saleable,sold,revenue,variable,materialCost};
  });
  const incomplete=!line.name.trim()||!line.products.some(product=>product.allocationPct>0)||
   (line.basis==='HOURLY'&&line.hoursPerDay<=0)||line.products.some(product=>product.allocationPct>0&&(
    !product.name.trim()||(line.basis==='HOURLY'?(product.tonnesPerHour??line.capacity):line.capacity)<=0||
    product.yieldPct<=0||(product.soldPct>0&&product.pricePerTonne<=0)));
  return {id:line.id,allocation,overallocated,incomplete,products};
 });
 const products=lines.flatMap(line=>line.products);
 const totals=products.reduce((sum,row)=>({
  gross:sum.gross+row.gross,saleable:sum.saleable+row.saleable,sold:sum.sold+row.sold,
  revenue:sum.revenue+row.revenue,variable:sum.variable+row.variable
 }),{gross:0,saleable:0,sold:0,revenue:0,variable:0});
 const ready=!catalogueIncomplete&&!payrollIncomplete&&lines.every(line=>!line.incomplete&&!line.overallocated)&&totals.sold>0;
 return {lines,payroll,payrollIncomplete,catalogueIncomplete,totals,ready};
}
