import Decimal from 'decimal.js';
import {personalInstallmentBalances} from './personal-contracts';
import type {DebtItem} from './financial-register';
import type {ReportMovement} from './vat-financial-reports';
export function personalContractRegister(debts:DebtItem[],movements:ReportMovement[],contracts:any[],installments:any[],operations:any[]){
 const active=contracts.filter(c=>c.status==='POSTED'),bySource=new Map<string,any>();
 for(const c of active){if(c.asset_id)bySource.set(c.asset_id,c);if(c.payable_id)bySource.set(c.payable_id,c);}
 for(const m of operations.filter(m=>['CHARGE','PROFIT'].includes(m.kind)&&!m.reversed_at)){const c=active.find(c=>c.id===m.contract_id);if(c){if(m.asset_id)bySource.set(m.asset_id,c);if(m.payable_id)bySource.set(m.payable_id,c);}}
 const parties=new Map(active.map(c=>{const id=c.asset_id??c.payable_id,root=debts.find(d=>d.id===id)??movements.find(m=>m.debtId===id);return [c.id,root?.partyKey??'personal-contract:'+c.id]}));
 const output=debts.flatMap((d):DebtItem[]=>{const c=bySource.get(d.id);if(!c)return [d];const common={...d,sourceDebtId:d.id,personalContractId:c.id,currency:c.currency,financialLocked:true,reference:c.terms.reference,partyKey:parties.get(c.id)!,partyName:c.terms.party};
  if(c.product==='PARTICIPATION'&&c.side==='RECEIVABLE'||d.id!==(c.asset_id??c.payable_id))return [common];
  const rows=personalInstallmentBalances(c.terms.schedule,Number(c.principal),d.amount),saved=installments.filter(i=>i.contract_id===c.id);
  // Never emit unstable synthetic IDs. A missing snapshot is an explicit warning upstream.
  if(saved.length!==rows.length)return [{...common,dueDate:rows.find(r=>r.remaining>0)?.due_date??d.dueDate}];
  return rows.map(row=>({...common,id:saved.find(i=>i.number===row.number)!.id,categoryRootId:d.id,installmentNumber:row.number,amount:row.remaining,dueDate:row.due_date,originalCurrency:c.currency,originalAmount:row.amount,totalBase:row.amount,appliedBase:row.paid,description:c.terms.description+' · قسط '+row.number}));
 });
 const allocated=new Map<string,Array<{debtId:string;due:string;amount:number}>>();
 for(const c of active.filter(c=>c.product!=='PARTICIPATION'||c.side==='PAYABLE')){
  const saved=installments.filter(i=>i.contract_id===c.id).sort((a,b)=>a.number-b.number);if(saved.length!==c.terms.schedule.length)continue;
  const fund=operations.find(m=>m.contract_id===c.id&&m.kind==='FUND'&&!m.reversed_at),paid=saved.map(()=>0);
  const rows=movements.filter(m=>m.debtId===(c.asset_id??c.payable_id)&&m.createdAt&&fund&&Date.parse(m.createdAt)>Date.parse(fund.created_at)).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||a.id.localeCompare(b.id));
  for(const m of rows){if(m.amount>=0&&m.kind!=='REVERSAL')continue;let left=Math.abs(m.amount);const allocations:Array<{debtId:string;due:string;amount:number}>=[],indices=saved.map((_,i)=>i);if(m.amount>0)indices.reverse();
   for(const i of indices){const available=m.amount<0?new Decimal(saved[i].amount).minus(paid[i]).toNumber():paid[i],take=Decimal.min(left,available).toDecimalPlaces(4).toNumber();if(take<=0)continue;paid[i]=new Decimal(paid[i]).plus(m.amount<0?take:-take).toDecimalPlaces(4).toNumber();left=new Decimal(left).minus(take).toDecimalPlaces(4).toNumber();allocations.push({debtId:saved[i].id,due:saved[i].due_date,amount:m.amount<0?-take:take});if(left<=0)break;}
   allocated.set(m.id,allocations);
  }
 }
 const report=movements.map(m=>{const c=bySource.get(m.debtId??'');return c?{...m,installmentAllocations:(c.product!=='PARTICIPATION'||c.side==='PAYABLE')&&m.debtId===(c.asset_id??c.payable_id)?allocated.get(m.id)??[]:undefined,partyKey:parties.get(c.id)!,partyName:c.terms.party,reference:m.kind==='OPENING_BALANCE'||m.kind==='TRANSFER_IN'||m.kind==='INVOICE'?c.terms.reference:m.reference}:m;});
 return {debts:output,movements:report};
}
