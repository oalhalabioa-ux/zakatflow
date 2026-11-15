import Decimal from 'decimal.js';
import {z} from 'zod';
import {compileEventLedger} from './financial-event-ledger';
import {normalizeStatementSource,statementSourceEnvelope} from './financial-statement-source';
import {reviewControlledGroupSources} from './financial-group-source-review';
import type {GroupControlPreflight} from './financial-group-control';
import {previewGroupEliminations,type GroupElimination} from './financial-group-adjustments';

const D=Decimal.clone({precision:50});
const reference=z.object({organizationId:z.string().uuid(),eventId:z.string().min(1).max(200),
 lineId:z.string().min(1).max(200),accountId:z.string().regex(/^\d{4}(?:\d{2}){1,3}$/)}).strict();
export const sourceBoundAdjustmentSchema=z.object({id:z.string().uuid(),
 documentMatchId:z.string().uuid().optional(),
 kind:z.enum(['INTERCOMPANY_BALANCE','INTERCOMPANY_INCOME','CAPITAL_CONTRIBUTION']),date:z.string().date(),
 amount:z.string().regex(/^\d{1,20}(\.\d{1,4})?$/),reason:z.string().trim().min(8).max(2000),
 debitSource:reference,creditSource:reference}).strict();
export type SourceBoundAdjustment=z.infer<typeof sourceBoundAdjustmentSchema>;
const key=(...parts:string[])=>JSON.stringify(parts);

/** Read-only worksheet, NOT approval or proof that the counterparties match.
 * The server must independently authorize and attest each complete source.
 * Each proposed adjustment points to an actual GL leg, not a free-text invoice
 * reference or a parent-account total. Documentary pairing still requires an
 * audited approval before it may become a final group elimination.
 */
