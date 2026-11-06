import Decimal from 'decimal.js';

const Money=Decimal.clone({precision:50});
const preciseAmount=/^-?\d{1,20}(\.\d{1,4})?$/;
const parentCode=/^\d{4}$/;
const detailCode=/^\d{4}(?:\d{2}){1,3}$/;
const currencyCode=/^[A-Z]{3}$/;

export type ReportingAccountKind='ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'COGS'|'OPEX'|'FINANCE'|'TAX';
export type ReportingParent={code:string;kind:ReportingAccountKind};
export type TrialBalanceDetail={accountId:string;code:string;reportingCode:string;kind:ReportingAccountKind;debit:string;credit:string};
export type AuthorizedTrialBalance={organizationId:string;from:string;to:string;currency:string;details:TrialBalanceDetail[]};
export type RollupInput={
 expectedOrganizationIds:readonly string[];
 from:string;
 to:string;
 currency:string;
 parents:readonly ReportingParent[];
 members:readonly AuthorizedTrialBalance[];
};

export type PreEliminationRollup={
 status:'PRE_ELIMINATION_ONLY';
 currency:string;
 from:string;
 to:string;
 memberIds:string[];
 byParent:{code:string;kind:ReportingAccountKind;debit:string;credit:string;netDebit:string;members:{organizationId:string;debit:string;credit:string;netDebit:string}[]}[];
 totalDebit:string;
 totalCredit:string;
};

function validAmount(value:string){if(typeof value!=='string'||!preciseAmount.test(value))throw Error('REPORTING_ROLLUP_AMOUNT_INVALID');return new Money(value)}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}

/**
 * Exact, read-only financial preflight. Caller MUST first authorize every member
 * through the organization-scoped server/RLS path. It cannot grant access.
 * The result is NOT an IFRS consolidated statement: no group adjustments,
 * intercompany eliminations, NCI, accounting-policy or IAS 21 translation yet.
 * Never expose it as a statutory group statement or pass it to existing exports.
 */
export function rollupAuthorizedTrialBalances(input:RollupInput):PreEliminationRollup{
 if(!validDate(input.from)||!validDate(input.to)||input.from>input.to)throw Error('REPORTING_ROLLUP_PERIOD_INVALID');
 if(!currencyCode.test(input.currency))throw Error('REPORTING_ROLLUP_CURRENCY_INVALID');
 const expected=new Set(input.expectedOrganizationIds);
 if(!expected.size||expected.size!==input.expectedOrganizationIds.length||expected.size!==input.members.length)throw Error('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
 const received=new Set<string>();
 const parents=new Map<string,ReportingParent>();
 for(const p of input.parents){if(!parentCode.test(p.code)||parents.has(p.code))throw Error('REPORTING_ROLLUP_CHART_INVALID');parents.set(p.code,p)}
 if(!parents.size)throw Error('REPORTING_ROLLUP_CHART_INVALID');
 type Totals={debit:Decimal;credit:Decimal};
 const totals=new Map<string,Totals>();
 const perMember=new Map<string,Map<string,Totals>>();
 let totalDebit=new Money(0),totalCredit=new Money(0);
 for(const member of input.members){
  if(!expected.has(member.organizationId)||received.has(member.organizationId))throw Error('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
  if(member.from!==input.from||member.to!==input.to)throw Error('REPORTING_ROLLUP_PERIOD_MISMATCH');
  if(member.currency!==input.currency)throw Error('REPORTING_ROLLUP_CURRENCY_MISMATCH');
  received.add(member.organizationId);
  const memberTotals=new Map<string,Totals>(),accounts=new Set<string>();
  let debitSum=new Money(0),creditSum=new Money(0);
  for(const a of member.details){
   if(!a.accountId||accounts.has(a.accountId)||accounts.has('code:'+a.code))throw Error('REPORTING_ROLLUP_ACCOUNT_DUPLICATE');
   accounts.add(a.accountId);accounts.add('code:'+a.code);
   if(!parentCode.test(a.code)&&!detailCode.test(a.code))throw Error('REPORTING_ROLLUP_ACCOUNT_INVALID');
   const parent=parents.get(a.reportingCode);
   if(!parent||!a.code.startsWith(parent.code)||a.kind!==parent.kind)throw Error('REPORTING_ROLLUP_MAPPING_INVALID');
   const debit=validAmount(a.debit),credit=validAmount(a.credit);
   if(debit.isNegative()||credit.isNegative()||(!debit.isZero()&&!credit.isZero()))throw Error('REPORTING_ROLLUP_AMOUNT_INVALID');
   debitSum=debitSum.plus(debit);creditSum=creditSum.plus(credit);
   const local=memberTotals.get(a.reportingCode)??{debit:new Money(0),credit:new Money(0)};
   memberTotals.set(a.reportingCode,{debit:local.debit.plus(debit),credit:local.credit.plus(credit)});
  }
  // A truncated or incompletely allocated trial balance is never safe to combine.
  if(!debitSum.eq(creditSum))throw Error('REPORTING_ROLLUP_UNBALANCED_MEMBER');
  totalDebit=totalDebit.plus(debitSum);totalCredit=totalCredit.plus(creditSum);
  perMember.set(member.organizationId,memberTotals);
  for(const[code,t]of memberTotals){const current=totals.get(code)??{debit:new Money(0),credit:new Money(0)};totals.set(code,{debit:current.debit.plus(t.debit),credit:current.credit.plus(t.credit)})}
 }
 if(received.size!==expected.size)throw Error('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
 const memberIds=[...expected].sort();
 const byParent=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([code,t])=>({
  code,kind:parents.get(code)!.kind,debit:t.debit.toFixed(4),credit:t.credit.toFixed(4),netDebit:t.debit.minus(t.credit).toFixed(4),
  members:memberIds.map(organizationId=>{const row=perMember.get(organizationId)!.get(code)??{debit:new Money(0),credit:new Money(0)};return{organizationId,debit:row.debit.toFixed(4),credit:row.credit.toFixed(4),netDebit:row.debit.minus(row.credit).toFixed(4)}}),
 }));
 return{status:'PRE_ELIMINATION_ONLY',currency:input.currency,from:input.from,to:input.to,memberIds,byParent,totalDebit:totalDebit.toFixed(4),totalCredit:totalCredit.toFixed(4)};
}
