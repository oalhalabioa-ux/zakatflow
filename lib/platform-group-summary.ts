import Decimal from 'decimal.js';
/** Read-only management totals; tax payables/credits remain separate by taxpayer. */
export function platformGroupVat(reads:any[]){
 if(!reads.length||reads.some(r=>!r))return null;
 const first=reads[0];
 if(reads.some(r=>r.period.from!==first.period.from||r.period.to!==first.period.to))return null;
 const keys=['salesBase','outputTax','inputTax','taxPayable','taxCredit','paidAmount'];
 const totals=Object.fromEntries(keys.map(key=>[key,reads.reduce((s,r)=>s.add(r.periodTotals[key]??0),new Decimal(0)).toFixed(2)]));
 return {totals,period:first.period,profileConfigured:reads.every(r=>!!r.profile)};
}
export function platformGroupCash(reads:any[]){
 if(!reads.length||reads.some(r=>!r))return null;
 return {accounts:reads.flatMap(r=>r.accounts),flows:reads.flatMap(r=>r.flows),counterparty_balances:reads.flatMap(r=>r.counterparty_balances)};
}
export function platformGroupCurrencyKnown(organizations:Array<{base_currency:string}>,target:string){return organizations.every(o=>o.base_currency===target);}
