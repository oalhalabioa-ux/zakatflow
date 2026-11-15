import Decimal from 'decimal.js';
import {z} from 'zod';
import {compileEventLedger} from './financial-event-ledger';
import {normalizeStatementSource,statementSourceEnvelope} from './financial-statement-source';
import {reviewControlledGroupSources} from './financial-group-source-review';
import {verifyGroupDocumentMatches} from './financial-group-document-matches';
import type {GroupControlPreflight} from './financial-group-control';
import {sourceBoundAdjustmentSchema} from './financial-group-source-bound-adjustments';
const D=Decimal.clone({precision:50});
export const groupCashEliminationSchema=sourceBoundAdjustmentSchema.extend({
 kind:z.literal('INTERCOMPANY_CASH'),documentMatchId:z.string().uuid(),incomeTreatment:z.never().optional()
});
export const groupAdjustmentSchema=z.union([sourceBoundAdjustmentSchema,groupCashEliminationSchema]);
const activities=['OPERATING','INVESTING','FINANCING'] as const;
type Activity=typeof activities[number];
/** Read-only cash worksheet. Documentary approval alone is not elimination
 * approval or group completeness. Remove each original flow from its own
 * activity; do not alter legal-company cash balances or infer counterparties. */
export function previewGroupCashEliminations(control:GroupControlPreflight,raw:readonly unknown[],input:unknown,documentEvidence:unknown){
 const entries=z.array(groupCashEliminationSchema).max(200).parse(input);
 const envelopes=raw.map(p=>statementSourceEnvelope.parse(p));
 const snapshots=envelopes.map(p=>normalizeStatementSource(p,{organization:p.organizationId,from:control.from,to:control.to}));
 const preflight=reviewControlledGroupSources(control,snapshots);
 const documents=verifyGroupDocumentMatches(entries,documentEvidence);
 const members=new Map(envelopes.map(p=>[p.organizationId,{p,ledger:compileEventLedger(p)}]));
 const ids=new Set<string>(),consumed=new Map<string,Decimal>();
 const adjustments=new Map<Activity,Decimal>(activities.map(a=>[a,new D(0)]));
 function resolve(ref:z.infer<typeof groupCashEliminationSchema>['debitSource'],side:'OUTFLOW'|'INFLOW',entry:z.infer<typeof groupCashEliminationSchema>){
  const member=members.get(ref.organizationId);
  if(!member)throw Error('GROUP_CASH_MEMBERSHIP_INVALID');
  const {p,ledger}=member,event=p.events.find(e=>e.id===ref.eventId);
  const journal=ledger.source.journals.find(j=>j.id===ref.eventId);
  if(!event||!journal||event.reversesEventId||event.date<control.from||event.date>entry.date||entry.date>control.to||
   p.events.some(e=>e.reversesEventId===event.id&&e.date<=control.to))throw Error('GROUP_CASH_SOURCE_UNAVAILABLE');
  const index=event.lines.findIndex(l=>l.id===ref.lineId);
  if(index<0)throw Error('GROUP_CASH_SOURCE_UNAVAILABLE');
  const legs=journal.lines.slice(index*2,index*2+2);
  const account=p.accounts.find(a=>a.id===ref.accountId);
  const leg=legs.find(l=>l.accountId===ref.accountId&&new D(side==='OUTFLOW'?l.credit:l.debit).gt(0));
  // A within-company cash transfer is not an external cash flow to eliminate.
  if(!account?.cash||!account.reportingCode||account.reportingCode===account.id||!leg?.cashActivity||
   legs.every(l=>p.accounts.find(a=>a.id===l.accountId)?.cash))throw Error('GROUP_CASH_SOURCE_UNAVAILABLE');
  const amount=new D(entry.amount),key=JSON.stringify([ref.organizationId,ref.eventId,ref.lineId,ref.accountId]);
  const used=consumed.get(key)??new D(0),capacity=new D(side==='OUTFLOW'?leg.credit:leg.debit);
  if(!amount.gt(0)||used.plus(amount).gt(capacity))throw Error('GROUP_CASH_EXCEEDS_SOURCE');
  consumed.set(key,used.plus(amount));
  adjustments.set(leg.cashActivity,adjustments.get(leg.cashActivity)!.plus(side==='OUTFLOW'?amount:amount.negated()));
  return{...ref,activity:leg.cashActivity,originalDirection:side,eliminatedAmount:amount.toFixed(4)};
 }
 const bindings=entries.map(e=>{
  if(ids.has(e.id))throw Error('GROUP_CASH_DUPLICATE_ADJUSTMENT');ids.add(e.id);
  if(e.debitSource.organizationId===e.creditSource.organizationId)throw Error('GROUP_CASH_MEMBERSHIP_INVALID');
  return{id:e.id,documentMatchId:e.documentMatchId,outflow:resolve(e.debitSource,'OUTFLOW',e),inflow:resolve(e.creditSource,'INFLOW',e)};
 });
 const totals=(field:'opening'|'closing'|'movement'|'operating'|'investing'|'financing')=>snapshots.reduce((n,s)=>n.plus(s.statements.cash[field]),new D(0));
 const rows=activities.map(activity=>{const before=totals(activity.toLowerCase() as 'operating'|'investing'|'financing'),adjustment=adjustments.get(activity)!;return{activity,before:before.toFixed(4),adjustment:adjustment.toFixed(4),after:before.plus(adjustment).toFixed(4)}});
 if(!rows.reduce((n,r)=>n.plus(r.adjustment),new D(0)).isZero()||!rows.reduce((n,r)=>n.plus(r.after),new D(0)).eq(totals('movement')))throw Error('GROUP_CASH_UNRECONCILED');
 return{status:'SOURCE_BOUND_GROUP_CASH_PREVIEW_ONLY' as const,consolidated:false as const,control:preflight.control,documents,bindings,rows,
  eliminatedInflow:entries.reduce((n,e)=>n.plus(e.amount),new D(0)).toFixed(4),eliminatedOutflow:entries.reduce((n,e)=>n.plus(e.amount),new D(0)).toFixed(4),
  opening:totals('opening').toFixed(4),movement:totals('movement').toFixed(4),closing:totals('closing').toFixed(4)};
}
