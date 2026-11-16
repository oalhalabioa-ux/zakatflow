import Decimal from 'decimal.js';
/** Read-only projection contract. This module neither persists balances nor authorizes a caller.
 * A server adapter must verify the current user, effective permissions and RLS before supplying rows.
 * Existing positive-only Financial Core event lines must NOT be guessed into this GL contract.
 */
export type AccountKind='ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'COGS'|'OPEX'|'FINANCE'|'TAX';
export type CashActivity='OPERATING'|'INVESTING'|'FINANCING';
export type LedgerAccount={id:string;organizationId:string;kind:AccountKind;currency:string;cash?:boolean};
export type LedgerLine={accountId:string;debit:string;credit:string;cashActivity?:CashActivity};
export type PostedJournal={id:string;organizationId:string;date:string;currency:string;status:'POSTED'|'DRAFT'|'VOID';reversesJournalId?:string;lines:LedgerLine[]};
export type OpeningBalance={accountId:string;debit:string;credit:string};
export type StatementSource={organizationId:string;currency:string;openingDate:string;fiscalStart:string;from:string;to:string;accounts:LedgerAccount[];opening:OpeningBalance[];journals:PostedJournal[]};
const Money=Decimal.clone({precision:50});
const D=(v:Decimal.Value)=>new Money(v),zero=()=>D(0),incomeKinds:AccountKind[]=['REVENUE','COGS','OPEX','FINANCE','TAX'];
function date(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('INVALID_REPORT_DATE');return value}
function amount(v:string){if(!/^\d{1,20}(\.\d{1,4})?$/.test(v))throw Error('INVALID_LEDGER_AMOUNT');return D(v)}
export function projectFinancialStatements(source:StatementSource){
 if(!source.organizationId||!/^[A-Z]{3}$/.test(source.currency))throw Error('REPORT_SCOPE_REQUIRED');
 [source.openingDate,source.fiscalStart,source.from,source.to].forEach(date);
 if(source.openingDate>=source.fiscalStart||source.fiscalStart>source.from||source.from>source.to||new Date(source.fiscalStart+'T00:00:00Z').valueOf()-new Date(source.openingDate+'T00:00:00Z').valueOf()!==86400000)throw Error('REPORT_PERIOD_INVALID');
 const accounts=new Map<string,LedgerAccount>(),balances=new Map<string,Decimal>(),atOpening=new Map<string,Decimal>(),periodIncome=new Map<AccountKind,Decimal>();
 for(const a of source.accounts){if(!a.id||!['ASSET','LIABILITY','EQUITY',...incomeKinds].includes(a.kind))throw Error('INVALID_ACCOUNT_MAPPING');if(a.organizationId!==source.organizationId||a.currency!==source.currency)throw Error('LEDGER_SCOPE_MISMATCH');if(accounts.has(a.id))throw Error('DUPLICATE_LEDGER_ACCOUNT');if(a.cash&&a.kind!=='ASSET')throw Error('CASH_ACCOUNT_MUST_BE_ASSET');accounts.set(a.id,a);balances.set(a.id,zero());atOpening.set(a.id,zero())}
 function lineValue(line:LedgerLine|OpeningBalance){if(!accounts.has(line.accountId))throw Error('UNMAPPED_LEDGER_ACCOUNT');const debit=amount(line.debit),credit=amount(line.credit);if(debit.gt(0)&&credit.gt(0))throw Error('MIXED_DEBIT_CREDIT_LINE');return debit.minus(credit)}
 const openingIds=new Set<string>();let openingSum=zero();
 for(const row of source.opening){if(openingIds.has(row.accountId))throw Error('DUPLICATE_OPENING_BALANCE');openingIds.add(row.accountId);const n=lineValue(row);if(incomeKinds.includes(accounts.get(row.accountId)!.kind)&&!n.isZero())throw Error('UNCLOSED_OPENING_INCOME');openingSum=openingSum.plus(n);balances.set(row.accountId,n);atOpening.set(row.accountId,n)}
 if(!openingSum.isZero())throw Error('OPENING_TRIAL_BALANCE_UNBALANCED');
 const seen=new Set<string>(),cash={OPERATING:zero(),INVESTING:zero(),FINANCING:zero()};
 const journals=[...source.journals].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),journalIndex=new Map(journals.map(j=>[j.id,j])),reversed=new Set<string>();
 for(const j of journals){if(!j.id||!['POSTED','DRAFT','VOID'].includes(j.status))throw Error('INVALID_JOURNAL_STATUS');if(j.organizationId!==source.organizationId||j.currency!==source.currency)throw Error('LEDGER_SCOPE_MISMATCH');if(seen.has(j.id))throw Error('DUPLICATE_SOURCE_JOURNAL');seen.add(j.id);date(j.date);if(j.status!=='POSTED'||j.date>source.to)continue;if(j.date<source.fiscalStart)throw Error('JOURNAL_PRECEDES_OPENING');
  if(j.lines.length<2)throw Error('INCOMPLETE_JOURNAL');const values=j.lines.map(lineValue);if(!values.reduce((n,v)=>n.plus(v),zero()).isZero())throw Error('JOURNAL_UNBALANCED');
  if(j.reversesJournalId){const original=journalIndex.get(j.reversesJournalId);if(reversed.has(j.reversesJournalId))throw Error('DUPLICATE_REVERSAL_SOURCE');reversed.add(j.reversesJournalId);if(!original||original.id===j.id||original.status!=='POSTED'||original.date>j.date)throw Error('INVALID_REVERSAL_SOURCE');const net=new Map<string,Decimal>();for(const l of [...original.lines,...j.lines])net.set(l.accountId,(net.get(l.accountId)??zero()).plus(lineValue(l)));if([...net.values()].some(v=>!v.isZero()))throw Error('REVERSAL_DOES_NOT_MATCH_SOURCE')}
  const selected=j.date>=source.from,allCash=j.lines.every(l=>accounts.get(l.accountId)!.cash);
  j.lines.forEach((l,i)=>{const a=accounts.get(l.accountId)!,v=values[i];balances.set(a.id,balances.get(a.id)!.plus(v));if(!selected)atOpening.set(a.id,atOpening.get(a.id)!.plus(v));if(selected&&incomeKinds.includes(a.kind))periodIncome.set(a.kind,(periodIncome.get(a.kind)??zero()).plus(v));if(selected&&a.cash&&!allCash&&!v.isZero()){if(!l.cashActivity)throw Error('CASH_ACTIVITY_MAPPING_REQUIRED');cash[l.cashActivity]=cash[l.cashActivity].plus(v)}});
 }
 const totals=new Map<AccountKind,Decimal>();for(const[id,v]of balances){const kind=accounts.get(id)!.kind;totals.set(kind,(totals.get(kind)??zero()).plus(v))}
 const value=(kind:AccountKind)=>totals.get(kind)??zero(),period=(kind:AccountKind)=>periodIncome.get(kind)??zero();
 const revenue=period('REVENUE').negated(),costOfSales=period('COGS'),grossProfit=revenue.minus(costOfSales),operatingProfit=grossProfit.minus(period('OPEX')),netProfit=operatingProfit.minus(period('FINANCE')).minus(period('TAX'));
 const fiscalProfit=incomeKinds.reduce((n,k)=>n.minus(value(k)),zero()),assets=value('ASSET'),liabilities=value('LIABILITY').negated(),equity=value('EQUITY').negated().plus(fiscalProfit);
 const sumCash=(m:Map<string,Decimal>)=>[...m].filter(([id])=>accounts.get(id)!.cash).reduce((n,[,v])=>n.plus(v),zero());
 const openingCash=sumCash(atOpening),closingCash=sumCash(balances),movement=Object.values(cash).reduce((a,b)=>a.plus(b),zero());
 if(!assets.minus(liabilities).minus(equity).isZero())throw Error('FINANCIAL_POSITION_UNBALANCED');if(!closingCash.minus(openingCash).minus(movement).isZero())throw Error('CASH_FLOW_UNRECONCILED');
 const s=(v:Decimal)=>v.toFixed(4);
 return{organizationId:source.organizationId,currency:source.currency,from:source.from,to:source.to,sourceJournalIds:journals.filter(j=>j.status==='POSTED'&&j.date<=source.to).map(j=>j.id),income:{revenue:s(revenue),costOfSales:s(costOfSales),grossProfit:s(grossProfit),operatingExpenses:s(period('OPEX')),operatingProfit:s(operatingProfit),finance:s(period('FINANCE')),tax:s(period('TAX')),netProfit:s(netProfit)},position:{assets:s(assets),liabilities:s(liabilities),equity:s(equity),fiscalProfit:s(fiscalProfit)},cash:{opening:s(openingCash),operating:s(cash.OPERATING),investing:s(cash.INVESTING),financing:s(cash.FINANCING),movement:s(movement),closing:s(closingCash)}};
}
