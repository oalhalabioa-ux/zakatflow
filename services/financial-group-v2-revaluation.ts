import {z} from 'zod';
import {liveStatementSource} from './financial-statement-live';
import {liveRegisteredGroupControl} from './financial-group-registered-source';
import {readInstitutionalSource} from './reporting-source-contracts';
import {statementQuery} from '../lib/financial-statement-source';
import {reviewV2Revaluation} from '../lib/financial-group-v2-revaluation';
import {publishedGroupRate} from '../lib/financial-group-reporting-rates';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';

const inputSchema=z.object({query:statementQuery,member:z.string().uuid(),journal:z.string().uuid()}).strict();
export async function liveGroupV2Revaluation(input:unknown){
 const {query,member,journal}=inputSchema.parse(input);
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
   if(code==='REPORTING_FX_POLICY_MISSING'||code==='REPORTING_FX_QUOTE_MISSING'||code==='REPORTING_FX_QUOTE_AMBIGUOUS')return{status:code};
   throw error;
  }
 };
 const policy=await readPolicy();
 assertStableFinancialReplay(evidence,await readEvidence());
 assertStableFinancialReplay(company,await readCompany());
 if(!sameCurrency||member!==query.organization)assertStableFinancialReplay(parent,await readParent());
 assertStableFinancialReplay(policy,await readPolicy());
 assertStableFinancialReplay(control,await liveRegisteredGroupControl(query));
 return{status:'V2_GROUP_REVALUATION_REVIEW_ONLY' as const,group:query.organization,currency,ledger,
  publishedClosingReference:sameCurrency?null:publishedGroupRate(ledger.companyCurrency,currency,query.to)??null,policy,
  groupBookContribution:sameCurrency?{debt:ledger.debtMovement,offset:ledger.offsetMovement}:null};
}
