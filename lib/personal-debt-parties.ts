import type {DebtItem,RegisterData} from './financial-register';
/** Record IDs, never names, identify a chosen personal debtor. Existing creditor keys remain compatible. */
export function personalDebtParties(data:RegisterData,side:string){return [...new Map(data.debts.filter(d=>d.side===side).map(d=>[d.partyKey,d])).values()];}
export function personalPartyDebts(data:RegisterData,debt:DebtItem){return data.debts.filter(d=>d.partyKey===debt.partyKey&&d.side===debt.side).sort((a,b)=>(a.dueDate??'9999').localeCompare(b.dueDate??'9999')||a.date.localeCompare(b.date)||a.id.localeCompare(b.id));}
export function applyPersonalDebtLinks(data:RegisterData,links:{record_id:string;side:string;party_key:string;party_name:string}[]){
 const map=new Map(links.map(l=>[l.side+':'+l.record_id,l]));
 return {...data,debts:data.debts.map(d=>{const l=map.get(d.side+':'+d.id);return l?{...d,partyKey:l.party_key,partyName:l.party_name}:d}),debtMovements:data.debtMovements.map(m=>{const l=map.get((m.side==='SALES'?'RECEIVABLE':'PAYABLE')+':'+m.debtId);return l?{...m,partyKey:l.party_key,partyName:l.party_name}:m})};
}
