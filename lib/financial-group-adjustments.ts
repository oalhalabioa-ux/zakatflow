import Decimal from 'decimal.js';
import type {PreEliminationRollup,ReportingParent} from './financial-group-rollup';

const Money=Decimal.clone({precision:50});
const amountPattern=/^\d{1,20}(\.\d{1,4})?$/;
const signedAmountPattern=/^-?\d{1,20}(\.\d{1,4})?$/;
const chartCodePattern=/^\d{4}(?:\d{2}){0,3}$/;
type Amounts={debit:Decimal;credit:Decimal};

export type GroupEliminationKind='INTERCOMPANY_BALANCE'|'INTERCOMPANY_INCOME'|'UNREALIZED_PROFIT';
export type GroupEliminationLine={accountCode:string;reportingCode:string;debit:string;credit:string};
export type GroupElimination={
 id:string;
 kind:GroupEliminationKind;
 date:string;
 currency:string;
 organizationIds:[string,string];
 sourceReferences:readonly string[];
 reason:string;
 lines:readonly GroupEliminationLine[];
};

export type AdjustmentPreview={
 status:'GROUP_ADJUSTMENT_PREVIEW_ONLY';
 from:string;
 to:string;
 currency:string;
 memberIds:string[];
 adjustmentIds:string[];
 rows:{reportingCode:string;kind:ReportingParent['kind'];beforeNetDebit:string;adjustmentDebit:string;adjustmentCredit:string;afterNetDebit:string}[];
 beforeDebit:string;
 beforeCredit:string;
 adjustmentDebit:string;
 adjustmentCredit:string;
 afterDebit:string;
 afterCredit:string;
 closingDebit:string;
 closingCredit:string;
};

