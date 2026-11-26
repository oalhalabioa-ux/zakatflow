import Decimal from 'decimal.js';
import {compileEventLedger} from './financial-event-ledger';
import {groupCashEliminationSchema} from './financial-group-cash-eliminations';
import {validateGroupControlScope,type GroupControlPreflight} from './financial-group-control';
import {verifyGroupDocumentMatches} from './financial-group-document-matches';
import {approvedGroupReportingRate,type GroupRatePolicy} from './financial-group-reporting-rates';
import {reviewGroupCurrencyTranslation} from './financial-group-translation-review';
import {normalizeStatementSource,statementSourceEnvelope} from './financial-statement-source';

const Money=Decimal.clone({precision:50});
const activities=['operating','investing','financing'] as const;

/** Review one fully documented cash pair in a direct two-company SAR group.
 * Charges, timing differences and unequal translated legs require other evidence.
 */
export function reviewTranslatedGroupCash(control:GroupControlPreflight,raw:readonly unknown[],input:unknown,documents:unknown,policies:readonly GroupRatePolicy[]){
 const entry=groupCashEliminationSchema.parse(input);
 const scope=validateGroupControlScope(control);
 const sources=raw.map(source=>statementSourceEnvelope.parse(source));
 if(sources.length!==2||scope.members.length!==2||new Set(sources.map(s=>s.currency)).size!==2||
  sources.find(s=>s.organizationId===scope.rootOrganizationId)?.currency!=='SAR'||
  entry.debitSource.organizationId===entry.creditSource.organizationId||
  new Set(sources.map(s=>s.organizationId)).size!==2||!scope.members.every(m=>sources.some(s=>s.organizationId===m.organizationId)))
  throw Error('GROUP_FX_CASH_SCOPE_UNSUPPORTED');
 const documented=verifyGroupDocumentMatches([entry],documents);
 const resolve=(ref:typeof entry.debitSource,direction:'OUTFLOW'|'INFLOW')=>{
  const source=sources.find(s=>s.organizationId===ref.organizationId);
  if(!source||source.origin!=='LIVE_CANONICAL_EVENTS')throw Error('GROUP_FX_CASH_SOURCE_REQUIRED');
  const event=source.events.find(e=>e.id===ref.eventId);
  const line=event?.lines[0];
  const journal=compileEventLedger(source).source.journals.find(j=>j.id===ref.eventId);
  const cash=source.accounts.find(a=>a.id===ref.accountId&&a.cash&&a.reportingCode&&a.reportingCode!==a.id);
  const leg=journal?.lines.find(l=>l.accountId===cash?.id&&new Money(direction==='OUTFLOW'?l.credit:l.debit).gt(0));
  if(!event||event.date!==entry.date||event.date<control.from||event.date>control.to||event.reversesEventId||
   source.events.some(e=>e.reversesEventId===event.id&&e.date<=control.to)||
   event.lines.length!==1||line?.id!==ref.lineId||line.cashDirection!==direction||line.recognitionSign!==1||
   !leg?.cashActivity||journal?.lines.some(l=>l.accountId!==cash?.id&&source.accounts.find(a=>a.id===l.accountId)?.cash))
   throw Error('GROUP_FX_CASH_SOURCE_REQUIRED');
  const rate=approvedGroupReportingRate(policies,source.organizationId,source.currency,'SAR',event.date);
  const original=new Money(direction==='OUTFLOW'?leg.credit:leg.debit);
  return {...ref,activity:leg.cashActivity.toLowerCase() as typeof activities[number],original:original.toFixed(4),rate,
   translated:original.times(rate.rate).toDecimalPlaces(4).toFixed(4)};
 };
 const outflow=resolve(entry.debitSource,'OUTFLOW'),inflow=resolve(entry.creditSource,'INFLOW');
 const amount=new Money(entry.amount);
 if(!amount.gt(0)||!amount.eq(inflow.translated)||!amount.eq(outflow.translated))throw Error('GROUP_FX_CASH_TRANSLATED_AMOUNTS_MISMATCH');
 const projected=sources.map(source=>{
  const snapshot=normalizeStatementSource(source,{organization:source.organizationId,from:control.from,to:control.to});
  if(source.currency==='SAR')return {...snapshot.statements.cash,exchangeRateEffect:'0'};
  const dates=[...new Set([source.openingDate,source.to,...snapshot.canonicalJournalLineage.map(j=>j.date)])];
  const rates=dates.map(date=>approvedGroupReportingRate(policies,source.organizationId,source.currency,'SAR',date))
   .map(({date,rate,reference})=>({date,rate,reference}));
  return reviewGroupCurrencyTranslation(source,{functionalCurrency:source.currency,presentationCurrency:'SAR',measurement:'NON_HYPERINFLATIONARY',rates}).cash;
 });
 const total=(key:typeof activities[number]|'opening'|'closing'|'exchangeRateEffect')=>projected.reduce((sum,p)=>sum.plus(p[key]),new Money(0));
 const rows=activities.map(activity=>{
  const before=total(activity);
  const adjustment=new Money(outflow.activity===activity?entry.amount:0).minus(inflow.activity===activity?entry.amount:0);
  return {activity,before:before.toFixed(4),adjustment:adjustment.toFixed(4),after:before.plus(adjustment).toFixed(4)};
 });
 const opening=total('opening'),closing=total('closing'),exchange=total('exchangeRateEffect');
 const after=rows.reduce((sum,r)=>sum.plus(r.after),opening.plus(exchange));
 if(!after.eq(closing))throw Error('GROUP_FX_CASH_UNRECONCILED');
 return {status:'GROUP_FX_CASH_PREVIEW_ONLY' as const,documented,outflow,inflow,rows,eliminated:amount.toFixed(4),
  opening:opening.toFixed(4),closing:closing.toFixed(4),exchangeRateEffect:exchange.toFixed(4)};
}
