import Decimal from 'decimal.js';
import {z} from 'zod';
import {statementQuery} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {readApprovedGroupEliminations} from './financial-group-elimination-batches';
import {readApprovedGroupAcquisitions,readGroupAcquisitionLedgerBasis} from './financial-group-acquisition-review';

const request=z.object({action:z.literal('ACQUISITION_POSITION'),query:statementQuery}).strict();
const Money=Decimal.clone({precision:50});

/** Project the closing position for the supported acquisition-day scope. */
export async function readGroupAcquisitionPosition(input:unknown){
 const {query}=request.parse(input);
 const approved=await readApprovedGroupAcquisitions(query);
 if(!approved.rows.some(row=>row.investmentAccountId&&row.calculation.acquisitionDate===query.from&&query.from===query.to))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'ACQUISITION_DAY_OR_LINK_REQUIRED'};
 const worksheet=await readApprovedGroupEliminations(query);
 const base=worksheet.statementWorksheet;
 if(!base)throw Error('GROUP_ACQUISITION_POSITION_SOURCE_REQUIRED');

 // Apply a complete set for this group scope, or display no adjusted position.
 const subsidiaries=base.memberIds.filter(id=>id!==query.organization);
 const approvedSubsidiaries=new Set(approved.rows.map(row=>row.calculation.subsidiaryOrganizationId));
 if(subsidiaries.length!==approved.rows.length||subsidiaries.some(id=>!approvedSubsidiaries.has(id)))
  return {status:'ACQUISITION_POSITION_UNAVAILABLE' as const,query,reason:'GROUP_ACQUISITION_COVERAGE_REQUIRED'};

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
  goodwill=goodwill.plus(basis.acquisitionGoodwill);
  investment=investment.plus(balance);
  bookEquity=bookEquity.plus(basis.subsidiaryBookEquity);
  nci=nci.plus(basis.acquisitionNci);
 }
 const assetDelta=goodwill.minus(investment),equityDelta=nci.minus(bookEquity);
 if(!assetDelta.eq(equityDelta))throw Error('GROUP_ACQUISITION_POSITION_UNRECONCILED');
 const rows=base.position.filter(row=>row.key!=='fiscalProfit').map(row=>{
  const adjustment=row.key==='assets'?assetDelta:row.key==='equity'?equityDelta:new Money(0);
  return {key:row.key,before:row.after,adjustment:adjustment.toFixed(4),after:new Money(row.after).plus(adjustment).toFixed(4)};
 });
 const closing=(key:string)=>new Money(rows.find(row=>row.key===key)!.after);
 if(!closing('assets').eq(closing('liabilities').plus(closing('equity'))))
  throw Error('GROUP_ACQUISITION_POSITION_UNRECONCILED');
 assertStableFinancialReplay(worksheet,await readApprovedGroupEliminations(query));
 assertStableFinancialReplay(approved,await readApprovedGroupAcquisitions(query));
 return {status:'ACQUISITION_DAY_POSITION_REVIEW' as const,query,currency:base.currency,rows,
  investmentEliminated:investment.toFixed(4),subsidiaryEquityEliminated:bookEquity.toFixed(4),
  goodwill:goodwill.toFixed(4),nciAtAcquisition:nci.toFixed(4)};
}