export function previewSourceBoundGroupEliminations(control:GroupControlPreflight,raw:readonly unknown[],input:unknown){
 const requests=z.array(sourceBoundAdjustmentSchema).max(200).parse(input);
 const envelopes=raw.map(r=>statementSourceEnvelope.parse(r));
 const snapshots=envelopes.map(p=>normalizeStatementSource(p,{organization:p.organizationId,from:control.from,to:control.to}));
 const preflight=reviewControlledGroupSources(control,snapshots);
 const members=new Map(envelopes.map((p,i)=>[p.organizationId,{p,snapshot:snapshots[i],compiled:compileEventLedger(p)}]));
 const consumed=new Map<string,Decimal>();
 const bindings:{adjustmentId:string;debitSource:SourceBoundAdjustment['debitSource'];creditSource:SourceBoundAdjustment['creditSource'];amount:string}[]=[];
 function resolve(ref:SourceBoundAdjustment['debitSource'],side:'debit'|'credit',entry:SourceBoundAdjustment){
  const member=members.get(ref.organizationId);
  if(!member)throw Error('GROUP_ADJUSTMENT_MEMBERSHIP_INVALID');
  const {p,snapshot,compiled}=member;
  const event=p.events.find(e=>e.id===ref.eventId);
  const journal=compiled.source.journals.find(j=>j.id===ref.eventId);
  const account=snapshot.accounts.find(a=>a.id===ref.accountId);
  if(!event||!journal||!account||event.reversesEventId||event.date>entry.date||
   p.events.some(e=>e.reversesEventId===event.id&&['ACTUAL','REVERSED'].includes(e.status)&&e.date<=p.to))
   throw Error('GROUP_ADJUSTMENT_SOURCE_LEG_UNAVAILABLE');
  if(entry.kind==='INTERCOMPANY_INCOME'&&event.date<control.from)throw Error('GROUP_ADJUSTMENT_SOURCE_PERIOD_MISMATCH');
  const index=event.lines.findIndex(l=>l.id===ref.lineId);
  if(index<0)throw Error('GROUP_ADJUSTMENT_SOURCE_LEG_UNAVAILABLE');
  // Compiler emits exactly two GL legs per immutable recognition-line part.
  const legs=journal.lines.slice(index*2,index*2+2);
  const opposite=side==='debit'?'credit':'debit';
  const leg=legs.find(l=>l.accountId===ref.accountId&&new D(l[opposite]).gt(0));
  const reportingCode=account.reportingCode??account.id;
  if(!leg||account.cash||reportingCode===account.id)throw Error('GROUP_ADJUSTMENT_SOURCE_LEG_UNAVAILABLE');
  const n=new D(entry.amount),sourceKey=key(entry.kind,ref.organizationId,ref.eventId,ref.lineId,ref.accountId);
  const accountKey=key('account',ref.organizationId,ref.accountId);
  const sourceRemaining=new D(leg[opposite]).minus(consumed.get(sourceKey)??0);
  const accountRemaining=new D(account.balance).mul(side==='debit'?-1:1).minus(consumed.get(accountKey)??0);
  if(!n.gt(0)||n.gt(sourceRemaining)||n.gt(accountRemaining))throw Error('GROUP_ADJUSTMENT_EXCEEDS_DETAIL_SOURCE');
  consumed.set(sourceKey,(consumed.get(sourceKey)??new D(0)).plus(n));
  consumed.set(accountKey,(consumed.get(accountKey)??new D(0)).plus(n));
  return{organizationId:ref.organizationId,accountCode:ref.accountId,reportingCode,
   debit:side==='debit'?n.toFixed(4):'0.0000',credit:side==='credit'?n.toFixed(4):'0.0000'};
 }
 const entries:GroupElimination[]=requests.map(entry=>{
  if(entry.debitSource.organizationId===entry.creditSource.organizationId)throw Error('GROUP_ADJUSTMENT_MEMBERSHIP_INVALID');
  if(entry.kind==='CAPITAL_CONTRIBUTION'){
   const relationship=control.relationships.find(r=>r.parentOrganizationId===entry.creditSource.organizationId&&r.subsidiaryOrganizationId===entry.debitSource.organizationId);
   if(!relationship||!new D(relationship.directEconomicInterestPercent).eq(100))throw Error('GROUP_CAPITAL_CONTROL_UNSUPPORTED');
   if(entry.date!==control.to)throw Error('GROUP_CAPITAL_CLOSING_DATE_REQUIRED');
   for(const ref of[entry.debitSource,entry.creditSource]){
    const event=members.get(ref.organizationId)?.p.events.find(e=>e.id===ref.eventId);
    if(!event||event.date<relationship.effectiveFrom)throw Error('GROUP_CAPITAL_ACQUISITION_EVIDENCE_REQUIRED');
   }
  }
  const debit=resolve(entry.debitSource,'debit',entry),credit=resolve(entry.creditSource,'credit',entry);
  // Only a documented contribution into an already controlled, wholly owned
  // subsidiary. Acquisition goodwill, reserves and retained earnings need
  // separate accounting evidence and must never be inferred from this pair.
  if(entry.kind==='CAPITAL_CONTRIBUTION'&&(debit.reportingCode!=='3100'||credit.reportingCode!=='1600'))throw Error('GROUP_CAPITAL_ACCOUNT_INVALID');
  bindings.push({adjustmentId:entry.id,debitSource:entry.debitSource,creditSource:entry.creditSource,amount:new D(entry.amount).toFixed(4)});
  return{id:entry.id,kind:entry.kind,date:entry.date,currency:preflight.wholeEntityRollup.currency,
   organizationIds:[debit.organizationId,credit.organizationId],reason:entry.reason,
   sourceReferences:[entry.debitSource,entry.creditSource].map(r=>key(r.organizationId,r.eventId,r.lineId,r.accountId)),lines:[debit,credit]};
 });
 const parents=preflight.wholeEntityRollup.byParent.map(r=>({code:r.code,kind:r.kind}));
 const worksheet=previewGroupEliminations(preflight.wholeEntityRollup,parents,entries);
 return{status:'SOURCE_BOUND_GROUP_PREVIEW_ONLY' as const,control:preflight.control,worksheet,bindings};
}
