import {sourceVoucher} from './source-voucher';
import type {VoucherIdentity} from './voucher-identity';
import Decimal from 'decimal.js';
import type { InvoiceSource } from './asset-invoice-source';
export type ReportEvent = {id:string;source_module?:string;event_type?:string;document_kind?:string;document_type?:string;document_number?:string;voucher_number?:string;voucher_type?:string;is_opening?:boolean;organization_id:string;counterparty_id:string|null;event_date:string;due_date:string|null;status:string;description:string;source_record_id?:string|null;entity_id?:string|null};
export type ReportObligation = {id:string;event_id:string;organization_id:string;obligation_type:string;settleable_base_amount:number|string;base_currency:string;adjusts_obligation_id?:string|null;adjustment_effect?:string|null};
export type ReportAllocation = {id:string;organization_id:string;application_event_id:string;obligation_id:string;source_advance_obligation_id?:string|null;base_amount:number|string;allocation_type:string};
export type ReportMovement = VoucherIdentity & {id:string;createdAt?:string;installmentAllocations?:Array<{debtId:string;due:string;amount:number}>;debtId?:string;category?:string;source?:string;organizationId:string;partyKey:string;partyName:string;side:'SALES'|'PURCHASE';date:string;due:string|null;reference:string;description:string;currency:string;amount:number;advance:boolean;kind:string;entityId?:string|null};
export type ReportInvoice = VoucherIdentity & {source?:InvoiceSource;id:string;organizationId:string;partyKey:string;partyName:string;side:'SALES'|'PURCHASE';date:string;reference:string;currency:string;net:number;tax:number;total:number;classification:string};
export type ReportData = {movements:ReportMovement[];invoices:ReportInvoice[];organizations:Array<{id:string;name:string}>;unposted:number};
const n=(v:number|string)=>new Decimal(v||0);
export function buildReportMovements(events:ReportEvent[],obligations:ReportObligation[],allocations:ReportAllocation[],parties:Array<{id:string;organization_id:string;name:string}>,references:Map<string,string>,sourceSides:Map<string,'SALES'|'PURCHASE'>=new Map()):ReportMovement[]{
 const byEvent=new Map(events.filter(e=>e.status==='ACTUAL').map(e=>[e.id,e]));
 const byOb=new Map(obligations.map(o=>[o.id,o]));
 const names=new Map(parties.map(p=>[`${p.organization_id}:${p.id}`,p.name]));
 const rows:ReportMovement[]=[];
 function add(id:string,event:ReportEvent,ob:ReportObligation,amount:Decimal,kind:string){
  const root=ob.adjusts_obligation_id?byOb.get(ob.adjusts_obligation_id):ob;
  if(!root||!byEvent.has(root.event_id)||root.organization_id!==event.organization_id)return;
  const owner=byEvent.get(root.event_id)!;
  const side=sourceSides.get(owner.source_record_id||'')||(['RECEIVABLE','CUSTOMER_ADVANCE'].includes(root.obligation_type)?'SALES':['PAYABLE','SUPPLIER_ADVANCE'].includes(root.obligation_type)?'PURCHASE':null);
  if(!side)return;
  const advance=root.obligation_type.endsWith('_ADVANCE');
  const opposite=(side==='SALES'&&root.obligation_type==='PAYABLE')||(side==='PURCHASE'&&root.obligation_type==='RECEIVABLE');
  const factor=advance||opposite?-1:1;
  const partyKey=`${owner.organization_id}:${owner.counterparty_id||'unmapped:'+owner.id}`;
  rows.push({...sourceVoucher(event.document_number?'INVOICE':'EVENT',event),...(event.voucher_number?{voucherNumber:event.voucher_number,voucherType:event.voucher_type}:{}),isOpening:Boolean(event.is_opening&&['INVOICE','ADVANCE'].includes(kind)),id,debtId:root.id,source:owner.source_module,entityId:owner.entity_id??null,organizationId:owner.organization_id,partyKey,partyName:names.get(partyKey)||'—',side,date:event.event_date,due:owner.due_date,reference:references.get(event.source_record_id||'')||event.id,description:event.description,currency:root.base_currency,amount:amount.mul(factor).toNumber(),advance,kind});
 }
 for(const ob of obligations){const e=byEvent.get(ob.event_id);if(!e)continue;const sign=ob.adjustment_effect==='DECREASE'?-1:1;const advance=ob.obligation_type.endsWith('_ADVANCE');add('ob:'+ob.id,e,ob,n(ob.settleable_base_amount).mul(sign),ob.adjusts_obligation_id?'ADJUSTMENT':advance?'ADVANCE':'INVOICE');}
 for(const a of allocations){const e=byEvent.get(a.application_event_id),ob=byOb.get(a.obligation_id);if(!e||!ob||a.organization_id!==ob.organization_id)continue;add('allocation:'+a.id,e,ob,n(a.base_amount).negated(),a.allocation_type);
  const advance=a.source_advance_obligation_id?byOb.get(a.source_advance_obligation_id):null;if(advance)add('advance-use:'+a.id,e,advance,n(a.base_amount).negated(),'ADVANCE_APPLICATION');
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function summarizeReportParties(rows:ReportMovement[],side:'SALES'|'PURCHASE',currency:string,to:string){
 const map=new Map<string,{key:string;name:string;organizationId:string;due:Decimal;advance:Decimal;overdue:Decimal;increases:Decimal;decreases:Decimal}>();
 for(const r of rows.filter(r=>r.side===side&&r.currency===currency&&r.date<=to)){
  const p=map.get(r.partyKey)||{key:r.partyKey,name:r.partyName,organizationId:r.organizationId,due:n(0),advance:n(0),overdue:n(0),increases:n(0),decreases:n(0)};
  if(r.advance)p.advance=p.advance.minus(r.amount);else{p.due=p.due.plus(r.amount);if(r.due&&r.due<to)p.overdue=p.overdue.plus(r.amount);}
  if(r.amount>0)p.increases=p.increases.plus(r.amount);else p.decreases=p.decreases.minus(r.amount);map.set(r.partyKey,p);
 }
 return [...map.values()].map(p=>({...p,due:p.due.toNumber(),advance:p.advance.toNumber(),overdue:Decimal.max(0,p.overdue).toNumber(),increases:p.increases.toNumber(),decreases:p.decreases.toNumber()}));
}
export function reportStatement(rows:ReportMovement[],partyKey:string,side:'SALES'|'PURCHASE',currency:string,from:string,to:string){
 const all=rows.filter(r=>r.partyKey===partyKey&&r.side===side&&r.currency===currency&&r.date<=to);
 const openingMovements=all.filter(r=>r.isOpening);
 let balance=all.filter(r=>r.date<from||r.isOpening).reduce((s,r)=>s.plus(r.amount),n(0));const opening=balance.toNumber();
 const movements=all.filter(r=>r.date>=from&&!r.isOpening).map(r=>{balance=balance.plus(r.amount);return {...r,balance:balance.toNumber(),debit:side==='SALES'?Math.max(0,r.amount):Math.max(0,-r.amount),credit:side==='SALES'?Math.max(0,-r.amount):Math.max(0,r.amount)};});
 return {opening,openingMovements,closing:balance.toNumber(),movements};
}
export function reportCsv(rows:Array<Array<string|number>>){return '\ufeff'+rows.map(row=>row.map(v=>{const value=String(v);const safe=typeof v==='string'&&/^\s*[=+\-@]|^[\t\r]/.test(value)?"'"+value:value;return '"'+safe.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
