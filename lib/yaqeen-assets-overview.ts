import Decimal from 'decimal.js';

/** Presentation aggregation of saved eligible lines; never recalculates Zakat. */
export function zakatAllocationPresentation(
 lines:Array<{eligible_value?:unknown;eligibility_status?:string;lots?:any}>,
 assets:Array<{id:string;asset_type?:string}>,
){
 const types=new Map(assets.map(a=>[a.id,a.asset_type||'OTHER']));
 const totals=new Map<string,Decimal>();
 for(const line of lines){
  if(line.eligibility_status!=='ELIGIBLE')continue;
  let value:Decimal;
  try{value=new Decimal(String(line.eligible_value??0))}catch{continue}
  if(!value.isFinite()||!value.gt(0))continue;
  const lot=Array.isArray(line.lots)?line.lots[0]:line.lots;
  const type=types.get(lot?.asset_account_id)||'OTHER';
  totals.set(type,(totals.get(type)||new Decimal(0)).add(value));
 }
 return [...totals].map(([type,value])=>({type,value:value.toFixed(2)}));
}
