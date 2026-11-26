import Decimal from 'decimal.js';
import {z} from 'zod';
import {compileEventLedger} from './financial-event-ledger';
import {validateGroupControlScope,type GroupControlPreflight} from './financial-group-control';
import {verifyGroupDocumentMatches} from './financial-group-document-matches';
import {groupReportingRate} from './financial-group-reporting-rates';
import {sourceBoundAdjustmentSchema} from './financial-group-source-bound-adjustments';
import {normalizeStatementSource,statementSourceEnvelope} from './financial-statement-source';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const leg=sourceBoundAdjustmentSchema.shape.debitSource.extend({remeasurementEventId:z.string().uuid().optional()});
const request=z.object({
 id:z.string().uuid(),documentMatchId:z.string().uuid(),debitSource:leg,creditSource:leg,
 presentationCurrency:z.literal('SAR'),
}).strict();

/** Matched ordinary trade pair at published month-end rates. The caller must
 * supply current independently authorized source and documentary evidence.
 * Each selected receivable/payable leaf must be dedicated to this obligation.
 */
export function reviewCrossCurrencyTrade(control:GroupControlPreflight,raw:readonly unknown[],input:unknown,documents:unknown){
 const query=request.parse(input);
 const scope=validateGroupControlScope(control);
 const sources=raw.map(source=>statementSourceEnvelope.parse(source));
 const pair=[query.creditSource.organizationId,query.debitSource.organizationId];
 if(sources.length!==2||scope.members.length!==2||new Set(pair).size!==2||
  scope.members.some(member=>!pair.includes(member.organizationId))||
  sources.some(source=>!pair.includes(source.organizationId))||
  new Set(sources.map(source=>source.organizationId)).size!==2||
  new Set(sources.map(source=>source.currency)).size!==2||
  sources.find(source=>source.organizationId===scope.rootOrganizationId)?.currency!==query.presentationCurrency)
  throw Error('GROUP_FX_TRADE_SCOPE_UNSUPPORTED');
 verifyGroupDocumentMatches([query],documents);
 const format=(value:Decimal)=>value.toFixed(4);

 function project(ref:z.infer<typeof leg>,seller:boolean){
  const source=sources.find(item=>item.organizationId===ref.organizationId)!;
  if(source.origin!=='LIVE_CANONICAL_EVENTS'||source.from!==source.fiscalStart)
   throw Error('GROUP_FX_TRADE_SOURCE_INVALID');
  const snapshot=normalizeStatementSource(source,{organization:source.organizationId,from:control.from,to:control.to},true);
  const compiled=compileEventLedger(source);
  const metadata=new Map(source.accounts.map(a=>[a.id,a]));
  const account=metadata.get(ref.accountId);
  const ledger=snapshot.periodLedger!.accounts.find(a=>a.id===ref.accountId);
  if(account?.kind!==(seller?'ASSET':'LIABILITY')||account.reportingCode!==(seller?'1100':'2100')||
   account.cash||!ledger||!new Money(ledger.opening).isZero())throw Error('GROUP_FX_TRADE_SOURCE_INVALID');

  const event=source.events.find(e=>e.id===ref.eventId);
  const journal=compiled.source.journals.find(j=>j.id===ref.eventId);
  if(!event||event.status!=='ACTUAL'||event.eventType!==(seller?'REVENUE':'EXPENSE')||event.reversesEventId||
   event.lines.length!==1||event.lines[0].id!==ref.lineId||event.lines[0].cashDirection!=='NON_CASH'||
   event.lines[0].recognitionSign!==1||!journal||journal.lines.length!==2)
   throw Error('GROUP_FX_TRADE_SOURCE_INVALID');

  const trade=journal.lines.find(l=>l.accountId===ref.accountId);
  const original=new Money(trade?.[seller?'debit':'credit']??0);
  const counterpart=journal.lines.find(l=>l.accountId!==ref.accountId);
  if(!original.gt(0)||!counterpart||metadata.get(counterpart.accountId)?.kind!==(seller?'REVENUE':'OPEX'))
   throw Error('GROUP_FX_TRADE_SOURCE_INVALID');
  const subsequent=ledger.entries.filter(line=>line.journalId!==ref.eventId);
  let exchangeProfit=new Money(0);
  if(ref.remeasurementEventId){
   const adjustment=source.events.find(e=>e.id===ref.remeasurementEventId);
   const posted=compiled.source.journals.find(j=>j.id===ref.remeasurementEventId);
   const profitLeg=posted?.lines.find(l=>l.accountId!==ref.accountId);
   if(subsequent.length!==1||subsequent[0].journalId!==ref.remeasurementEventId||
    adjustment?.eventType!=='FX_REMEASUREMENT'||adjustment.date!==control.to||adjustment.date<=event.date||
    adjustment.status!=='ACTUAL'||adjustment.reversesEventId||posted?.lines.length!==2||
    !profitLeg||metadata.get(profitLeg.accountId)?.kind!=='FINANCE')
    throw Error('GROUP_FX_REMEASUREMENT_SOURCE_INVALID');
   exchangeProfit=new Money(profitLeg.credit).minus(profitLeg.debit);
  }else if(subsequent.length)throw Error('GROUP_FX_TRADE_SOURCE_INVALID');

  const transactionRate=groupReportingRate(source.currency,query.presentationCurrency,event.date);
  const closingRate=groupReportingRate(source.currency,query.presentationCurrency,control.to);
  return {date:event.date,currency:source.currency,original:original.times(transactionRate.rate),
   closing:new Money(ledger.closing).times(seller?1:-1).times(closingRate.rate),
   exchangeProfit:exchangeProfit.times(closingRate.rate),transactionRate,closingRate};
 }

 const receivable=project(query.creditSource,true);
 const payable=project(query.debitSource,false);
 if(receivable.date!==payable.date||!receivable.original.eq(payable.original))
  throw Error('GROUP_FX_TRADE_DATE_OR_AMOUNT_MISMATCH');
 if(!receivable.closing.gt(0)||!receivable.closing.eq(payable.closing))
  throw Error('GROUP_FX_CLOSING_BALANCES_UNRECONCILED');
 const exchangeProfit=receivable.exchangeProfit.plus(payable.exchangeProfit);
 return {status:'GROUP_FX_MATCHED_TRADE_REVIEW_ONLY' as const,currency:query.presentationCurrency,
  documentMatchId:query.documentMatchId,transactionDate:receivable.date,closingDate:control.to,
  receivableEliminated:format(receivable.closing),payableEliminated:format(payable.closing),
  revenueEliminated:format(receivable.original),expenseEliminated:format(payable.original),
  profitBeforeElimination:format(exchangeProfit),profitAfterElimination:format(exchangeProfit),
  rates:[receivable.transactionRate,receivable.closingRate,payable.transactionRate,payable.closingRate].filter(row=>row.fromCurrency!==row.toCurrency)};
}
