import Decimal from 'decimal.js';
import type {StatementSource} from './financial-statement-engine';
import type {BranchOpeningEvidence} from './financial-branch-attribution';
import {branchStatementSourceLines} from './financial-branch-statements';

const Money=Decimal.clone({precision:50});
const number=/^\d{1,20}(\.\d{1,4})?$/;
type Split={branchId:string|null;debit:string;credit:string};
type ApprovedOpeningRow={itemId:string;accountCode:string;debit:string;credit:string};
type ApprovedWorkspace={
 id:string;organizationId:string;fiscalStart:string;currency:string;version:number;
 status:'APPROVED'|'DRAFT'|'SUPERSEDED';approvedOpening:readonly ApprovedOpeningRow[];
};
type StoredDistribution={
 status:'APPROVED'|'DRAFT'|'STALE'|'MISSING';kind:'OPENING_DISTRIBUTION_EVIDENCE_ONLY';
 organizationId:string;openingWorkspaceId:string;openingVersion:number;
 openingDigest:string;approvedBy:string|null;entries:Record<string,readonly Split[]>;
 journalCoverageComplete:false;
};
export type OpeningAttributionInput={
 source:StatementSource;branchIds:readonly string[];sourceRevision:string;
 workspace:ApprovedWorkspace|null;distribution:StoredDistribution|null;
};
export type OpeningAttributionResult=
 |{status:'OPENING_ATTRIBUTION_BLOCKED';code:string;openingEvidence:null}
 |{status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY';itemCount:number;openingEvidence:BranchOpeningEvidence|null};

/**
 * Convert an approved, immutable item-level opening distribution into the
 * account-level exact source lines consumed by the branch statement compiler.
 * Multiple source vouchers may share a GL account, but no voucher may be
 * reallocated, duplicated, netted or silently assigned to headquarters.
 *
 * Required upstream security: trusted server must verify RLS, current approved
 * opening workspace, opening MD5, journal/ledger revision, and member rights
 * together. This pure function is a QA preview, never an authorization source.
 */
export function aggregateApprovedBranchOpenings(input:OpeningAttributionInput):OpeningAttributionResult{
 const stop=(code:string):OpeningAttributionResult=>({status:'OPENING_ATTRIBUTION_BLOCKED',code,openingEvidence:null});
 const sourceRows=branchStatementSourceLines(input.source).filter(r=>r.sourceKind==='OPENING');
 if(!sourceRows.length&&!input.distribution){
  // Zero source rows need no per-branch distribution. This also covers an
  // explicitly approved EMPTY corporate workspace, without inventing entries.
  // Never treat a nonempty, draft, stale or foreign workspace as zero opening.
  const w=input.workspace;
  if(!w||(w.status==='APPROVED'&&w.approvedOpening.length===0&&
   w.organizationId===input.source.organizationId&&
   w.fiscalStart===input.source.fiscalStart&&w.currency===input.source.currency))
   return{status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY',itemCount:0,openingEvidence:null};
  return stop('OPENING_SOURCE_STALE');
 }
 const {workspace:w,distribution:d}=input;
 if(!w||!d||w.status!=='APPROVED'||d.status!=='APPROVED'||!d.approvedBy||
  d.kind!=='OPENING_DISTRIBUTION_EVIDENCE_ONLY'||d.journalCoverageComplete!==false)
  return stop('OPENING_APPROVAL_MISSING');
 if(w.organizationId!==input.source.organizationId||d.organizationId!==w.organizationId||
  w.fiscalStart!==input.source.fiscalStart||w.currency!==input.source.currency||
  d.openingWorkspaceId!==w.id||d.openingVersion!==w.version||!d.openingDigest||
  !input.sourceRevision.trim())return stop('OPENING_SOURCE_STALE');
 const allowed=new Set(input.branchIds);
 if(allowed.size!==input.branchIds.length||input.branchIds.some(b=>!b))
  return stop('OPENING_BRANCH_REGISTRY_INVALID');
 const ids=new Set<string>();
 const totals=new Map<string,{debit:Decimal;credit:Decimal;parts:Map<string|null,{debit:Decimal;credit:Decimal}>}>();
 let itemCount=0;
 for(const row of w.approvedOpening){
  if(!row.itemId||!row.accountCode||ids.has(row.itemId)||!number.test(row.debit)||!number.test(row.credit))
   return stop('OPENING_SOURCE_ITEM_INVALID');
  ids.add(row.itemId);itemCount++;
  const parts=d.entries[row.itemId];
  if(!Array.isArray(parts)||!parts.length)return stop('OPENING_LINE_UNATTRIBUTED');
  const seen=new Set<string|null>();
  const rowDebit=new Money(row.debit),rowCredit=new Money(row.credit);
  if(rowDebit.gt(0)&&rowCredit.gt(0))return stop('OPENING_SOURCE_ITEM_INVALID');
  let debit=new Money(0),credit=new Money(0);
  const group=totals.get(row.accountCode)??{debit:new Money(0),credit:new Money(0),parts:new Map()};
  for(const part of parts){
   if(!part||!number.test(part.debit)||!number.test(part.credit)||seen.has(part.branchId)||
    (part.branchId!==null&&!allowed.has(part.branchId)))return stop('OPENING_BRANCH_ALLOCATION_INVALID');
   seen.add(part.branchId);
   const dr=new Money(part.debit),cr=new Money(part.credit);
   if((dr.gt(0)&&cr.gt(0))||(rowDebit.isZero()&&!dr.isZero())||(rowCredit.isZero()&&!cr.isZero()))
    return stop('OPENING_BRANCH_ALLOCATION_INVALID');
   debit=debit.plus(dr);credit=credit.plus(cr);
   const prior=group.parts.get(part.branchId)??{debit:new Money(0),credit:new Money(0)};
   group.parts.set(part.branchId,{debit:prior.debit.plus(dr),credit:prior.credit.plus(cr)});
  }
  if(!debit.eq(rowDebit)||!credit.eq(rowCredit))return stop('OPENING_LINE_MISMATCH');
  group.debit=group.debit.plus(rowDebit);group.credit=group.credit.plus(rowCredit);
  totals.set(row.accountCode,group);
 }
 if(Object.keys(d.entries).length!==ids.size||Object.keys(d.entries).some(key=>!ids.has(key)))
  return stop('OPENING_DISTRIBUTION_UNRECOGNIZED_ITEM');
 if(totals.size!==sourceRows.length)return stop('OPENING_ACCOUNT_COVERAGE_MISMATCH');
 const rows:BranchOpeningEvidence['rows'][number][]=[];
 for(const sourceRow of sourceRows){
  const group=totals.get(sourceRow.accountCode);
  if(!group||!group.debit.eq(sourceRow.debit)||!group.credit.eq(sourceRow.credit))
   return stop('OPENING_ACCOUNT_AMOUNT_MISMATCH');
  rows.push({sourceId:sourceRow.sourceId,accountCode:sourceRow.accountCode,
   debit:sourceRow.debit,credit:sourceRow.credit,
   allocations:[...group.parts].map(([branchId,v])=>({
    branchId,debit:v.debit.toFixed(4),credit:v.credit.toFixed(4),
   }))});
 }
 return{status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY',itemCount,
  openingEvidence:{status:'APPROVED',organizationId:w.organizationId,currency:w.currency,
   fiscalStart:w.fiscalStart,approvedVersion:w.version,approvedBy:d.approvedBy,
   ledgerRevision:input.sourceRevision,rows}};
}