function amount(value:string){
 if(typeof value!=='string'||!amountPattern.test(value))throw Error('GROUP_ADJUSTMENT_AMOUNT_INVALID');
 return new Money(value);
}
function signedAmount(value:string){if(typeof value!=='string'||!signedAmountPattern.test(value))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');return new Money(value)}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}

/**
 * Group-only, in-memory adjustment worksheet. NEVER posts to an organization's
 * source ledger, makes an approval decision or creates a statutory statement.
 * Caller must separately verify member access, consolidation control, signed
 * source documents and approver permissions before any future persistence.
 * IAS 21 translation, acquisition accounting and NCI are NOT implemented here.
 */
export function previewGroupEliminations(rollup:PreEliminationRollup,parents:readonly ReportingParent[],entries:readonly GroupElimination[]):AdjustmentPreview{
 if(rollup.status!=='PRE_ELIMINATION_ONLY'||!rollup.memberIds.length)throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');
 const groupMembers=new Set(rollup.memberIds);
 if(groupMembers.size!==rollup.memberIds.length)throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');
 const chart=new Map<string,ReportingParent>();
 for(const parent of parents){if(!/^\d{4}$/.test(parent.code)||chart.has(parent.code))throw Error('GROUP_ADJUSTMENT_CHART_INVALID');chart.set(parent.code,parent)}
 if(!chart.size)throw Error('GROUP_ADJUSTMENT_CHART_INVALID');
 const originals=new Map<string,{kind:ReportingParent['kind'];debit:Decimal;credit:Decimal}>();
 let beforeDebit=new Money(0),beforeCredit=new Money(0);
 for(const r of rollup.byParent){
  const parent=chart.get(r.code);
  if(!parent||parent.kind!==r.kind||originals.has(r.code))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');
  const debit=amount(r.debit),credit=amount(r.credit);
  if(!debit.minus(credit).eq(signedAmount(r.netDebit)))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');
  const members=new Set<string>();let md=new Money(0),mc=new Money(0);
  for(const m of r.members){if(members.has(m.organizationId)||!groupMembers.has(m.organizationId))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');members.add(m.organizationId);const d=amount(m.debit),c=amount(m.credit);if(!d.minus(c).eq(signedAmount(m.netDebit)))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');md=md.plus(d);mc=mc.plus(c)}
  if(members.size!==groupMembers.size||!md.eq(debit)||!mc.eq(credit))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');
  originals.set(r.code,{kind:parent.kind,debit,credit});beforeDebit=beforeDebit.plus(debit);beforeCredit=beforeCredit.plus(credit);
 }
 if(!beforeDebit.eq(rollup.totalDebit)||!beforeCredit.eq(rollup.totalCredit)||!beforeDebit.eq(beforeCredit))throw Error('GROUP_ADJUSTMENT_SOURCE_INVALID');

 const adjustments=new Map<string,Amounts>(),ids=new Set<string>();
 // One documentary source cannot be independently eliminated twice for the
 // SAME accounting kind. A revenue and corresponding receivable elimination
 // may legitimately cite the same invoice, so kinds remain separate.
 const usedSourceReferences=new Set<string>();
 const consumedByMember=new Map<string,Decimal>();
 const memberKey=(organization:string,code:string)=>JSON.stringify([organization,code]);
 let adjustmentDebit=new Money(0),adjustmentCredit=new Money(0);
 for(const entry of entries){
  if(!entry.id||ids.has(entry.id))throw Error('GROUP_ADJUSTMENT_DUPLICATE');
  ids.add(entry.id);
  if(!['INTERCOMPANY_BALANCE','INTERCOMPANY_INCOME','UNREALIZED_PROFIT'].includes(entry.kind))throw Error('GROUP_ADJUSTMENT_KIND_INVALID');
  if(entry.currency!==rollup.currency||!validDate(entry.date)||entry.date<rollup.from||entry.date>rollup.to)throw Error('GROUP_ADJUSTMENT_PERIOD_CURRENCY_MISMATCH');
  if(entry.organizationIds.length!==2||entry.organizationIds[0]===entry.organizationIds[1]||entry.organizationIds.some(id=>!groupMembers.has(id)))throw Error('GROUP_ADJUSTMENT_MEMBERSHIP_INVALID');
  if(entry.sourceReferences.length<2||new Set(entry.sourceReferences).size!==entry.sourceReferences.length||entry.sourceReferences.some(ref=>!ref.trim())||entry.reason.trim().length<8)throw Error('GROUP_ADJUSTMENT_EVIDENCE_REQUIRED');
  if(entry.kind!=='UNREALIZED_PROFIT'){
   for(const ref of entry.sourceReferences){
    const key=entry.kind+'::'+ref;
    if(usedSourceReferences.has(key))throw Error('GROUP_ADJUSTMENT_DUPLICATE_EVIDENCE');
    usedSourceReferences.add(key);
   }
  }
  if(entry.lines.length<2||entry.lines.length>100)throw Error('GROUP_ADJUSTMENT_LINES_INVALID');
  let debitTotal=new Money(0),creditTotal=new Money(0);
  const affected=new Map<string,Amounts>();
  for(const l of entry.lines){
   const parent=chart.get(l.reportingCode);
   if(!parent||!chartCodePattern.test(l.accountCode)||!l.accountCode.startsWith(l.reportingCode))throw Error('GROUP_ADJUSTMENT_MAPPING_INVALID');
   const debit=amount(l.debit),credit=amount(l.credit);
   if((debit.isZero()&&credit.isZero())||(!debit.isZero()&&!credit.isZero()))throw Error('GROUP_ADJUSTMENT_AMOUNT_INVALID');
   debitTotal=debitTotal.plus(debit);creditTotal=creditTotal.plus(credit);
   const t=affected.get(l.reportingCode)??{debit:new Money(0),credit:new Money(0)};
   affected.set(l.reportingCode,{debit:t.debit.plus(debit),credit:t.credit.plus(credit)});
  }
  if(!debitTotal.eq(creditTotal))throw Error('GROUP_ADJUSTMENT_UNBALANCED');
  // Common intercompany pairs must have two opposite, same-value legs:
  // receivable Cr / payable Dr, or revenue Dr / expense Cr. They cannot
  // eliminate more than the still-outstanding member balances.
  // This is a source-account preflight, NOT proof that invoices match.
  if(entry.kind==='INTERCOMPANY_BALANCE'||entry.kind==='INTERCOMPANY_INCOME'){
   const [debitKind,creditKind]=entry.kind==='INTERCOMPANY_BALANCE'
    ? ['LIABILITY','ASSET'] as const : ['REVENUE','OPEX'] as const;
   if(entry.lines.length!==2)throw Error('GROUP_ADJUSTMENT_PAIR_INVALID');
   const debitLine=entry.lines.find(l=>!amount(l.debit).isZero());
   const creditLine=entry.lines.find(l=>!amount(l.credit).isZero());
   const debitType=debitLine&&chart.get(debitLine.reportingCode)?.kind;
   const creditType=creditLine&&chart.get(creditLine.reportingCode)?.kind;
   const creditAllowed=entry.kind==='INTERCOMPANY_INCOME'
    ? creditType==='OPEX'||creditType==='COGS'
    : creditType===creditKind;
   if(!debitLine||!creditLine||debitType!==debitKind||!creditAllowed||
     !amount(debitLine.debit).eq(amount(creditLine.credit)))
    throw Error('GROUP_ADJUSTMENT_PAIR_INVALID');
   const originalDr=originals.get(debitLine.reportingCode);
   const originalCr=originals.get(creditLine.reportingCode);
   const alreadyDr=adjustments.get(debitLine.reportingCode)??{debit:new Money(0),credit:new Money(0)};
   const alreadyCr=adjustments.get(creditLine.reportingCode)??{debit:new Money(0),credit:new Money(0)};
   const availableDr=entry.kind==='INTERCOMPANY_BALANCE'
    ? (originalDr?.credit??new Money(0)).minus(originalDr?.debit??new Money(0)).plus(alreadyDr.credit).minus(alreadyDr.debit)
    : (originalDr?.credit??new Money(0)).minus(originalDr?.debit??new Money(0)).plus(alreadyDr.credit).minus(alreadyDr.debit);
   const availableCr=entry.kind==='INTERCOMPANY_BALANCE'
    ? (originalCr?.debit??new Money(0)).minus(originalCr?.credit??new Money(0)).plus(alreadyCr.debit).minus(alreadyCr.credit)
    : (originalCr?.debit??new Money(0)).minus(originalCr?.credit??new Money(0)).plus(alreadyCr.debit).minus(alreadyCr.credit);
   const required=amount(debitLine.debit);
   if(availableDr.lt(required)||availableCr.lt(required))
    throw Error('GROUP_ADJUSTMENT_EXCEEDS_SOURCE');
   const drSource=rollup.byParent.find(r=>r.code===debitLine.reportingCode)?.members??[];
   const crSource=rollup.byParent.find(r=>r.code===creditLine.reportingCode)?.members??[];
   const availableMember=(organization:string,code:string,net:string,credit:boolean)=>{
    const balance=new Money(net).mul(credit?-1:1);
    return balance.minus(consumedByMember.get(memberKey(organization,code))??0);
   };
   const positiveDr=drSource.filter(r=>entry.organizationIds.includes(r.organizationId)&&
    availableMember(r.organizationId,debitLine.reportingCode,r.netDebit,true).gte(required));
   const positiveCr=crSource.filter(r=>entry.organizationIds.includes(r.organizationId)&&
    availableMember(r.organizationId,creditLine.reportingCode,r.netDebit,false).gte(required));
   const pairs=positiveDr.flatMap(a=>positiveCr.filter(b=>a.organizationId!==b.organizationId).map(b=>[a,b] as const));
   if(!pairs.length)throw Error('GROUP_ADJUSTMENT_RECIPROCAL_MEMBERS_MISSING');
   if(pairs.length!==1)throw Error('GROUP_ADJUSTMENT_RECIPROCAL_MEMBERS_AMBIGUOUS');
   for(const [member,code] of [[pairs[0][0],debitLine.reportingCode],[pairs[0][1],creditLine.reportingCode]] as const){
    const key=memberKey(member.organizationId,code);
    consumedByMember.set(key,(consumedByMember.get(key)??new Money(0)).plus(required));
   }
  }
  adjustmentDebit=adjustmentDebit.plus(debitTotal);adjustmentCredit=adjustmentCredit.plus(creditTotal);
  for(const[code,t]of affected){const current=adjustments.get(code)??{debit:new Money(0),credit:new Money(0)};adjustments.set(code,{debit:current.debit.plus(t.debit),credit:current.credit.plus(t.credit)})}
 }
 const codes=new Set([...originals.keys(),...adjustments.keys()]);
 const rows=[...codes].sort().map(code=>{
  const before=originals.get(code),adjustment=adjustments.get(code)??{debit:new Money(0),credit:new Money(0)};
  const net=(before?.debit??new Money(0)).minus(before?.credit??new Money(0));
  return{reportingCode:code,kind:chart.get(code)!.kind,beforeNetDebit:net.toFixed(4),adjustmentDebit:adjustment.debit.toFixed(4),adjustmentCredit:adjustment.credit.toFixed(4),afterNetDebit:net.plus(adjustment.debit).minus(adjustment.credit).toFixed(4)};
 });
 const closingDebit=rows.reduce((n,r)=>n.plus(Money.max(0,r.afterNetDebit)),new Money(0));
 const closingCredit=rows.reduce((n,r)=>n.plus(Money.max(0,new Money(r.afterNetDebit).negated())),new Money(0));
 if(!closingDebit.eq(closingCredit))throw Error('GROUP_ADJUSTMENT_UNBALANCED');
 return{closingDebit:closingDebit.toFixed(4),closingCredit:closingCredit.toFixed(4),status:'GROUP_ADJUSTMENT_PREVIEW_ONLY',from:rollup.from,to:rollup.to,currency:rollup.currency,memberIds:[...rollup.memberIds],adjustmentIds:[...ids],rows,beforeDebit:beforeDebit.toFixed(4),beforeCredit:beforeCredit.toFixed(4),adjustmentDebit:adjustmentDebit.toFixed(4),adjustmentCredit:adjustmentCredit.toFixed(4),afterDebit:beforeDebit.plus(adjustmentDebit).toFixed(4),afterCredit:beforeCredit.plus(adjustmentCredit).toFixed(4)};
}
