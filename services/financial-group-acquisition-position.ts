import Decimal from 'decimal.js';
import {acquisitionUpliftDepreciation} from '../lib/financial-group-acquisition-depreciation';
import {compileEventLedger} from '../lib/financial-event-ledger';
import {liveRegisteredGroupEvidence} from './financial-group-registered-source';
import {z} from 'zod';
import {statementQuery} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {readApprovedGroupEliminations} from './financial-group-elimination-batches';
import {readApprovedGroupAcquisitions,readGroupAcquisitionLedgerBasis} from './financial-group-acquisition-review';

const request=z.object({action:z.literal('ACQUISITION_POSITION'),query:statementQuery}).strict();
const Money=Decimal.clone({precision:50});

/** Project the closing position with acquisition adjustments verified for the selected scope. */
export async function readGroupAcquisitionPosition(input:unknown){
 const {query}=request.parse(input);
 const approved=await readApprovedGroupAcquisitions(query);
 const later=query.from!==query.to;
 if(!approved.rows.some(row=>row.investmentAccountId&&row.calculation.acquisitionDate===query.from))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'ACQUISITION_START_OR_LINK_REQUIRED'};
 if(later&&approved.rows.some(row=>!row.continuityDocumented||!new Money(row.calculation.nciPercent).isZero()))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'CONTINUITY_EVIDENCE_OR_OWNERSHIP_REQUIRED'};
 const worksheet=await readApprovedGroupEliminations(query);
 const base=worksheet.statementWorksheet;
 if(!base)throw Error('GROUP_ACQUISITION_POSITION_SOURCE_REQUIRED');

 // Apply a complete set for this group scope, or display no adjusted position.
 const subsidiaries=base.memberIds.filter(id=>id!==query.organization);
 const approvedSubsidiaries=new Set(approved.rows.map(row=>row.calculation.subsidiaryOrganizationId));
 if(subsidiaries.length!==approved.rows.length||subsidiaries.some(id=>!approvedSubsidiaries.has(id)))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'GROUP_ACQUISITION_COVERAGE_REQUIRED'};

 const fairValueAdjustments:Array<Awaited<ReturnType<typeof readGroupAcquisitionLedgerBasis>>['fairValueAdjustments'][number]&{subsidiaryName:string;subsidiaryId:string}>=[];
 // For carry-forward, read the full same-fiscal-year source, including
 // offsetting postings that a closing-balance comparison would miss.
 const carrySources=later?await liveRegisteredGroupEvidence(query):null;
 if(carrySources?.rawSources.some(source=>source.fiscalStart>query.from))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'CARRY_FORWARD_PERIOD_UNSUPPORTED'};
 const journals=new Map(carrySources?.rawSources.map(source=>[source.organizationId,compileEventLedger(source).source.journals]));
 const depreciationAdjustments:Array<NonNullable<ReturnType<typeof acquisitionUpliftDepreciation>>[number]&{subsidiaryId:string;subsidiaryName:string}>=[];
 let depreciation=new Money(0);
 let fairValueAssets=new Money(0),fairValueLiabilities=new Money(0);
 let goodwill=new Money(0),investment=new Money(0),bookEquity=new Money(0),nci=new Money(0);
 for(const record of approved.rows){
  const basis=await readGroupAcquisitionLedgerBasis({action:'LEDGER_BASIS',query,id:record.id});
  if(basis.positionEligibility!=='ELIGIBLE'||!basis.linkedInvestment)
   return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:basis.positionEligibility};
  const {accountId,balance}=basis.linkedInvestment;
  // Any subsidiary adjustment or use of the dedicated parent account needs
  // a reconciliation of acquisition-day carrying values with the batch.
  if(worksheet.bindings.some(binding=>[binding.debitSource,binding.creditSource].some(source=>
    source.organizationId===record.calculation.subsidiaryOrganizationId||
    (source.organizationId===query.organization&&source.accountId===accountId)))||worksheet.cashWorksheet)
   return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'OVERLAPPING_ELIMINATION'};
  const subsidiaryId=record.calculation.subsidiaryOrganizationId;
  if(later){
   const subsidiaryAccounts=new Set(basis.fairValueAdjustments.map(item=>item.accountId));
   const subsidiarySource=carrySources?.rawSources.find(source=>source.organizationId===subsidiaryId);
   // A fair-value difference can be assigned to a reporting control account.
   // Treat activity on any child of that control as activity on the balance.
   for(const account of subsidiarySource?.accounts??[]){
    if(account.reportingCode&&subsidiaryAccounts.has(account.reportingCode))subsidiaryAccounts.add(account.id);
   }
   const assetDifferences=basis.fairValueAdjustments.filter(item=>item.kind==='ASSET');
   if(assetDifferences.length||basis.depreciationSchedules.length){
    const schedule=acquisitionUpliftDepreciation(basis.fairValueAdjustments,basis.depreciationSchedules,basis.date,query.to);
    if(!basis.noDeferredTaxRequired||!schedule||assetDifferences.some(item=>!subsidiarySource?.accounts.some(account=>
     account.id===item.accountId&&(account.reportingCode??account.id)==='1500')))
     return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'SUBSEQUENT_ASSET_MEASUREMENT_REQUIRED'};
    for(const item of schedule){
     depreciation=depreciation.plus(item.charge);
     depreciationAdjustments.push({...item,subsidiaryId,subsidiaryName:record.subsidiaryName});
    }
   }
   const parentJournals=journals.get(query.organization);
   const subsidiaryJournals=journals.get(subsidiaryId);
   const touchesAfter=(entries:NonNullable<typeof parentJournals>,accounts:Set<string>)=>entries.some(journal=>
    journal.date>basis.date&&journal.lines.some(line=>accounts.has(line.accountId)));
   if(!parentJournals||!subsidiaryJournals||!subsidiarySource||
     touchesAfter(parentJournals,new Set([accountId]))||touchesAfter(subsidiaryJournals,subsidiaryAccounts))
    return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'SUBSEQUENT_ACCOUNT_MOVEMENT'};
  }
  let netDifference=new Money(0);
  for(const item of basis.fairValueAdjustments){
   const delta=new Money(item.adjustment);
   if(item.kind==='ASSET')fairValueAssets=fairValueAssets.plus(delta);
   else fairValueLiabilities=fairValueLiabilities.plus(delta);
   netDifference=netDifference.plus(item.kind==='ASSET'?delta:delta.negated());
   fairValueAdjustments.push({...item,subsidiaryName:record.subsidiaryName,subsidiaryId});
  }
  if(!netDifference.eq(basis.fairValueLessBookEquity))throw Error('GROUP_ACQUISITION_POSITION_UNRECONCILED');
  goodwill=goodwill.plus(basis.acquisitionGoodwill);
  investment=investment.plus(balance);
  bookEquity=bookEquity.plus(basis.subsidiaryBookEquity);
  nci=nci.plus(basis.acquisitionNci);
 }
 const assetDelta=goodwill.plus(fairValueAssets).minus(investment).minus(depreciation),equityDelta=nci.minus(bookEquity).minus(depreciation);
 if(!assetDelta.eq(fairValueLiabilities.plus(equityDelta)))throw Error('GROUP_ACQUISITION_POSITION_UNRECONCILED');
 const rows=base.position.filter(row=>row.key!=='fiscalProfit').map(row=>{
  const adjustment=row.key==='assets'?assetDelta:row.key==='equity'?equityDelta:fairValueLiabilities;
  return {key:row.key,before:row.after,adjustment:adjustment.toFixed(4),after:new Money(row.after).plus(adjustment).toFixed(4)};
 });
 const income=base.income.filter(row=>['operatingExpenses','operatingProfit','netProfit'].includes(row.key)).map(row=>{
  const adjustment=row.key==='operatingExpenses'?depreciation:depreciation.negated();
  return {key:row.key,before:row.after,adjustment:adjustment.toFixed(4),after:new Money(row.after).plus(adjustment).toFixed(4)};
 });
 const closing=(key:string)=>new Money(rows.find(row=>row.key===key)!.after);
 if(!closing('assets').eq(closing('liabilities').plus(closing('equity'))))
  throw Error('GROUP_ACQUISITION_POSITION_UNRECONCILED');
 if(carrySources)assertStableFinancialReplay(carrySources,await liveRegisteredGroupEvidence(query));
 assertStableFinancialReplay(worksheet,await readApprovedGroupEliminations(query));
 assertStableFinancialReplay(approved,await readApprovedGroupAcquisitions(query));
 return {status:later?'ACQUISITION_CARRY_FORWARD_POSITION_REVIEW' as const:'ACQUISITION_DAY_POSITION_REVIEW' as const,query,currency:base.currency,rows,
  investmentEliminated:investment.toFixed(4),subsidiaryEquityEliminated:bookEquity.toFixed(4),
  goodwill:goodwill.toFixed(4),nciAtAcquisition:nci.toFixed(4),fairValueAdjustments,depreciationAdjustments,income};
}
