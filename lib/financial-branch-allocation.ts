import Decimal from 'decimal.js';

const Money=Decimal.clone({precision:50});
const nonNegativeMoney=/^\d{1,20}(\.\d{1,4})?$/;
const validAccount=/^\d{4}(?:\d{2}){0,3}$/;

export type BranchSourceLine={
 sourceId:string;
 sourceKind:'OPENING'|'JOURNAL';
 accountCode:string;
 debit:string;
 credit:string;
 /** null is the legal entity's direct/headquarters dimension, not an orphan branch. */
 allocations:readonly {branchId:string|null;debit:string;credit:string}[];
};
export type BranchAllocationInput={
 organizationId:string;
 currency:string;
 branchIds:readonly string[];
 coverage:{complete:true;scope:'ORGANIZATION_ALL_ENTITIES';sourceCount:number;revision:string};
 sourceLines:readonly BranchSourceLine[];
};
export type BranchAllocationDiagnostic={code:'MISSING_ALLOCATION'|'ALLOCATION_MISMATCH'|'BRANCH_NOT_BALANCED'|'BRANCH_OPENING_NOT_BALANCED'|'BRANCH_MOVEMENT_NOT_BALANCED';sourceId?:string;branchId?:string|null};
export type BranchAllocationResult={
 status:'READY_FOR_BRANCH_REPORTS'|'BLOCKED';
 sourceCount:number;
 issues:BranchAllocationDiagnostic[];
 /** Exact whole-company control total. Null if ANY segment or source line fails. */
 companyReconciliation:{totalDebit:string;totalCredit:string;accounts:{accountCode:string;debit:string;credit:string;netDebit:string}[]}|null;
 branchTrialBalances:{branchId:string|null;scope:'ORGANIZATION_DIRECT'|'BRANCH';totalDebit:string;totalCredit:string;accounts:{accountCode:string;debit:string;credit:string;netDebit:string}[]}[];
};

function amount(value:string){if(typeof value!=='string'||!nonNegativeMoney.test(value))throw Error('BRANCH_ALLOCATION_AMOUNT_INVALID');return new Money(value)}

/**
 * Read-only completeness check against an already authorized FULL canonical
 * ledger/opening source. An empty or filtered source cannot prove completeness.
 * No branch data may be published if ANY opening or journal line is incomplete.
 * Source must be obtained by trusted server code with full-ledger permissions.
 */
