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
 let adjustmentDebit=new Money(0),adjustmentCredit=new Money(0);
 for(const entry of entries){
  if(!entry.id||ids.has(entry.id))throw Error('GROUP_ADJUSTMENT_DUPLICATE');
  ids.add(entry.id);
  if(!['INTERCOMPANY_BALANCE','INTERCOMPANY_INCOME','UNREALIZED_PROFIT'].includes(entry.kind))throw Error('GROUP_ADJUSTMENT_KIND_INVALID');
  if(entry.currency!==rollup.currency||!validDate(entry.date)||entry.date<rollup.from||entry.date>rollup.to)throw Error('GROUP_ADJUSTMENT_PERIOD_CURRENCY_MISMATCH');
  if(entry.organizationIds.length!==2||entry.organizationIds[0]===entry.organizationIds[1]||entry.organizationIds.some(id=>!groupMembers.has(id)))throw Error('GROUP_ADJUSTMENT_MEMBERSHIP_INVALID');
  if(entry.sourceReferences.length<2||new Set(entry.sourceReferences).size!==entry.sourceReferences.length||entry.sourceReferences.some(ref=>!ref.trim())||entry.reason.trim().length<8)throw Error('GROUP_ADJUSTMENT_EVIDENCE_REQUIRED');
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
  adjustmentDebit=adjustmentDebit.plus(debitTotal);adjustmentCredit=adjustmentCredit.plus(creditTotal);
  for(const[code,t]of affected){const current=adjustments.get(code)??{debit:new Money(0),credit:new Money(0)};adjustments.set(code,{debit:current.debit.plus(t.debit),credit:current.credit.plus(t.credit)})}
 }
 const codes=new Set([...originals.keys(),...adjustments.keys()]);
 const rows=[...codes].sort().map(code=>{
  const before=originals.get(code),adjustment=adjustments.get(code)??{debit:new Money(0),credit:new Money(0)};
  const net=(before?.debit??new Money(0)).minus(before?.credit??new Money(0));
  return{reportingCode:code,kind:chart.get(code)!.kind,beforeNetDebit:net.toFixed(4),adjustmentDebit:adjustment.debit.toFixed(4),adjustmentCredit:adjustment.credit.toFixed(4),afterNetDebit:net.plus(adjustment.debit).minus(adjustment.credit).toFixed(4)};
 });
 return{status:'GROUP_ADJUSTMENT_PREVIEW_ONLY',from:rollup.from,to:rollup.to,currency:rollup.currency,memberIds:[...rollup.memberIds],adjustmentIds:[...ids],rows,beforeDebit:beforeDebit.toFixed(4),beforeCredit:beforeCredit.toFixed(4),adjustmentDebit:adjustmentDebit.toFixed(4),adjustmentCredit:adjustmentCredit.toFixed(4),afterDebit:beforeDebit.plus(adjustmentDebit).toFixed(4),afterCredit:beforeCredit.plus(adjustmentCredit).toFixed(4)};
}
