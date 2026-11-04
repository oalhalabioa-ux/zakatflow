import Decimal from 'decimal.js';
import type {StatementSourceSnapshot} from './financial-statement-source';
export type FiscalCalendar={startMonth:number;startDay:number;retainedEarningsAccount:string};
function anchor(year:number,calendar:FiscalCalendar){
 const lastDay=new Date(Date.UTC(year,calendar.startMonth,0)).getUTCDate();
 return new Date(Date.UTC(year,calendar.startMonth-1,Math.min(calendar.startDay,lastDay)));
}
export function fiscalPeriod(calendar:FiscalCalendar,asOf:string){
 if(!Number.isInteger(calendar.startMonth)||calendar.startMonth<1||calendar.startMonth>12||!Number.isInteger(calendar.startDay)||calendar.startDay<1||calendar.startDay>31)throw Error('FISCAL_CALENDAR_INVALID');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('FISCAL_DATE_INVALID');
 const date=new Date(asOf+'T00:00:00Z');
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==asOf)throw Error('FISCAL_DATE_INVALID');
 let start=anchor(date.getUTCFullYear(),calendar);
 if(start>date)start=anchor(date.getUTCFullYear()-1,calendar);
 const next=anchor(start.getUTCFullYear()+1,calendar);
 const end=new Date(next.valueOf()-86400000);
 return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),nextStart:next.toISOString().slice(0,10)};
}
// This projection is independently compared with the transactional SQL close.
// Only the database close function authorizes and persists a year-end result.
export function annualOpening(snapshot:StatementSourceSnapshot,calendar:FiscalCalendar){
 const period=fiscalPeriod(calendar,snapshot.statements.from);
 if(snapshot.statements.from!==period.start||snapshot.statements.to!==period.end)throw Error('FISCAL_FULL_YEAR_REQUIRED');
 if(!snapshot.accounts.some(a=>a.id===calendar.retainedEarningsAccount&&a.kind==='EQUITY'))throw Error('FISCAL_RETAINED_ACCOUNT_REQUIRED');
 const rows=snapshot.accounts.filter(a=>['ASSET','LIABILITY','EQUITY'].includes(a.kind)).map(account=>{
  let closing=new Decimal(account.balance);
  if(account.id===calendar.retainedEarningsAccount)closing=closing.minus(snapshot.statements.position.fiscalProfit);
  return{accountId:account.id,debit:Decimal.max(closing,0).toFixed(4),credit:Decimal.max(closing.negated(),0).toFixed(4)};
 });
 if(!rows.reduce((sum,row)=>sum.plus(row.debit).minus(row.credit),new Decimal(0)).isZero())throw Error('FISCAL_ROLLOVER_UNBALANCED');
 return{period,nextOpening:rows};
}
