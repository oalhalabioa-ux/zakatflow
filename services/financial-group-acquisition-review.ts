import {z} from 'zod';
import Decimal from 'decimal.js';
import {acquisitionFairValueDifferences} from '../lib/financial-group-acquisition-fair-value';
import {statementQuery} from '../lib/financial-statement-source';
import {groupAcquisitionMeasurementSchema,measureGroupAcquisition} from '../lib/financial-group-acquisition';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {liveRegisteredGroupReviewContext} from './financial-group-registered-source';

const request=z.object({query:statementQuery,measurement:groupAcquisitionMeasurementSchema}).strict();
/** Authenticated draft calculation only. Registry and currency come from live
 * authorized sources; acquisition valuations remain unverified user inputs.
 * This endpoint neither approves evidence nor contributes amounts to reports. */
export async function reviewGroupAcquisition(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const {query,measurement}=request.parse(input);
 if(measurement.parentOrganizationId!==query.organization)throw Error('GROUP_ACQUISITION_SCOPE_MISMATCH');
 const before=await liveRegisteredGroupReviewContext(query);
 if(before.control.rootOrganizationId!==query.organization||before.control.from!==query.from||before.control.to!==query.to)throw Error('GROUP_ACQUISITION_SCOPE_MISMATCH');
 const calculation=measureGroupAcquisition(before.control,measurement,before.preflight.wholeEntityRollup.currency);
 // Re-read both membership/control and financial sources before returning any
 // numbers. Revocation or changes during the calculation fail the entire read.
 assertStableFinancialReplay(before,await liveRegisteredGroupReviewContext(query));
 return{status:'UNAPPROVED_ACQUISITION_REVIEW' as const,consolidated:false as const,
  issuanceReady:false as const,evidenceVerified:false as const,persisted:false as const,
  basis:'USER_ENTERED_ACQUISITION_MEASUREMENT' as const,
  query,registryRevision:before.control.registry.revision,calculation};
}

const evidenceQuery={query:statementQuery,id:z.string().uuid()};
const reason=z.string().trim().min(8).max(1000);
const evidenceCommand=z.discriminatedUnion('action',[
 z.object({...evidenceQuery,action:z.literal('SAVE'),measurement:groupAcquisitionMeasurementSchema}).strict(),
 z.object({...evidenceQuery,action:z.literal('APPROVE'),reason}).strict(),
 z.object({...evidenceQuery,action:z.literal('REVOKE'),reason}).strict(),
 z.object({...evidenceQuery,action:z.literal('READ')}).strict(),
]);