export function validateBranchAllocations(input:BranchAllocationInput):BranchAllocationResult{
 if(!input.organizationId||!/^[A-Z]{3}$/.test(input.currency)||new Set(input.branchIds).size!==input.branchIds.length||input.branchIds.some(id=>!id))throw Error('BRANCH_ALLOCATION_SCOPE_INVALID');
 if(input.coverage?.complete!==true||input.coverage.scope!=='ORGANIZATION_ALL_ENTITIES'||input.coverage.sourceCount!==input.sourceLines.length||!input.coverage.revision?.trim())throw Error('BRANCH_ALLOCATION_SOURCE_INCOMPLETE');
 const allowed=new Set(input.branchIds),seen=new Set<string>(),issues:BranchAllocationDiagnostic[]=[];
 type MoneyPair={debit:Decimal;credit:Decimal};
 const totals=new Map<string|null,Map<string,MoneyPair>>(input.branchIds.map(id=>[id,new Map<string,MoneyPair>()]));
 const sourceAccounts=new Map<string,MoneyPair>();
 // Opening balances and subsequent journals must each balance independently.
 // A journal must never mask an unbalanced opening (or vice versa).
 type PhaseTotals={openingDebit:Decimal;openingCredit:Decimal;journalDebit:Decimal;journalCredit:Decimal};
 const emptyPhase=():PhaseTotals=>({openingDebit:new Money(0),openingCredit:new Money(0),
  journalDebit:new Money(0),journalCredit:new Money(0)});
 const companyPhase=emptyPhase();
 const segmentPhase=new Map<string|null,PhaseTotals>(input.branchIds.map(id=>[id,emptyPhase()]));
 let sourceDebit=new Money(0),sourceCredit=new Money(0);
 for(const row of input.sourceLines){
  const key=row.sourceKind+':'+row.sourceId;
  if(!row.sourceId||seen.has(key)||!['OPENING','JOURNAL'].includes(row.sourceKind)||!validAccount.test(row.accountCode))throw Error('BRANCH_ALLOCATION_SOURCE_INVALID');
  seen.add(key);
  const debit=amount(row.debit),credit=amount(row.credit);
  if((!debit.isZero()&&!credit.isZero()))throw Error('BRANCH_ALLOCATION_SOURCE_INVALID');
  sourceDebit=sourceDebit.plus(debit);sourceCredit=sourceCredit.plus(credit);
  if(row.sourceKind==='OPENING'){
   companyPhase.openingDebit=companyPhase.openingDebit.plus(debit);
   companyPhase.openingCredit=companyPhase.openingCredit.plus(credit);
  }else{
   companyPhase.journalDebit=companyPhase.journalDebit.plus(debit);
   companyPhase.journalCredit=companyPhase.journalCredit.plus(credit);
  }
  const existing=sourceAccounts.get(row.accountCode)??{debit:new Money(0),credit:new Money(0)};
  sourceAccounts.set(row.accountCode,{debit:existing.debit.plus(debit),credit:existing.credit.plus(credit)});
  if(!row.allocations.length){
   if(!debit.isZero()||!credit.isZero())issues.push({code:'MISSING_ALLOCATION',sourceId:row.sourceId});
   continue;
  }
  let allocatedDebit=new Money(0),allocatedCredit=new Money(0);
  const assigned=new Set<string|null>();
  for(const a of row.allocations){
   if((a.branchId!==null&&!allowed.has(a.branchId))||assigned.has(a.branchId))throw Error('BRANCH_ALLOCATION_BRANCH_INVALID');
   assigned.add(a.branchId);
   const d=amount(a.debit),c=amount(a.credit);
   if((!d.isZero()&&!c.isZero())||(row.sourceKind==='JOURNAL'&&((debit.isZero()&&!d.isZero())||(credit.isZero()&&!c.isZero()))))throw Error('BRANCH_ALLOCATION_AMOUNT_INVALID');
   allocatedDebit=allocatedDebit.plus(d);allocatedCredit=allocatedCredit.plus(c);
   // Direct legal-company entries are their own reporting segment. They must
   // be explicitly allocated, never inferred from a missing allocation.
   if(a.branchId===null&&!totals.has(null))totals.set(null,new Map<string,MoneyPair>());
   const branch=totals.get(a.branchId)!,current=branch.get(row.accountCode)??{debit:new Money(0),credit:new Money(0)};
   branch.set(row.accountCode,{debit:current.debit.plus(d),credit:current.credit.plus(c)});
   const phase=segmentPhase.get(a.branchId)??emptyPhase();
   if(row.sourceKind==='OPENING'){
    phase.openingDebit=phase.openingDebit.plus(d);phase.openingCredit=phase.openingCredit.plus(c);
   }else{
    phase.journalDebit=phase.journalDebit.plus(d);phase.journalCredit=phase.journalCredit.plus(c);
   }
   segmentPhase.set(a.branchId,phase);
  }
  // Company openings are NETTED by account. Opposite branch balances may
  // cancel at company level; the approved item-level bridge certifies each
  // original amount before this net reconciliation. Journals remain gross.
  if(row.sourceKind==='OPENING'
   ?!allocatedDebit.minus(allocatedCredit).eq(debit.minus(credit))
   :!allocatedDebit.eq(debit)||!allocatedCredit.eq(credit))issues.push({code:'ALLOCATION_MISMATCH',sourceId:row.sourceId});
 }
 // A complete ledger is balanced. Otherwise a filtered or truncated source
 // can misleadingly yield branch balances that do not reconcile globally.
 if(!sourceDebit.eq(sourceCredit)||!companyPhase.openingDebit.eq(companyPhase.openingCredit)
  ||!companyPhase.journalDebit.eq(companyPhase.journalCredit))
  throw Error('BRANCH_ALLOCATION_SOURCE_UNBALANCED');
 const result=[...totals].map(([branchId,accounts])=>{
  let totalDebit=new Money(0),totalCredit=new Money(0);
  const lines=[...accounts].sort(([a],[b])=>a.localeCompare(b)).map(([accountCode,a])=>{totalDebit=totalDebit.plus(a.debit);totalCredit=totalCredit.plus(a.credit);return{accountCode,debit:a.debit.toFixed(4),credit:a.credit.toFixed(4),netDebit:a.debit.minus(a.credit).toFixed(4)}});
  const phase=segmentPhase.get(branchId)??emptyPhase();
  if(!phase.openingDebit.eq(phase.openingCredit))issues.push({code:'BRANCH_OPENING_NOT_BALANCED',branchId});
  if(!phase.journalDebit.eq(phase.journalCredit))issues.push({code:'BRANCH_MOVEMENT_NOT_BALANCED',branchId});
  if(!totalDebit.eq(totalCredit))issues.push({code:'BRANCH_NOT_BALANCED',branchId});
  return{branchId,scope:branchId===null?'ORGANIZATION_DIRECT' as const:'BRANCH' as const,totalDebit:totalDebit.toFixed(4),totalCredit:totalCredit.toFixed(4),accounts:lines};
 });
 const companyReconciliation=issues.length?null:{
  totalDebit:sourceDebit.toFixed(4),totalCredit:sourceCredit.toFixed(4),
  accounts:[...sourceAccounts].sort(([a],[b])=>a.localeCompare(b)).map(([accountCode,a])=>({
   accountCode,debit:a.debit.toFixed(4),credit:a.credit.toFixed(4),netDebit:a.debit.minus(a.credit).toFixed(4),
  })),
 };
 return{status:issues.length?'BLOCKED':'READY_FOR_BRANCH_REPORTS',sourceCount:input.sourceLines.length,issues,
  companyReconciliation,branchTrialBalances:issues.length?[]:result};
}
