import Decimal from 'decimal.js';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
type Difference={accountId:string;kind:'ASSET'|'LIABILITY';adjustment:string};
type Schedule={accountId:string;usefulLifeDays:number};

/** Calculate the incremental straight-line charge on a documented uplift.
 * The schedule begins on the acquisition date and uses elapsed calendar days. */
export function acquisitionUpliftDepreciation(
 differences:readonly Difference[],schedules:readonly Schedule[],from:string,to:string,
){
 const assets=differences.filter(value=>value.kind==='ASSET');
 const byAccount=new Map(schedules.map(schedule=>[schedule.accountId,schedule]));
 if(byAccount.size!==schedules.length||byAccount.size!==assets.length)return null;
 const elapsed=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(elapsed)||elapsed<0)return null;
 const rows=[];
 for(const item of assets){
  const schedule=byAccount.get(item.accountId);
  const uplift=new Money(item.adjustment);
  if(!schedule||!Number.isInteger(schedule.usefulLifeDays)||schedule.usefulLifeDays<1||!uplift.gt(0))return null;
  const charge=uplift.mul(Math.min(elapsed,schedule.usefulLifeDays)).div(schedule.usefulLifeDays).toDecimalPlaces(4);
  rows.push({accountId:item.accountId,usefulLifeDays:schedule.usefulLifeDays,
   charge:charge.toFixed(4),remainingUplift:uplift.minus(charge).toFixed(4)});
 }
 return rows;
}