/** Store the exact measurement reviewed by an authorized human. */
export async function commandGroupAcquisitionEvidence(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const command=evidenceCommand.parse(input);
 const {requireUser}=await import('./auth');
 const {assertLiveStatements}=await import('./financial-statement-live');
 assertLiveStatements();
 if(command.action==='SAVE')await reviewGroupAcquisition({query:command.query,measurement:command.measurement});
 const {supabase}=await requireUser();
 const result=await supabase.rpc('financial_group_acquisition_evidence_command',{
  p_action:command.action,p_id:command.id,p_root:command.query.organization,p_from:command.query.from,p_to:command.query.to,
  p_measurement:command.action==='SAVE'?command.measurement:null,p_reason:'reason' in command?command.reason:null,
 });
 if(result.error)throw Error(result.error.message.match(/(?:GROUP_(?:ACQUISITION|CONTROL)|REPORTING)_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');
 return result.data;
}

const approvedPortfolio=z.object({
 rootOrganizationId:z.string().uuid(),from:z.string().date(),to:z.string().date(),
 registryRevision:z.string().regex(/^[a-f0-9]{32}$/),
 records:z.array(z.object({
  id:z.string().uuid(),subsidiaryName:z.string().min(1),controlId:z.string().uuid(),
  approvedAt:z.string().datetime({offset:true}),measurement:groupAcquisitionMeasurementSchema,
  documents:z.array(z.object({id:z.string().uuid(),title:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(1002),
 })).max(99),
});

/** Recompute acquisition-date measurements for the current reporting period. */
async function approvedGroupAcquisitions(input:unknown,includeBookItems:boolean){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const query=statementQuery.parse(input);
 const {requireUser}=await import('./auth');
 const {assertLiveStatements}=await import('./financial-statement-live');
 assertLiveStatements();
 const {supabase}=await requireUser();
 const read=async()=>{
  const result=await supabase.rpc('financial_group_approved_acquisition_evidence',{
   p_root:query.organization,p_from:query.from,p_to:query.to,
  });
  if(result.error?.code==='PGRST202')throw Error('REPORTING_ACQUISITIONS_NOT_INSTALLED');
  if(result.error)throw Error(result.error.message.match(/(?:GROUP_(?:ACQUISITION|CONTROL)|REPORTING)_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');
  const parsed=approvedPortfolio.safeParse(result.data);
  if(!parsed.success)throw Error('REPORTING_UNAVAILABLE');
  const {rootOrganizationId,from,to}=parsed.data;
  if(rootOrganizationId!==query.organization||from!==query.from||to!==query.to)
   throw Error('REPORTING_ACCESS_DENIED');
  return parsed.data;
 };
 const evidence=await read();
 let rows: Array<{
  id:string; subsidiaryName:string; approvedAt:string; documentCount:number;
  calculation:ReturnType<typeof measureGroupAcquisition>;
  investmentAccountId:string|null;
  continuityDocumented:boolean;
  ordinaryDividend?:{subsidiaryEventId:string;parentEventId:string;evidenceDocumentId:string};
  fairValueTaxBasisDocumented?:boolean;
  noDeferredTaxRequired?:boolean;
  depreciationSchedules?:{accountId:string;usefulLifeDays:number;deferredTaxLiabilityAccountId?:string}[];
  bookItems?: {id:string;kind:"ASSET"|"LIABILITY";recognizedAmount:string}[];
 }>=[];
 if(evidence.records.length){
  const {control,preflight}=await liveRegisteredGroupReviewContext(query);
  if(control.rootOrganizationId!==query.organization||control.from!==query.from||control.to!==query.to||
    control.registry.revision!==evidence.registryRevision)throw Error('GROUP_ACQUISITION_CONTROL_CHANGED');
  rows=evidence.records.map(record=>{
   const calculation=measureGroupAcquisition(control,record.measurement,preflight.wholeEntityRollup.currency);
   if(calculation.controlAssessmentId!==record.controlId||calculation.reassessmentRequired)
    throw Error('GROUP_ACQUISITION_CONTROL_CHANGED');
   return {id:record.id,subsidiaryName:record.subsidiaryName,approvedAt:record.approvedAt,
    documentCount:record.documents.length,calculation,continuityDocumented:Boolean(record.measurement.continuityBasis),investmentAccountId:record.measurement.investmentLink?.accountId??null,
    ...(includeBookItems?{...(record.measurement.ordinaryDividend?{ordinaryDividend:record.measurement.ordinaryDividend}:{}),
     fairValueTaxBasisDocumented:Boolean(record.measurement.fairValueBasis),
     noDeferredTaxRequired:record.measurement.fairValueBasis?.deferredTax==='NOT_REQUIRED',
     depreciationSchedules:record.measurement.continuityBasis?.treatment==='STRAIGHT_LINE_UPLIFT'?record.measurement.continuityBasis.schedules:[],
     bookItems:record.measurement.identifiableItems.map(({id,kind,recognizedAmount})=>({id,kind,recognizedAmount}))}:{})};
  });
 }
 assertStableFinancialReplay(evidence,await read());
 return {status:'APPROVED_ACQUISITION_REVIEW' as const,query,rows};
}

export function readApprovedGroupAcquisitions(input:unknown){
 return approvedGroupAcquisitions(input,false);
}

const ledgerBasisRequest=z.object({action:z.literal('LEDGER_BASIS'),query:statementQuery,id:z.string().uuid()}).strict();

/** Dated book balances underlying a review. The 1600 account group may contain
 * investments in several entities, so its balances are not a linked investment. */
export async function readGroupAcquisitionLedgerBasis(input:unknown){
 const {query,id}=ledgerBasisRequest.parse(input);
 const approved=await approvedGroupAcquisitions(query,true);
 const selected=approved.rows.find(row=>row.id===id);
 if(!selected)throw Error('GROUP_ACQUISITION_APPROVAL_REQUIRED');
 const {acquisitionDate:date,parentOrganizationId,subsidiaryOrganizationId,currency}=selected.calculation;
 const {liveStatementSource}=await import('./financial-statement-live');
 const read=(organization:string)=>liveStatementSource({organization,from:date,to:date});
 const [parent,subsidiary]=await Promise.all([read(parentOrganizationId),read(subsidiaryOrganizationId)]);
 const [parentAgain,subsidiaryAgain]=await Promise.all([read(parentOrganizationId),read(subsidiaryOrganizationId)]);
 for(const [source,replay,organization] of [[parent,parentAgain,parentOrganizationId],[subsidiary,subsidiaryAgain,subsidiaryOrganizationId]] as const){
  const {statements}=source;
  if(source.origin!=='LIVE_CANONICAL_EVENTS'||source.scope!=='ORGANIZATION_ALL_ENTITIES'||
    statements.organizationId!==organization||statements.from!==date||statements.to!==date)
   throw Error('GROUP_ACQUISITION_LEDGER_SCOPE_INVALID');
  if(statements.currency!==currency)throw Error('GROUP_ACQUISITION_FX_REQUIRED');
  assertStableFinancialReplay(source,replay);
 }
 assertStableFinancialReplay(approved,await approvedGroupAcquisitions(query,true));
 const Money=Decimal.clone({precision:50});
 const investments=parent.accounts.filter(account=>account.kind==='ASSET'&&(account.reportingCode??account.id)==='1600');
 const linked=selected.investmentAccountId===null?null:investments.find(account=>account.id===selected.investmentAccountId);
 if(selected.investmentAccountId!==null&&(!linked||!new Money(linked.balance).eq(selected.calculation.consideration)))
  throw Error('GROUP_ACQUISITION_INVESTMENT_UNRECONCILED');
 const equity=subsidiary.accounts.filter(account=>account.kind==='EQUITY');
 const investmentTotal=investments.reduce((sum,account)=>sum.plus(account.balance),new Money(0));
 const equityTotal=equity.reduce((sum,account)=>sum.minus(account.balance),new Money(subsidiary.statements.position.fiscalProfit));
 if(!equityTotal.eq(subsidiary.statements.position.equity))throw Error('GROUP_ACQUISITION_LEDGER_UNRECONCILED');
 const fairValue=acquisitionFairValueDifferences(subsidiary.accounts,selected.bookItems??[],selected.fairValueTaxBasisDocumented===true);
 return {status:'ACQUISITION_LEDGER_BASIS_REVIEW' as const,query,id,date,currency,
  parentInvestmentAccountGroupBalance:investmentTotal.toFixed(4),
  subsidiaryBookEquity:equityTotal.toFixed(4),
  subsidiaryFiscalProfit:subsidiary.statements.position.fiscalProfit,
  fairValueLessBookEquity:new Money(selected.calculation.identifiableNetAssets).minus(equityTotal).toFixed(4),
  investmentAccountCount:investments.length,
  linkedInvestment:linked?{accountId:linked.id,balance:linked.balance}:null,
  // The first projection supports an acquisition-day position with no
  // subsidiary posting on that day and a complete mapping of approved values.
  positionEligibility:!linked?'INVESTMENT_LINK_REQUIRED' as const:
   query.from!==date?'ACQUISITION_START_REQUIRED' as const:
   subsidiary.statements.sourceJournalIds.length?'SUBSIDIARY_DAY_POSTINGS' as const:
   fairValue.status,
  fairValueAdjustments:fairValue.status==='ELIGIBLE'?fairValue.adjustments:[],
  depreciationSchedules:selected.depreciationSchedules??[],
  noDeferredTaxRequired:selected.noDeferredTaxRequired===true,
  ordinaryDividend:selected.ordinaryDividend??null,
  acquisitionGoodwill:selected.calculation.goodwill,
  acquisitionNci:selected.calculation.nciAtAcquisition,
 };
}
