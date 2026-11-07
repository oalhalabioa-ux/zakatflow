import Decimal from 'decimal.js';
import {compileBranchStatementPreview,type BranchStatementInput} from './financial-branch-statements';
import {validateBranchAllocations} from './financial-branch-allocation';

const Money=Decimal.clone({precision:50});
const positive=/^\d{1,20}(\.\d{1,4})?$/;

export type InterbranchClearingPair={
 id:string;
 fromBranchId:string|null;
 toBranchId:string|null;
 dueFromAccountId:string;
 dueToAccountId:string;
 amount:string;
 /** Two distinct documentary references. Their legitimacy is NOT attested by this pure function. */
 sourceReferences:readonly [string,string];
};
export type InterbranchClearingResult=
 |{status:'BLOCKED';code:'SEGMENTS_UNRECONCILED'|'CLEARING_EVIDENCE_INVALID'|'CLEARING_MISMATCH';company:null}
 |{status:'INTERBRANCH_CLEARING_PREVIEW_ONLY';revision:string;pairIds:string[];
    before:{assets:string;liabilities:string;equity:string};
    after:{assets:string;liabilities:string;equity:string};
    openingCash:string;closingCash:string;netProfit:string;
    /** Never promote client-provided references to authorized evidence. */
    sourceReferencesVerified:false;companyStatementCertified:false};

/**
 * QA-only elimination of EXPLICIT, fully outstanding reciprocal HQ/branch balances
 * within one legal entity. This does NOT modify the legal books or infer transfers,
 * and is NOT a company/group statement or an exportable certification.
 *
 * The future server adapter must verify both source references, exact journal
 * line attribution, account purposes, branch membership and complete source
 * revisions BEFORE treating any pair as an approved internal clearing.
 */
export function previewInterbranchClearings(input:BranchStatementInput,pairs:readonly InterbranchClearingPair[]):InterbranchClearingResult{
 const blocked=(code:Extract<InterbranchClearingResult,{status:'BLOCKED'}>['code']):InterbranchClearingResult=>
  ({status:'BLOCKED',code,company:null});
 let preview:ReturnType<typeof compileBranchStatementPreview>;
 let allocation:ReturnType<typeof validateBranchAllocations>;
 try{
  preview=compileBranchStatementPreview(input);
  if(preview.status!=='RECONCILED_SEGMENTS_PREVIEW_ONLY'||!preview.company)return blocked('SEGMENTS_UNRECONCILED');
  allocation=validateBranchAllocations({organizationId:input.source.organizationId,
   currency:input.source.currency,branchIds:input.branchIds,
   coverage:input.coverage,sourceLines:input.allocations});
  if(allocation.status!=='READY_FOR_BRANCH_REPORTS'||!allocation.companyReconciliation)
   return blocked('SEGMENTS_UNRECONCILED');
 }catch{return blocked('SEGMENTS_UNRECONCILED');}
 if(!pairs.length||pairs.length>1000)return blocked('CLEARING_EVIDENCE_INVALID');
 const accounts=new Map(input.source.accounts.map(a=>[a.id,a]));
 const segments=new Map(allocation.branchTrialBalances.map(s=>[s.branchId,s]));
 const seenIds=new Set<string>(),seenAccounts=new Set<string>(),seenReferences=new Set<string>();
 let total=new Money(0);
 for(const pair of pairs){
  if(!pair.id?.trim()||seenIds.has(pair.id)||pair.fromBranchId===pair.toBranchId||
   !segments.has(pair.fromBranchId)||!segments.has(pair.toBranchId)||
   pair.dueFromAccountId===pair.dueToAccountId||
   seenAccounts.has(pair.dueFromAccountId)||seenAccounts.has(pair.dueToAccountId)||
   accounts.get(pair.dueFromAccountId)?.kind!=='ASSET'||
   accounts.get(pair.dueToAccountId)?.kind!=='LIABILITY'||
   !positive.test(pair.amount)||new Money(pair.amount).lte(0)||
   !Array.isArray(pair.sourceReferences)||pair.sourceReferences.length!==2||
   pair.sourceReferences.some(ref=>typeof ref!=='string'||!ref.trim()||seenReferences.has(ref))||
   pair.sourceReferences[0]===pair.sourceReferences[1])
   return blocked('CLEARING_EVIDENCE_INVALID');
  seenIds.add(pair.id);seenAccounts.add(pair.dueFromAccountId);seenAccounts.add(pair.dueToAccountId);
  pair.sourceReferences.forEach(ref=>seenReferences.add(ref));
  const dueFrom=segments.get(pair.fromBranchId)!.accounts.find(a=>a.accountCode===pair.dueFromAccountId);
  const dueTo=segments.get(pair.toBranchId)!.accounts.find(a=>a.accountCode===pair.dueToAccountId);
  const companyDueFrom=allocation.companyReconciliation.accounts.find(a=>a.accountCode===pair.dueFromAccountId);
  const companyDueTo=allocation.companyReconciliation.accounts.find(a=>a.accountCode===pair.dueToAccountId);
  const amount=new Money(pair.amount);
  if(!dueFrom||!dueTo||!companyDueFrom||!companyDueTo||
   !new Money(dueFrom.netDebit).eq(amount)||!new Money(dueTo.netDebit).eq(amount.negated())||
   !new Money(companyDueFrom.netDebit).eq(amount)||
   !new Money(companyDueTo.netDebit).eq(amount.negated()))
   return blocked('CLEARING_MISMATCH');
  total=total.plus(amount);
 }
 const company=preview.company!;
 const before={assets:company.position.assets,liabilities:company.position.liabilities,equity:company.position.equity};
 const assets=new Money(before.assets).minus(total),liabilities=new Money(before.liabilities).minus(total);
 if(assets.isNegative()||liabilities.isNegative()||!assets.minus(liabilities).eq(before.equity))
  return blocked('CLEARING_MISMATCH');
 return{status:'INTERBRANCH_CLEARING_PREVIEW_ONLY',revision:preview.revision,
  pairIds:pairs.map(p=>p.id),before,
  after:{assets:assets.toFixed(4),liabilities:liabilities.toFixed(4),equity:before.equity},
  openingCash:company.cash.opening,closingCash:company.cash.closing,netProfit:company.income.netProfit,
  sourceReferencesVerified:false,companyStatementCertified:false};
}
