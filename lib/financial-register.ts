import {debtCategorySchema} from './debt-categories';
import Decimal from 'decimal.js';
import {z} from 'zod';
import type {ReportMovement} from './vat-financial-reports';

export type CashAccount={id:string;name:string;type:string;currency:string;nativeCurrency:string;balance:number;restricted:number;uncleared:number;baseCurrency:string;baseBalance:number;organizationId:string|null;entityId:string|null;source:'PERSONAL_ASSETS'|'LIQUIDITY';openingDate:string|null};
export type CashMovement={id:string;accountId:string;date:string;createdAt?:string;currency:string;amount:number;description:string;reference:string;source:string};
export type RegisterAsset={id:string;name:string;type:string;currency:string;cost:number;market:number;organizationId:string|null;entityId:string|null;category:'ASSET'|'INVESTMENT'|'LEGACY_CASH'|'LEGACY_RECEIVABLE';source:string};
export type DebtItem={id:string;partyKey:string;partyName:string;organizationId:string|null;entityId:string|null;side:'RECEIVABLE'|'PAYABLE'|'CUSTOMER_ADVANCE'|'SUPPLIER_ADVANCE'|'UNAPPLIED';currency:string;amount:number;dueDate:string|null;date:string;description:string;source:string;eventId:string|null;category?:string;categoryInferred?:boolean;categoryOrigin?:'PERSONAL_RECEIVABLE'|'PERSONAL_PAYABLE'|'CORE';reference?:string;originalCurrency?:string;originalAmount?:number;exchangeRate?:number;totalBase?:number;appliedBase?:number};
export type RegisterData={asOf:string;baseCurrency:string;organizations:Array<{id:string;name:string;base_currency:string;parent_organization_id:string|null;organization_kind:string}>;organizationIds:string[];entities:Array<{id:string;name:string;organization_id:string}>;accounts:CashAccount[];cashMovements:CashMovement[];debts:DebtItem[];debtMovements:ReportMovement[];assets:RegisterAsset[];warnings:string[];personalPayments?:Array<{id:string;payable_id:string;account_id:string;transaction_id:string;amount:number;payment_date:string;notes:string;reversed:boolean;reversalDate?:string}>};
export const openingFinancialAccountSchema=z.object({request_id:z.string().uuid(),scope:z.enum(['PERSONAL','ORGANIZATION']),organization_id:z.string().uuid().nullable().default(null),entity_id:z.string().uuid().nullable().default(null),type:z.enum(['BANK','CASH','RECEIVABLE']),source_debt_id:z.string().uuid().optional(),debt_category:debtCategorySchema.optional(),name:z.string().trim().min(1).max(120),currency:z.string().regex(/^[A-Z]{3}$/),opening_balance:z.number().finite().min(0).max(1e12),opening_date:z.string().date(),hawl_start_date:z.string().date().nullable().default(null),fx_rate:z.number().finite().positive().max(1e6),due_date:z.string().date().nullable().default(null),notes:z.string().trim().max(500).default('')}).strict().superRefine((p,c)=>{
 if(p.scope==='PERSONAL'&&(p.organization_id||p.entity_id)||p.scope==='ORGANIZATION'&&!p.organization_id)c.addIssue({code:'custom',message:'FINANCIAL_ACCOUNT_SCOPE_INVALID'});
 if(p.type==='RECEIVABLE'&&(p.scope!=='PERSONAL'||p.opening_balance<=0))c.addIssue({code:'custom',message:'ORGANIZATION_DEBT_REQUIRES_FINANCIAL_CORE'});
 if(p.debt_category&&(!p.debt_category.startsWith('P_AR_')||p.type!=='RECEIVABLE'||p.scope!=='PERSONAL'))c.addIssue({code:'custom',message:'DEBT_CATEGORY_SIDE_MISMATCH'});
 if(p.source_debt_id&&(p.scope!=='PERSONAL'||p.type!=='RECEIVABLE'))c.addIssue({code:'custom',message:'PERSONAL_DEBT_SOURCE_INVALID'});
 if(p.hawl_start_date&&p.hawl_start_date>p.opening_date)c.addIssue({code:'custom',message:'HAWL_AFTER_OPENING_DATE'});
});
export const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const personalCashTransferSchema=z.object({action:z.enum(['TRANSFER','COLLECT']),request_id:z.string().uuid(),source_id:z.string().uuid(),destination_id:z.string().uuid(),amount:z.number().finite().positive().max(1e12),date:z.string().date(),notes:z.string().trim().min(1).max(500)}).strict().refine(p=>p.source_id!==p.destination_id,{message:'SOURCE_AND_DESTINATION_MUST_DIFFER'});
const add=(values:number[])=>values.reduce((s,v)=>s.plus(v),new Decimal(0)).toNumber();
export function cashTotals(accounts:CashAccount[]){return [...new Set(accounts.map(a=>a.currency))].map(currency=>{const rows=accounts.filter(a=>a.currency===currency);const balance=add(rows.map(a=>a.balance)),restricted=add(rows.map(a=>a.restricted)),uncleared=add(rows.map(a=>a.uncleared));return {currency,balance,restricted,uncleared,available:new Decimal(balance).minus(restricted).minus(uncleared).toNumber(),count:rows.length};});}
// Balances are current snapshots; backwards reconstruction uses recorded actual
// movements only. Forecast flows never form part of an account statement.
export function cashStatement(account:CashAccount,movements:CashMovement[],from:string,to:string){
 const rows=movements.filter(m=>m.accountId===account.id&&m.currency===account.currency).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt??'').localeCompare(b.createdAt??'')||a.id.localeCompare(b.id));
 const opening=new Decimal(account.balance).minus(add(rows.filter(m=>m.date>=from).map(m=>m.amount)));
 let balance=opening;const lines=rows.filter(m=>m.date>=from&&m.date<=to).map(m=>{balance=balance.plus(m.amount);return {...m,balance:balance.toNumber(),inflow:Math.max(0,m.amount),outflow:Math.max(0,-m.amount)};});
 return {opening:opening.toNumber(),closing:balance.toNumber(),inflows:add(lines.map(l=>l.inflow)),outflows:add(lines.map(l=>l.outflow)),lines};
}
export function debtAging(items:DebtItem[],asOf:string){
 const groups=new Map<string,{currency:string;side:string;current:number;days1to30:number;days31to60:number;days61to90:number;over90:number;undated:number;total:number}>();
 for(const item of items.filter(i=>i.amount>0)){
  const key=item.currency+':'+item.side,g=groups.get(key)??{currency:item.currency,side:item.side,current:0,days1to30:0,days31to60:0,days61to90:0,over90:0,undated:0,total:0};
  const days=item.dueDate?Math.floor((Date.parse(asOf)-Date.parse(item.dueDate))/86400000):null;
  const field=days===null?'undated':days<=0?'current':days<=30?'days1to30':days<=60?'days31to60':days<=90?'days61to90':'over90';
  g[field]=new Decimal(g[field]).plus(item.amount).toNumber();g.total=new Decimal(g.total).plus(item.amount).toNumber();groups.set(key,g);
 }
 return [...groups.values()];
}
export function registerPosition(accounts:CashAccount[],debts:DebtItem[],assets:RegisterAsset[]){
 const currencies=[...new Set([...accounts.map(a=>a.baseCurrency),...debts.map(d=>d.currency),...assets.map(a=>a.currency)])];
 return currencies.map(currency=>{const cash=add(accounts.filter(a=>a.baseCurrency===currency).map(a=>a.baseBalance)),receivables=add(debts.filter(d=>d.currency===currency&&['RECEIVABLE','SUPPLIER_ADVANCE'].includes(d.side)).map(d=>d.amount)),liabilities=add(debts.filter(d=>d.currency===currency&&['PAYABLE','CUSTOMER_ADVANCE'].includes(d.side)).map(d=>d.amount));const recognized=assets.filter(a=>a.currency===currency&&['ASSET','INVESTMENT'].includes(a.category));const cost=add(recognized.map(a=>a.cost)),market=add(recognized.map(a=>a.market)),unreconciled=assets.filter(a=>a.currency===currency&&a.category.startsWith('LEGACY_')&&(a.cost||a.market)).length,unallocated=add(debts.filter(d=>d.currency===currency&&d.side==='UNAPPLIED').map(d=>d.amount));return {currency,cash,receivables,liabilities,cost,market,net:unreconciled||unallocated?null:new Decimal(cash).plus(receivables).plus(market).minus(liabilities).toNumber(),unreconciled,unallocated};});
}

export function debtAgingByParty(items:DebtItem[],asOf:string){
 const groups=new Map<string,DebtItem[]>();
 for(const item of items){const key=[item.partyKey,item.currency,item.side].join(':');groups.set(key,[...(groups.get(key)??[]),item]);}
 return [...groups.values()].map(rows=>({...debtAging(rows,asOf)[0],partyKey:rows[0].partyKey,partyName:rows[0].partyName,organizationId:rows[0].organizationId})).filter(r=>r.total>0).sort((a,b)=>b.over90-a.over90||a.partyName.localeCompare(b.partyName));
}
