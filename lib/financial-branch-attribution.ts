import Decimal from 'decimal.js';
import type {StatementSource} from './financial-statement-engine';
import type {BranchAllocationInput,BranchSourceLine} from './financial-branch-allocation';
import {branchStatementSourceLines,compileBranchStatementPreview,type BranchStatementPreview} from './financial-branch-statements';
import type {JournalBranchObservation} from '../services/financial-branch-journal-source';

const Money=Decimal.clone({precision:50});
const nonNegative=/^\d{1,20}(\.\d{1,4})?$/;
type Split={branchId:string|null;debit:string;credit:string};

/**
 * A separate, approved and versioned OPENING allocation manifest is necessary
 * even when the legal-company opening trial balance is approved: one general
 * ledger account may contain opening balances belonging to multiple branches.
 * These are NOT proofs of database approval until checked by a server adapter.
 */
export type BranchOpeningEvidence={
 status:'APPROVED';organizationId:string;currency:string;fiscalStart:string;
 approvedVersion:number;approvedBy:string;ledgerRevision:string;
 rows:readonly {sourceId:string;accountCode:string;debit:string;credit:string;allocations:readonly Split[]}[];
};
export type BranchAttributionAssembly={
 source:StatementSource;
 branchIds:readonly string[];
 coverage:BranchAllocationInput['coverage'];
 journalEvidence:JournalBranchObservation;
 openingEvidence:BranchOpeningEvidence|null;
};
export type BranchAttributionDiagnostic=
 'BRANCH_JOURNAL_EVIDENCE_MISSING'|'BRANCH_JOURNAL_EVIDENCE_INVALID'|
 'BRANCH_OPENING_EVIDENCE_REQUIRED'|'BRANCH_OPENING_EVIDENCE_INVALID'|
 'BRANCH_SOURCE_REVISION_UNVERIFIED';
export type BranchAttributionPreview=
 |{status:'BLOCKED';issues:BranchAttributionDiagnostic[];company:null;segments:[]}
 |BranchStatementPreview;

/**
 * QA-only construction of EXACT opening and posted journal line allocations.
 * Posted journal lines inherit the event's authenticated operational dimension;
 * openings NEVER inherit branch ownership from a bank/account or event guess.
 * An approved, version-bound opening distribution is required instead.
 *
 * This pure function does not authorize an actor, approve openings, attest a
 * canonical source revision or publish figures. The future server adapter must
 * independently verify all claims, membership and permissions in one
 * consistent source snapshot before even calling this function.
 */
export function previewVerifiedBranchAttribution(input:BranchAttributionAssembly):BranchAttributionPreview{
 const {source,branchIds,coverage,journalEvidence,openingEvidence}=input;
 const expected=branchStatementSourceLines(source);
 const block=(issue:BranchAttributionDiagnostic):BranchAttributionPreview=>
  ({status:'BLOCKED',issues:[issue],company:null,segments:[]});
 if(coverage?.complete!==true||coverage.scope!=='ORGANIZATION_ALL_ENTITIES'||
  !coverage.revision?.trim()||coverage.sourceCount!==expected.length)
  return block('BRANCH_SOURCE_REVISION_UNVERIFIED');
 const allowed=new Set(branchIds);
 if(allowed.size!==branchIds.length||branchIds.some(b=>!b))return block('BRANCH_JOURNAL_EVIDENCE_INVALID');
 const posted=source.journals.filter(j=>j.status==='POSTED'&&j.date<=source.to);
 if(journalEvidence?.status!=='RLS_MATCHED_JOURNAL_REFERENCES_ONLY'||journalEvidence.organizationId!==source.organizationId)
  return block('BRANCH_JOURNAL_EVIDENCE_MISSING');
 const links=new Map<string,string|null>();
 for(const link of journalEvidence.links){
  if(links.has(link.journalId)||
   (link.branchId!==null&&!allowed.has(link.branchId))||
   (link.branchId===null&&link.scope!=='ORGANIZATION_DIRECT')||
   (link.branchId!==null&&link.scope!=='BRANCH'))
   return block('BRANCH_JOURNAL_EVIDENCE_INVALID');
  links.set(link.journalId,link.branchId);
 }
 if(links.size!==posted.length||posted.some(j=>!links.has(j.id))||[...links.keys()].some(id=>!posted.some(j=>j.id===id)))
  return block('BRANCH_JOURNAL_EVIDENCE_MISSING');
 const openings=expected.filter(r=>r.sourceKind==='OPENING');
 if(openings.length&&!openingEvidence)return block('BRANCH_OPENING_EVIDENCE_REQUIRED');
 const openingMap=new Map<string,BranchOpeningEvidence['rows'][number]>();
 if(openingEvidence){
  if(openingEvidence.status!=='APPROVED'||openingEvidence.organizationId!==source.organizationId||
   openingEvidence.currency!==source.currency||openingEvidence.fiscalStart!==source.fiscalStart||
   openingEvidence.ledgerRevision!==coverage.revision||
   !Number.isSafeInteger(openingEvidence.approvedVersion)||openingEvidence.approvedVersion<1||
   !openingEvidence.approvedBy.trim())
   return block('BRANCH_OPENING_EVIDENCE_INVALID');
  for(const row of openingEvidence.rows){
   if(openingMap.has(row.sourceId))return block('BRANCH_OPENING_EVIDENCE_INVALID');
   openingMap.set(row.sourceId,row);
  }
  if(openingMap.size!==openings.length)return block('BRANCH_OPENING_EVIDENCE_INVALID');
 }
 const exact=(a:string,b:string)=>nonNegative.test(a)&&nonNegative.test(b)&&new Money(a).eq(b);
 const allocations:BranchSourceLine[]=[];
 for(const row of expected){
  if(row.sourceKind==='JOURNAL'){
   const journalId=row.sourceId.slice(2,row.sourceId.lastIndexOf(':'));
   if(!links.has(journalId))return block('BRANCH_JOURNAL_EVIDENCE_MISSING');
   allocations.push({...row,allocations:[{branchId:links.get(journalId)!,debit:row.debit,credit:row.credit}]});
  }else{
   const found=openingMap.get(row.sourceId);
   if(!found||found.accountCode!==row.accountCode||!exact(found.debit,row.debit)||!exact(found.credit,row.credit))
    return block('BRANCH_OPENING_EVIDENCE_INVALID');
   // The compiler validates each split, each separate opening TB and all
   // consolidated controls. Never infer or silently fill a missing split.
   allocations.push({...row,allocations:found.allocations});
  }
 }
 return compileBranchStatementPreview({source,branchIds,coverage,allocations});
}
