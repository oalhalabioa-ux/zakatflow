import Decimal from 'decimal.js';
import type {PostedJournal} from './financial-statement-engine';

const Money=Decimal.clone({precision:50});
type AccountBalance={id:string;ar:string;en:string;balance:string;periodMovement:string};
type LedgerEntry={
 journalId:string;date:string;reference:string;reversesJournalId?:string;
 debit:string;credit:string;balance:string;
};
type BalanceColumns={
 openingDebit:string;openingCredit:string;periodDebit:string;periodCredit:string;
 closingDebit:string;closingCredit:string;
};
export type LedgerAccount=BalanceColumns&{
 id:string;ar:string;en:string;opening:string;closing:string;entries:LedgerEntry[];
};
export type PeriodLedger={accounts:LedgerAccount[];totals:BalanceColumns};
export type LedgerReportView='trial-balance'|'general-ledger';

function sides(value:Decimal){
 return [Money.max(value,0).toFixed(4),Money.max(value.negated(),0).toFixed(4)] as const;
}

/** Read-only presentation of the journals already validated by the statement engine. */
export function projectPeriodLedger(
 accounts:AccountBalance[],journals:PostedJournal[],from:string,to:string,
 references:ReadonlyMap<string,{reference:string}>,
):PeriodLedger{
 const entries=new Map(accounts.map(account=>[account.id,[] as Omit<LedgerEntry,'balance'>[]]));
 const ordered=journals.filter(journal=>journal.status==='POSTED'&&journal.date>=from&&journal.date<=to)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 for(const journal of ordered){
  for(const line of journal.lines){
   entries.get(line.accountId)!.push({
    journalId:journal.id,date:journal.date,reference:references.get(journal.id)!.reference,
    reversesJournalId:journal.reversesJournalId,debit:line.debit,credit:line.credit,
   });
  }
 }

 const rows=accounts.map(account=>{
  const lines=entries.get(account.id)!;
  const debit=lines.reduce((sum,line)=>sum.plus(line.debit),new Money(0));
  const credit=lines.reduce((sum,line)=>sum.plus(line.credit),new Money(0));
  const movement=debit.minus(credit), closing=new Money(account.balance);
  if(!movement.eq(account.periodMovement))throw Error('REPORTING_LEDGER_UNRECONCILED');
  const opening=closing.minus(movement);
  const [openingDebit,openingCredit]=sides(opening), [closingDebit,closingCredit]=sides(closing);
  let balance=opening;
  return {id:account.id,ar:account.ar,en:account.en,opening:opening.toFixed(4),closing:closing.toFixed(4),
   openingDebit,openingCredit,periodDebit:debit.toFixed(4),periodCredit:credit.toFixed(4),closingDebit,closingCredit,
   entries:lines.map(line=>{
    balance=balance.plus(line.debit).minus(line.credit);
    return {...line,balance:balance.toFixed(4)};
   }),
  };
 });
 const sum=(key:keyof BalanceColumns)=>rows.reduce((total,row)=>total.plus(row[key]),new Money(0)).toFixed(4);
 const totals={
  openingDebit:sum('openingDebit'),openingCredit:sum('openingCredit'),
  periodDebit:sum('periodDebit'),periodCredit:sum('periodCredit'),
  closingDebit:sum('closingDebit'),closingCredit:sum('closingCredit'),
 };
 if(totals.openingDebit!==totals.openingCredit||totals.periodDebit!==totals.periodCredit||totals.closingDebit!==totals.closingCredit)
  throw Error('REPORTING_LEDGER_UNRECONCILED');
 return {accounts:rows.filter(row=>row.entries.length||row.opening!=='0.0000'||row.closing!=='0.0000'),totals};
}

export const trialBalanceColumns=[
 ['openingDebit','أول الفترة مدين','Opening debit'],['openingCredit','أول الفترة دائن','Opening credit'],
 ['periodDebit','حركة الفترة مدين','Period debit'],['periodCredit','حركة الفترة دائن','Period credit'],
 ['closingDebit','آخر الفترة مدين','Closing debit'],['closingCredit','آخر الفترة دائن','Closing credit'],
] as const;

export function ledgerAccount(ledger:PeriodLedger,accountId:string){
 return ledger.accounts.find(account=>account.id===accountId)??ledger.accounts[0];
}

export const ledgerEntryColumns=[
 ['date','التاريخ','Date'],['reference','مرجع العملية','Source reference'],
 ['debit','مدين','Debit'],['credit','دائن','Credit'],['balance','الرصيد','Balance'],
 ['journalId','معرّف القيد','Journal ID'],['reversesJournalId','معرّف القيد المعكوس','Reversed journal ID'],
] as const;
