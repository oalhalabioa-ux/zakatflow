import {z} from 'zod';

const amount=z.number().finite().min(0).max(1e12);
const identity={id:z.string().min(1).max(100),name:z.string().max(120)};
const unique=(rows:{id:string}[])=>new Set(rows.map(row=>row.id)).size===rows.length;
const pack=z.object({
 ...identity,bottlesPerHour:amount.optional(),allocationPct:z.number().min(0).max(100),litersPerBottle:amount,
 bottlesPerCarton:amount.int(),pricePerCarton:amount,costPerCarton:amount
}).strict();

export const waterPackMixSchema=z.object({
 enabled:z.boolean(),
 lines:z.array(z.object({
  ...identity,bottlesPerHour:amount,hoursPerDay:z.number().min(0).max(24),
  packs:z.array(pack).max(20).refine(unique)
 }).strict()).max(20).refine(unique)
}).strict();

export type WaterPackMix=z.infer<typeof waterPackMixSchema>;
export type WaterPackLine=WaterPackMix['lines'][number];
export type WaterPack=WaterPackLine['packs'][number];
export const emptyWaterPackMix:WaterPackMix={enabled:false,lines:[]};

export function evaluateWaterPackMix(mix:WaterPackMix,unitCost:(pack:WaterPack)=>number){
 const lines=mix.lines.map(line=>{
  const allocatedPct=line.packs.reduce((sum,pack)=>sum+pack.allocationPct,0);
  const overallocated=allocatedPct>100+1e-8;
  const incomplete=!line.name.trim()||line.bottlesPerHour<=0||line.hoursPerDay<=0||allocatedPct<=0||
   line.packs.some(pack=>pack.allocationPct>0&&(!pack.name.trim()||pack.litersPerBottle<=0||pack.bottlesPerCarton<=0||pack.pricePerCarton<=0||(pack.bottlesPerHour??line.bottlesPerHour)<=0));
  const packs=line.packs.map(pack=>{
   const bottles=(pack.bottlesPerHour??line.bottlesPerHour)*line.hoursPerDay*pack.allocationPct/100;
   const cartons=pack.bottlesPerCarton>0?bottles/pack.bottlesPerCarton:0;
   return {id:pack.id,bottles,cartons,litres:bottles*pack.litersPerBottle,revenue:cartons*pack.pricePerCarton,cost:cartons*unitCost(pack)};
  });
  return {id:line.id,allocatedPct,overallocated,incomplete,packs};
 });
 const daily=lines.flatMap(line=>line.packs).reduce((sum,pack)=>({
  bottles:sum.bottles+pack.bottles,cartons:sum.cartons+pack.cartons,litres:sum.litres+pack.litres,
  revenue:sum.revenue+pack.revenue,cost:sum.cost+pack.cost
 }),{bottles:0,cartons:0,litres:0,revenue:0,cost:0});
 const hourly=mix.lines.reduce((total,line)=>total+line.bottlesPerHour,0);
 return {lines,daily,hourly,ready:daily.cartons>0&&lines.every(line=>!line.overallocated&&!line.incomplete)};
}
