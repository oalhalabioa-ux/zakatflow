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

/** The approved opening liability reverses on the same documented schedule as
 * the uplift. Scope excludes rate changes, assets and nonzero local tax bases. */
export function acquisitionDeferredTaxReversals(
 differences:readonly (Difference&{bookValue:string})[],
 schedules:readonly (Schedule&{deferredTaxLiabilityAccountId?:string})[],
 from:string,to:string,required:boolean,
){
 if(!required)return schedules.some(schedule=>schedule.deferredTaxLiabilityAccountId)?null:[];
 const elapsed=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(elapsed)||elapsed<0)return null;
 const mapped=new Set<string>();
 const rows=[];
 for(const schedule of schedules){
  const id=schedule.deferredTaxLiabilityAccountId;
  const uplift=differences.find(item=>item.kind==='ASSET'&&item.accountId===schedule.accountId);
  const tax=differences.find(item=>item.kind==='LIABILITY'&&item.accountId===id);
  if(!id||!uplift||!tax||mapped.has(id)||!Number.isInteger(schedule.usefulLifeDays)||schedule.usefulLifeDays<1||
    !new Money(tax.bookValue).isZero())return null;
  const initial=new Money(tax.adjustment);
  if(!initial.gt(0)||!initial.lt(uplift.adjustment))return null;
  mapped.add(id);
  const reversal=initial.mul(Math.min(elapsed,schedule.usefulLifeDays)).div(schedule.usefulLifeDays).toDecimalPlaces(4);
  rows.push({assetAccountId:schedule.accountId,accountId:id,openingLiability:initial.toFixed(4),
   reversal:reversal.toFixed(4),remainingLiability:initial.minus(reversal).toFixed(4)});
 }
 return rows;
}
