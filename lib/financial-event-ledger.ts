import Decimal from 'decimal.js';
import {projectFinancialStatements,type CashActivity,type StatementSource,type PostedJournal} from './financial-statement-engine';

/** Pure, read-only compiler, NOT an authorized database adapter. The caller must obtain
 * canonical rows, approved mappings and a complete opening trial balance under RLS.
 * No account, counter-entry, tax split or cash activity is inferred from classifications.
 */
export type ResolvedPosting={ruleId:string;debitAccountId:string;creditAccountId:string;cashActivity?:CashActivity};
export type RecognitionLine={id:string;classificationId:string;baseAmount:string;cashDirection:'NON_CASH'|'INFLOW'|'OUTFLOW';recognitionSign:1|-1;resolvedPosting?:ResolvedPosting};
export type RecognitionEvent={id:string;organizationId:string;currency:string;date:string;eventType:string;sourceModule:string;sourceKey:string;status:'DRAFT'|'PLANNED'|'COMMITTED'|'ACTUAL'|'REVERSED';lines:RecognitionLine[];reversesEventId?:string};
export type PostingRule={id:string;organizationId:string;currency:string;eventType:string;sourceModule:string;classificationId:string;cashDirection:RecognitionLine['cashDirection'];from:string;to:string;debitAccountId:string;creditAccountId:string;cashActivity?:CashActivity;detailed?:true};
export type ApprovedPostingPolicy={id:string;organizationId:string;currency:string;approvedBy:string;approvedAt:string;rules:PostingRule[]};
export type EventLedgerInput=Omit<StatementSource,'journals'> & {openingSourceId:string;policy:ApprovedPostingPolicy;events:RecognitionEvent[]};
const Money=Decimal.clone({precision:50});
function validDate(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}
export function compileEventLedger(input:EventLedgerInput){
 const {policy,events,...scope}=input;
 if(!scope.openingSourceId)throw Error('OPENING_SOURCE_REQUIRED');
 if(!policy.id||!policy.approvedBy||!Number.isFinite(Date.parse(policy.approvedAt)))throw Error('APPROVED_POSTING_POLICY_REQUIRED');
 const sameScope=(org:string,currency:string)=>{if(org!==input.organizationId||currency!==input.currency)throw Error('LEDGER_SCOPE_MISMATCH')};
 sameScope(policy.organizationId,policy.currency);
 const accounts=new Map(input.accounts.map(a=>[a.id,a]));
 const ruleIds=new Set<string>(),ruleIndex=new Map<string,PostingRule[]>();
 const ruleKey=(r:{eventType:string;sourceModule:string;classificationId:string;cashDirection:string})=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]);
 for(const r of policy.rules){
  sameScope(r.organizationId,r.currency);
  if(!r.id||ruleIds.has(r.id))throw Error('DUPLICATE_POSTING_RULE');ruleIds.add(r.id);
  if(!validDate(r.from)||!validDate(r.to)||r.from>r.to)throw Error('INVALID_POSTING_RULE_PERIOD');
  if(!accounts.has(r.debitAccountId)||!accounts.has(r.creditAccountId)||r.debitAccountId===r.creditAccountId&&(!accounts.get(r.debitAccountId)?.cash||r.cashDirection==='NON_CASH'))throw Error('INVALID_POSTING_ACCOUNTS');
  if(r.cashActivity&&!['OPERATING','INVESTING','FINANCING'].includes(r.cashActivity))throw Error('INVALID_CASH_ACTIVITY');
  const key=ruleKey(r);ruleIndex.set(key,[...(ruleIndex.get(key)??[]),r]);
 }
 const ids=new Set<string>(),keys=new Set<string>(),lineIds=new Set<string>();
 for(const e of events){
  sameScope(e.organizationId,e.currency);
  if(!e.id||ids.has(e.id))throw Error('DUPLICATE_SOURCE_EVENT');ids.add(e.id);
  // Keys are namespaced by the canonical producing module, never by a display label.
  const key=JSON.stringify([e.sourceModule,e.sourceKey]);
  if(!e.sourceModule||!e.sourceKey||keys.has(key))throw Error('DUPLICATE_SOURCE_KEY');keys.add(key);
  if(!validDate(e.date))throw Error('INVALID_REPORT_DATE');
  if(!['DRAFT','PLANNED','COMMITTED','ACTUAL','REVERSED'].includes(e.status))throw Error('INVALID_EVENT_STATUS');
  for(const l of e.lines){if(!l.id||lineIds.has(l.id))throw Error('DUPLICATE_SOURCE_LINE');lineIds.add(l.id)}
 }
 const lineage:{journalId:string;eventId:string;lineId:string;ruleId:string}[]=[],journals:PostedJournal[]=[];
 const requiresResolution=policy.rules.some(rule=>rule.detailed===true);
 const eligible=events.filter(e=>['ACTUAL','REVERSED'].includes(e.status)&&e.date>=input.fiscalStart&&e.date<=input.to);
 for(const e of eligible){
  if(!e.lines.length)throw Error('EMPTY_RECOGNITION_EVENT');
  const lines:PostedJournal['lines']=[];
  for(const l of e.lines){
   if(!/^\d{1,20}(\.\d{1,4})?$/.test(l.baseAmount)||!new Money(l.baseAmount).gt(0)||![1,-1].includes(l.recognitionSign))throw Error('INVALID_RECOGNITION_AMOUNT');
   if(!['NON_CASH','INFLOW','OUTFLOW'].includes(l.cashDirection))throw Error('INVALID_CASH_DIRECTION');
   if(requiresResolution&&!l.resolvedPosting)throw Error('REPORTING_EVENT_POSTING_REQUIRED');
   const matches=(ruleIndex.get(ruleKey({...e,...l}))??[]).filter(r=>r.from<=e.date&&r.to>=e.date);
   if(!l.resolvedPosting&&matches.length!==1)throw Error(matches.length?'AMBIGUOUS_POSTING_RULE':'POSTING_RULE_REQUIRED');
   const r=l.resolvedPosting??matches[0],n=new Money(l.baseAmount).toFixed(4);
   if(!accounts.has(r.debitAccountId)||!accounts.has(r.creditAccountId))throw Error('INVALID_POSTING_ACCOUNTS');
   const debit=l.recognitionSign===1?r.debitAccountId:r.creditAccountId,credit=l.recognitionSign===1?r.creditAccountId:r.debitAccountId;
   const cashDebit=Boolean(accounts.get(debit)?.cash),cashCredit=Boolean(accounts.get(credit)?.cash);
   if(l.cashDirection==='NON_CASH'&&(cashDebit||cashCredit)||l.cashDirection!=='NON_CASH'&&!cashDebit&&!cashCredit)throw Error('POSTING_CASH_DIRECTION_MISMATCH');
   const expected=l.recognitionSign===1?l.cashDirection:l.cashDirection==='INFLOW'?'OUTFLOW':l.cashDirection==='OUTFLOW'?'INFLOW':'NON_CASH';
   if(cashDebit!==cashCredit&&(expected==='INFLOW'&&!cashDebit||expected==='OUTFLOW'&&!cashCredit))throw Error('POSTING_CASH_DIRECTION_MISMATCH');
   if(cashDebit!==cashCredit&&!r.cashActivity)throw Error('CASH_ACTIVITY_MAPPING_REQUIRED');
   lines.push({accountId:debit,debit:n,credit:'0.0000',...(cashDebit?{cashActivity:r.cashActivity}:{})},{accountId:credit,debit:'0.0000',credit:n,...(cashCredit?{cashActivity:r.cashActivity}:{})});
   lineage.push({journalId:e.id,eventId:e.id,lineId:l.id,ruleId:l.resolvedPosting?.ruleId??matches[0].id});
  }
  journals.push({id:e.id,organizationId:e.organizationId,currency:e.currency,date:e.date,status:'POSTED',lines,...(e.reversesEventId?{reversesJournalId:e.reversesEventId}:{})});
 }
 const reversed=new Set<string>(),eligibleById=new Map(eligible.map(e=>[e.id,e])),reversalDates=new Map<string,string>();
 for(const e of events)if(e.reversesEventId&&['ACTUAL','REVERSED'].includes(e.status))reversalDates.set(e.reversesEventId,e.date);
 for(const e of eligible){
  if(e.reversesEventId){const original=eligibleById.get(e.reversesEventId);if(!original||original.status!=='REVERSED'||reversed.has(original.id))throw Error('INVALID_REVERSAL_SOURCE');reversed.add(original.id)}
  if(e.status==='REVERSED'&&(!reversalDates.has(e.id)||reversalDates.get(e.id)!<e.date))throw Error('REVERSAL_EVENT_REQUIRED');
 }
 const source:StatementSource={...scope,journals};
 // Engine verifies opening, accounts, exact reversal and all statement reconciliations.
 const statements=projectFinancialStatements(source);
 return{source,statements,lineage,policyId:policy.id,openingSourceId:input.openingSourceId};
}
