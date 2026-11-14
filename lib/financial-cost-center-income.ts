import Decimal from 'decimal.js';
import {compileEventLedger} from './financial-event-ledger';
import {normalizeStatementSource,statementSourceEnvelope,type StatementQuery} from './financial-statement-source';
const D=Decimal.clone({precision:50});
const kinds=['REVENUE','COGS','OPEX','FINANCE','TAX'] as const;
export type CenterEvidence={organizationId:string;centers:{id:string;name:string;active:boolean}[];links:{eventId:string;lineId:string;centerId:string|null}[]};
/** An income projection only: no invented center opening, balance sheet or cash balance.
 * A server must independently verify original line dimensions and user access.
 */
export function costCenterIncome(raw:unknown,query:StatementQuery,evidence:CenterEvidence){
 const company=normalizeStatementSource(raw,query),p=statementSourceEnvelope.parse(raw),{source}=compileEventLedger(p);
 if(evidence.organizationId!==query.organization)throw Error('CENTER_SCOPE_INVALID');
 const centers=new Map(evidence.centers.map(c=>[c.id,c]));
 if(centers.size!==evidence.centers.length||evidence.centers.some(c=>!c.id||!c.name||typeof c.active!=='boolean'))throw Error('CENTER_REGISTRY_INVALID');
 const links=new Map<string,string|null>();
 for(const l of evidence.links){const key=JSON.stringify([l.eventId,l.lineId]);
  if(links.has(key)||(l.centerId!==null&&!centers.has(l.centerId)))throw Error('CENTER_SOURCE_INVALID');links.set(key,l.centerId);
 }
 const accounts=new Map(source.accounts.map(a=>[a.id,a]));
 const buckets=new Map<string|null,Map<string,Decimal>>([[null,new Map()],...evidence.centers.map(c=>[c.id,new Map<string,Decimal>()] as const)]);
 let consumed=0;
 for(const e of p.events.filter(e=>e.date>=p.fiscalStart&&e.date<=p.to)){
  const journal=source.journals.find(j=>j.id===e.id);
  if(!journal||journal.lines.length!==e.lines.length*2)throw Error('CENTER_SOURCE_INVALID');
  e.lines.forEach((line,index)=>{
   const key=JSON.stringify([e.id,line.id]);if(!links.has(key))throw Error('CENTER_SOURCE_INCOMPLETE');consumed++;
   const bucket=buckets.get(links.get(key)!)!;
   if(e.date<query.from)return;
   for(const leg of journal.lines.slice(index*2,index*2+2)){
    const kind=accounts.get(leg.accountId)!.kind;
    if(kinds.some(k=>k===kind))bucket.set(kind,(bucket.get(kind)??new D(0)).plus(leg.debit).minus(leg.credit));
   }
  });
 }
 if(consumed!==links.size)throw Error('CENTER_SOURCE_EXTRA');
 const rows=[...buckets].map(([centerId,b])=>{
  const n=(kind:string)=>b.get(kind)??new D(0),revenue=n('REVENUE').negated(),costOfSales=n('COGS'),operatingExpenses=n('OPEX'),finance=n('FINANCE'),tax=n('TAX'),grossProfit=revenue.minus(costOfSales),operatingProfit=grossProfit.minus(operatingExpenses),netProfit=operatingProfit.minus(finance).minus(tax);
  return{centerId,name:centerId===null?null:centers.get(centerId)!.name,income:Object.fromEntries(Object.entries({revenue,costOfSales,grossProfit,operatingExpenses,operatingProfit,finance,tax,netProfit}).map(([k,v])=>[k,v.toFixed(4)]))};
 });
 for(const [key,value]of Object.entries(company.statements.income))if(!rows.reduce((sum,r)=>sum.plus(r.income[key]),new D(0)).eq(value))throw Error('CENTER_INCOME_UNRECONCILED');
 return{scope:'COST_CENTER_INCOME_ONLY' as const,organizationId:query.organization,from:query.from,to:query.to,currency:company.statements.currency,rows,companyIncome:company.statements.income};
}
