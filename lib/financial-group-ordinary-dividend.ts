import Decimal from 'decimal.js';
import type {EventLedgerInput} from './financial-event-ledger';
import type {PostedJournal} from './financial-statement-engine';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
type Source={accounts:Array<EventLedgerInput['accounts'][number]&{reportingCode?:string}>;opening:EventLedgerInput['opening'];journals:PostedJournal[]};

/** Verify one paired, declared ordinary dividend and its documented payments. Dedicated
 * receivable/payable accounts may contain no other balance or movement. */
export function verifyOrdinaryDividend(
 parent:Source,subsidiary:Source,reference:{parentEventId:string;subsidiaryEventId:string;
  parentPayment?:{parentEventId:string;subsidiaryEventId:string};minorityPayment?:{subsidiaryEventId:string};
 },
 acquiredOn:string,through:string,nciPercent:string,
){
 function resolve(source:Source,id:string,debitKind:string,creditKind:string,cashSide?:'debit'|'credit'){
  const journal=source.journals.find(row=>row.id===id&&row.status==='POSTED');
  if(!journal||journal.lines.length!==2||journal.date<=acquiredOn||journal.date>through||journal.reversesJournalId||
    source.journals.some(row=>row.reversesJournalId===journal.id))return null;
  const debit=journal.lines.find(line=>new Money(line.debit).gt(0)&&new Money(line.credit).isZero());
  const credit=journal.lines.find(line=>new Money(line.credit).gt(0)&&new Money(line.debit).isZero());
  if(!debit||!credit||!new Money(debit.debit).eq(credit.credit))return null;
  const dr=source.accounts.find(account=>account.id===debit.accountId);
  const cr=source.accounts.find(account=>account.id===credit.accountId);
  if(!dr||!cr||Boolean(dr.cash)!==(cashSide==='debit')||Boolean(cr.cash)!==(cashSide==='credit')||
    dr.kind!==debitKind||cr.kind!==creditKind)return null;
  const activity=cashSide==='debit'?debit.cashActivity:cashSide==='credit'?credit.cashActivity:undefined;
  if(cashSide&&!activity)return null;
  return {journal,dr,cr,amount:new Money(debit.debit),activity};
 }
 const child=resolve(subsidiary,reference.subsidiaryEventId,'EQUITY','LIABILITY');
 const owner=resolve(parent,reference.parentEventId,'ASSET','REVENUE');
 if(!child||!owner||child.journal.date!==owner.journal.date||owner.cr.id!=='410061'||
   (child.dr.reportingCode??child.dr.id)!=='3300'||(child.cr.reportingCode??child.cr.id)!=='2100'||
   (owner.dr.reportingCode??owner.dr.id)!=='1100'||child.cr.id==='2100'||owner.dr.id==='1100')return null;
 const nci=child.amount.mul(nciPercent).div(100).toDecimalPlaces(4);
 if(!owner.amount.eq(child.amount.minus(nci)))return null;
 const parentPayments=new Set([owner.journal.id]),subsidiaryPayments=new Set([child.journal.id]);
 let parentPaid=new Money(0),minorityPaid=new Money(0);
 let internalCash:{date:string;amount:string;receiptActivity:string;paymentActivity:string}|null=null;
 if(reference.parentPayment){
  const receipt=resolve(parent,reference.parentPayment.parentEventId,'ASSET','ASSET','debit');
  const payment=resolve(subsidiary,reference.parentPayment.subsidiaryEventId,'LIABILITY','ASSET','credit');
  if(!receipt||!payment||!receipt.activity||!payment.activity||receipt.cr.id!==owner.dr.id||
    payment.dr.id!==child.cr.id||receipt.journal.date!==payment.journal.date||payment.journal.date<child.journal.date||
    !payment.amount.eq(receipt.amount)||payment.amount.gt(owner.amount))return null;
  parentPaid=payment.amount;
  parentPayments.add(receipt.journal.id);
  subsidiaryPayments.add(payment.journal.id);
  internalCash={date:payment.journal.date,amount:parentPaid.toFixed(4),receiptActivity:receipt.activity,paymentActivity:payment.activity};
 }
 if(reference.minorityPayment){
  const payment=resolve(subsidiary,reference.minorityPayment.subsidiaryEventId,'LIABILITY','ASSET','credit');
  if(!payment||payment.dr.id!==child.cr.id||payment.journal.date<child.journal.date||
    payment.amount.gt(nci)||subsidiaryPayments.has(payment.journal.id))return null;
  minorityPaid=payment.amount;
  subsidiaryPayments.add(payment.journal.id);
 }
 function dedicated(source:Source,accountId:string,eventIds:Set<string>){
  return source.opening.every(row=>row.accountId!==accountId||new Money(row.debit).eq(row.credit))&&
   !source.journals.some(row=>!eventIds.has(row.id)&&row.lines.some(line=>line.accountId===accountId));
 }
 if(!dedicated(subsidiary,child.cr.id,subsidiaryPayments)||!dedicated(parent,owner.dr.id,parentPayments))return null;
 return {date:child.journal.date,subsidiaryEventId:child.journal.id,parentEventId:owner.journal.id,
  ordinaryDividends:child.amount.toFixed(4),parentDividend:owner.amount.toFixed(4),nciDividend:nci.toFixed(4),
  parentOutstanding:owner.amount.minus(parentPaid).toFixed(4),minorityOutstanding:nci.minus(minorityPaid).toFixed(4),
  minorityCashPaid:minorityPaid.toFixed(4),internalCash};
}

/** Reverse each internal payment leg in its original cash-flow activity. */
export function eliminateDividendCashPayments(
 rows:readonly {key:string;after:string}[],
 payments:readonly {amount:string;receiptActivity:string;paymentActivity:string}[],
){
 if(!payments.length)return [];
 const adjusted=rows.map(row=>{
  const adjustment=payments.reduce((sum,payment)=>sum
   .plus(payment.paymentActivity.toLowerCase()===row.key?payment.amount:0)
   .minus(payment.receiptActivity.toLowerCase()===row.key?payment.amount:0),new Money(0));
  return {key:row.key,before:row.after,adjustment:adjustment.toFixed(4),after:new Money(row.after).plus(adjustment).toFixed(4)};
 });
 const value=(key:string)=>new Money(adjusted.find(row=>row.key===key)!.after);
 if(!value('operating').plus(value('investing')).plus(value('financing')).eq(value('movement'))||
   !value('opening').plus(value('movement')).eq(value('closing')))
  throw Error('GROUP_ACQUISITION_CASH_UNRECONCILED');
 return adjusted;
}
