import Decimal from 'decimal.js';
import {contractInstallmentRows} from './debt-workspace';
import type {ReportMovement} from './vat-financial-reports';
const sum=(values:Array<number|string>)=>values.reduce<Decimal>((n,v)=>n.plus(v??0),new Decimal(0)).toNumber();
export function loanCostSummary(contract:any){
 const charges=(contract.charges??[]).filter((c:any)=>c.status==='ACTUAL').flatMap((c:any)=>c.balances??[]);
 return {planned:sum((contract.financing?.product==='FINANCING'?contract.financing.plan:[]).map((r:any)=>r.finance)),posted:sum(charges.map((b:any)=>b.adjusted_settleable_base_amount??b.settleable_base_amount??0)),applied:sum(charges.map((b:any)=>b.applied_base_amount??0)),outstanding:sum(charges.map((b:any)=>b.outstanding_base_amount??0))};
}
export function loanStatementRows(contract:any):Array<{number:number;due:string;principal:number;plannedCost:number;appliedPrincipal:number|null;outstandingPrincipal:number|null;postedCost:number;appliedCost:number;outstandingCost:number}>{return contractInstallmentRows(contract).map((b:any)=>{
 const number=Number(b.obligation_key.split(':')[1]),active=contract.status==='ACTUAL',planned=contract.financing?.plan?.find((r:any)=>r.number===number)?.finance??0;
 const costs=(contract.charges??[]).filter((c:any)=>c.installment_number===number&&c.status==='ACTUAL').flatMap((c:any)=>c.balances??[]);
 return {number,due:b.due_date,principal:Number(b.settleable_amount),plannedCost:contract.financing?.product==='FINANCING'?Number(planned):0,appliedPrincipal:active&&b.hasBalance?Number(b.applied_base_amount??0):null,outstandingPrincipal:active&&b.hasBalance?Number(b.outstanding_base_amount??0):null,postedCost:sum(costs.map((r:any)=>r.adjusted_settleable_base_amount??r.settleable_base_amount??0)),appliedCost:sum(costs.map((r:any)=>r.applied_base_amount??0)),outstandingCost:sum(costs.map((r:any)=>r.outstanding_base_amount??0))};
});}
export function loanStatementMovements(contract:any,movements:ReportMovement[]){
 const ids=new Set<string>([...(contract.installments??[]).map((b:any)=>b.obligation_id),...(contract.charges??[]).flatMap((c:any)=>(c.balances??[]).map((b:any)=>b.obligation_id))]);
 return movements.filter(m=>m.organizationId===contract.organization_id&&ids.has(m.debtId??'')).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function loanStatementHref(locale:string,organization:string,side:string,party:string,currency:string){return '/'+locale+'/'+(side==='PAYABLE'?'payables':'receivables')+'?'+new URLSearchParams({scope:'ORGANIZATION',organization,level:'COMPANY',party:organization+':'+party,currency});}

export function personalLoanDebtId(record:any):string{return record.receivable_id??record.payable_id??'';}
export function personalLoanTotal(records:any[],debts:Array<{id:string;amount:number}>,side:string){
 const ids=new Set(records.filter(r=>r.side===side&&r.state==='POSTED').map(personalLoanDebtId));
 return sum(debts.filter(d=>ids.has(d.id)).map(d=>d.amount));
}
