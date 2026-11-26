import {z} from 'zod';
import {requireUser} from './auth';
import {liveStatementSource} from './financial-statement-live';
import {liveRegisteredGroupControl} from './financial-group-registered-source';
import {readInstitutionalSource} from './reporting-source-contracts';
import {normalizeStatementSource,statementQuery,type StatementSourceSnapshot} from '../lib/financial-statement-source';
import {GroupTranslationRateUnavailable,reviewApprovedGroupTranslation,unavailableReportingRateCodes} from '../lib/financial-group-approved-translation';
import {reviewV2Revaluation} from '../lib/financial-group-v2-revaluation';
import {publishedGroupRate} from '../lib/financial-group-reporting-rates';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';

const inputSchema=z.object({query:statementQuery,member:z.string().uuid(),journal:z.string().uuid(),
 translation:z.literal('NON_HYPERINFLATIONARY').optional()}).strict();
// The compiled ledger has optional TypeScript fields that are absent at the JSON API boundary.
function statementReplayValue(snapshot:StatementSourceSnapshot):unknown {
 return JSON.parse(JSON.stringify(snapshot));
}
export async function liveGroupV2Revaluation(input:unknown){
 const {query,member,journal,translation}=inputSchema.parse(input);
 const control=await liveRegisteredGroupControl(query);
 if(!control.expectedOrganizationIds.includes(member))throw Error('REPORTING_ACCESS_DENIED');
 const readCompany=()=>liveStatementSource({...query,organization:member},true);
 const readEvidence=()=>readInstitutionalSource({source:'revaluation',organization:member,journal,asOf:query.to});
 const [company,evidence]=await Promise.all([readCompany(),readEvidence()]);
 if(!evidence)throw Error('GROUP_V2_REVALUATION_REQUIRED');
 const ledger=reviewV2Revaluation(evidence,company);
 if(ledger.journalId!==journal)throw Error('GROUP_V2_REVALUATION_LEDGER_MISMATCH');
 const readParent=()=>liveStatementSource(query);
 const parent=member===query.organization?company:await readParent();
 const companyProof=statementReplayValue(company);
 const currency=parent.statements.currency;
 const sameCurrency=currency===ledger.companyCurrency;
 const readPolicy=async()=>{
  if(sameCurrency)return{status:'SAME_CURRENCY' as const};
  try{
   const selected=await readInstitutionalSource({source:'fx-policy',organization:query.organization,
    fromCurrency:ledger.companyCurrency,toCurrency:currency,purpose:'CLOSING',asOf:query.to});
   return{status:'APPROVED_CLOSING_POLICY' as const,selected};
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(unavailableReportingRateCodes.has(code))return{status:code};
   throw error;
  }
 };
 const policy=await readPolicy();
 const readTranslation=async()=>{
  if(sameCurrency||!translation)return null;
  const {supabase}=await requireUser();
  const raw=await supabase.rpc('financial_statement_live_snapshot',{p_org:member,p_from:query.from,p_to:query.to});
  if(raw.error||!raw.data||raw.data.closureId)throw Error('REPORTING_GROUP_SOURCE_UNAVAILABLE');
  assertStableFinancialReplay(companyProof,statementReplayValue(normalizeStatementSource(raw.data,{...query,organization:member},true)));
  try{
   return await reviewApprovedGroupTranslation(raw.data,company,query.organization,currency,
    request=>readInstitutionalSource({source:'fx-policy',...request}));
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(error instanceof GroupTranslationRateUnavailable)return {status:code,rateRequest:error.request};
   if(code==='GROUP_FX_FISCAL_START_REQUIRED'||code==='GROUP_FX_EQUITY_MOVEMENT_UNSUPPORTED')
    return {status:code};
   throw error;
  }
 };
 const translatedCompany=await readTranslation();
 assertStableFinancialReplay(evidence,await readEvidence());
 assertStableFinancialReplay(companyProof,statementReplayValue(await readCompany()));
 if(!sameCurrency||member!==query.organization)assertStableFinancialReplay(statementReplayValue(parent),statementReplayValue(await readParent()));
 assertStableFinancialReplay(policy,await readPolicy());
 if(translatedCompany)assertStableFinancialReplay(translatedCompany,await readTranslation());
 assertStableFinancialReplay(control,await liveRegisteredGroupControl(query));
 return{status:'V2_GROUP_REVALUATION_REVIEW_ONLY' as const,group:query.organization,currency,ledger,
  publishedClosingReference:sameCurrency?null:publishedGroupRate(ledger.companyCurrency,currency,query.to)??null,policy,translatedCompany,
  groupBookContribution:sameCurrency?{debt:ledger.debtMovement,offset:ledger.offsetMovement}:null};
}
