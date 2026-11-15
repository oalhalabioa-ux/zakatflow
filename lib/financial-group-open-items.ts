import Decimal from 'decimal.js';
import {z} from 'zod';
import {sourceBoundAdjustmentSchema} from './financial-group-source-bound-adjustments';
const uuid=z.string().uuid(),money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const obligation=z.object({id:uuid,organization_id:uuid,event_id:uuid,obligation_type:z.string(),adjusts_obligation_id:uuid.nullable(),adjustment_effect:z.enum(['INCREASE','DECREASE']),base_currency:z.string(),settleable_base_amount:money});
export const groupOpenItemEvidenceSchema=z.object({organizationId:uuid,roots:z.array(obligation),notes:z.array(obligation),
 allocations:z.array(z.object({id:uuid,organization_id:uuid,application_event_id:uuid,obligation_id:uuid,base_currency:z.string(),base_amount:money})),
 events:z.array(z.object({id:uuid,organization_id:uuid,event_date:z.string().date(),status:z.string(),base_currency:z.string()})),
 reversals:z.array(z.object({id:uuid,organization_id:uuid,event_id:uuid,related_event_id:uuid}))});
export type GroupOpenItemEvidence=z.infer<typeof groupOpenItemEvidenceSchema>;
const D=Decimal.clone({precision:50});
/** Evidence must be independently loaded and rechecked by the server. This
 * checks outstanding balances, not reciprocal counterparty identity/approval. */
export function verifyGroupOpenItems(input:unknown,asOf:string,currency:string,evidence:readonly GroupOpenItemEvidence[]){
 const entries=z.array(sourceBoundAdjustmentSchema).parse(input),sources=new Map<string,GroupOpenItemEvidence>();
 for(const raw of evidence){const s=groupOpenItemEvidenceSchema.parse(raw);
  if(sources.has(s.organizationId))throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
  for(const rows of [s.roots,s.notes,s.allocations,s.events,s.reversals])if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>r.organization_id!==s.organizationId))throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
  sources.set(s.organizationId,s);
 }
 const consumed=new Map<string,Decimal>(),bindings:{adjustmentId:string;organizationId:string;obligationId:string;outstanding:string;eliminated:string}[]=[];
 for(const entry of entries.filter(e=>e.kind==='INTERCOMPANY_BALANCE')){
  if(entry.date!==asOf)throw Error('GROUP_ADJUSTMENT_BALANCE_DATE_REQUIRED');
  for(const [ref,kind] of [[entry.debitSource,'PAYABLE'],[entry.creditSource,'RECEIVABLE']] as const){
   const s=sources.get(ref.organizationId);if(!s)throw Error('REPORTING_GROUP_OPEN_ITEMS_UNAVAILABLE');
   const events=new Map(s.events.map(e=>[e.id,e]));
   const active=(id:string)=>{
    const e=events.get(id);if(!e||e.base_currency!==currency)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    if(!['ACTUAL','REVERSED','DRAFT','PLANNED','COMMITTED','CANCELLED'].includes(e.status))throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    if(!['ACTUAL','REVERSED'].includes(e.status)||e.event_date>asOf)return false;
    const reverse=s.reversals.filter(r=>r.related_event_id===id).map(r=>events.get(r.event_id));
    if(reverse.some(r=>!r))throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    const posted=reverse.filter(r=>r&&['ACTUAL','REVERSED'].includes(r.status));
    if(e.status==='REVERSED'){
     if(posted.length!==1||posted[0]!.status!=='ACTUAL'||posted[0]!.event_date<e.event_date)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
     return posted[0]!.event_date>asOf;
    }
    if(posted.length)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    return true;
   }
   const roots=s.roots.filter(o=>o.event_id===ref.eventId&&o.obligation_type===kind&&o.adjusts_obligation_id===null);
   if(roots.length!==1)throw Error('GROUP_ADJUSTMENT_OPEN_ITEM_AMBIGUOUS');
   const root=roots[0];if(root.base_currency!==currency||root.adjustment_effect!=='INCREASE'||!active(root.event_id))throw Error('GROUP_ADJUSTMENT_OPEN_ITEM_UNAVAILABLE');
   let outstanding=new D(root.settleable_base_amount);
   for(const n of s.notes.filter(n=>n.adjusts_obligation_id===root.id)){
    if(n.base_currency!==currency||n.obligation_type!==kind)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    if(active(n.event_id))outstanding=outstanding.plus(new D(n.settleable_base_amount).mul(n.adjustment_effect==='DECREASE'?-1:1));
   }
   for(const a of s.allocations.filter(a=>a.obligation_id===root.id)){
    if(a.base_currency!==currency)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
    if(active(a.application_event_id))outstanding=outstanding.minus(a.base_amount);
   }
   if(outstanding.lt(0))throw Error('REPORTING_GROUP_OPEN_ITEMS_UNRECONCILED');
   const key=JSON.stringify([s.organizationId,root.id]),amount=new D(entry.amount),used=consumed.get(key)??new D(0);
   if(!amount.gt(0)||amount.plus(used).gt(outstanding))throw Error('GROUP_ADJUSTMENT_EXCEEDS_OPEN_ITEM');
   consumed.set(key,used.plus(amount));bindings.push({adjustmentId:entry.id,organizationId:s.organizationId,obligationId:root.id,outstanding:outstanding.toFixed(4),eliminated:amount.toFixed(4)});
  }
 }
 return{status:'SOURCE_OPEN_ITEMS_VERIFIED_ONLY' as const,asOf,bindings};
}
