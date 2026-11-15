import Decimal from 'decimal.js';
import type {EventLedgerInput} from './financial-event-ledger';
import type {PostedJournal} from './financial-statement-engine';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
type Source={accounts:Array<EventLedgerInput['accounts'][number]&{reportingCode?:string}>;opening:EventLedgerInput['opening'];journals:PostedJournal[]};

/** Verify one paired, declared and wholly unpaid ordinary dividend. Dedicated
 * receivable/payable accounts may contain no other balance or movement. */
export function verifyOrdinaryDividend(
 parent:Source,subsidiary:Source,reference:{parentEventId:string;subsidiaryEventId:string},
 acquiredOn:string,through:string,nciPercent:string,
){
 function resolve(source:Source,id:string,debitKind:string,creditKind:string){
  const journal=source.journals.find(row=>row.id===id&&row.status==='POSTED');
  if(!journal||journal.lines.length!==2||journal.date<=acquiredOn||journal.date>through||journal.reversesJournalId||
    source.journals.some(row=>row.reversesJournalId===journal.id))return null;
  const debit=journal.lines.find(line=>new Money(line.debit).gt(0)&&new Money(line.credit).isZero());
  const credit=journal.lines.find(line=>new Money(line.credit).gt(0)&&new Money(line.debit).isZero());
  if(!debit||!credit||!new Money(debit.debit).eq(credit.credit))return null;
  const dr=source.accounts.find(account=>account.id===debit.accountId);
  const cr=source.accounts.find(account=>account.id===credit.accountId);
  if(!dr||!cr||dr.cash||cr.cash||dr.kind!==debitKind||cr.kind!==creditKind)return null;
  return {journal,dr,cr,amount:new Money(debit.debit)};
 }
 const child=resolve(subsidiary,reference.subsidiaryEventId,'EQUITY','LIABILITY');
 const owner=resolve(parent,reference.parentEventId,'ASSET','REVENUE');
 if(!child||!owner||child.journal.date!==owner.journal.date||owner.cr.id!=='410061'||
   (child.dr.reportingCode??child.dr.id)!=='3300'||(child.cr.reportingCode??child.cr.id)!=='2100'||
   (owner.dr.reportingCode??owner.dr.id)!=='1100'||child.cr.id==='2100'||owner.dr.id==='1100')return null;
 const nci=child.amount.mul(nciPercent).div(100).toDecimalPlaces(4);
 if(!owner.amount.eq(child.amount.minus(nci)))return null;
 function dedicated(source:Source,accountId:string,eventId:string){
  return source.opening.every(row=>row.accountId!==accountId||new Money(row.debit).eq(row.credit))&&
   !source.journals.some(row=>row.id!==eventId&&row.lines.some(line=>line.accountId===accountId));
 }
 if(!dedicated(subsidiary,child.cr.id,child.journal.id)||!dedicated(parent,owner.dr.id,owner.journal.id))return null;
 return {date:child.journal.date,subsidiaryEventId:child.journal.id,parentEventId:owner.journal.id,
  ordinaryDividends:child.amount.toFixed(4),parentDividend:owner.amount.toFixed(4),nciDividend:nci.toFixed(4)};
}
