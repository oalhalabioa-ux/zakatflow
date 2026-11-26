import {z} from 'zod';
import {requireUser} from './auth';
import {readAssetStatement} from './asset-statement';
import {currentAssetValuation} from '../lib/asset-statement';
import {projectClassifiedPersonalActivity} from '../lib/personal-source-contracts';

const uuid=z.string().uuid(), date=z.string().date(), currency=z.string().regex(/^[A-Z]{3}$/);
const purpose=z.enum(['CLOSING','TRANSACTION','PRIOR_CLOSING']);
const approvedFx=z.object({
 action:z.literal('approve-fx-policy'),organization:uuid,fromCurrency:currency,toCurrency:currency,purpose,
 from:date,to:date,source:z.string().trim().min(1).max(160),quoteScope:z.enum(['ORGANIZATION','PUBLISHED']),
 basis:z.enum(['EXACT_DATE','LATEST_ON_OR_BEFORE']),allowInverse:z.boolean(),reason:z.string().trim().min(3).max(500),
}).strict();
const bindFx=z.object({
 action:z.literal('bind-revaluation'),organization:uuid,journal:uuid,line:uuid,obligation:uuid,
 cutoff:date,debtAccount:z.string().trim().min(1).max(64),
}).strict();
export const institutionalSourceRead=z.discriminatedUnion('source',[
 z.object({source:z.literal('fx-policy'),organization:uuid,fromCurrency:currency,toCurrency:currency,purpose,asOf:date}).strict(),
 z.object({source:z.literal('revaluation'),organization:uuid,journal:uuid,asOf:date}).strict(),
]);
const institutionalSourceWrite=z.discriminatedUnion('action',[approvedFx,bindFx]);

function unpack<T>(response:{data:T;error:{message:string}|null}){
 if(response.error)throw Error(response.error.message.match(/(?:REPORTING_FX|PERSONAL_CLASSIFICATION|PERSONAL_CUTOFF)_[A-Z_]+|UNAUTHORIZED/)?.[0]??'REPORTING_CONTRACT_UNAVAILABLE');
 return response.data;
}
export async function readInstitutionalSource(input:unknown){
 const p=institutionalSourceRead.parse(input),{supabase}=await requireUser();
 return p.source==='fx-policy'
  ?unpack(await supabase.rpc('resolve_organization_reporting_fx',{p_org:p.organization,
    p_pair_from:p.fromCurrency,p_pair_to:p.toCurrency,p_purpose:p.purpose,p_as_of:p.asOf}))
  :unpack(await supabase.rpc('read_financial_fx_revaluation',{p_org:p.organization,p_journal:p.journal,p_as_of:p.asOf}));
}
export async function writeInstitutionalSource(input:unknown){
 const p=institutionalSourceWrite.parse(input),{supabase}=await requireUser();
 return p.action==='approve-fx-policy'
  ?unpack(await supabase.rpc('approve_organization_reporting_fx_policy',{p_org:p.organization,
   p_pair_from:p.fromCurrency,p_pair_to:p.toCurrency,p_purpose:p.purpose,p_start:p.from,p_end:p.to,
   p_source:p.source,p_quote_scope:p.quoteScope,p_basis:p.basis,p_inverse:p.allowInverse,p_reason:p.reason}))
  :unpack(await supabase.rpc('bind_financial_fx_revaluation',{p_org:p.organization,p_journal:p.journal,
   p_line:p.line,p_obligation:p.obligation,p_cutoff:p.cutoff,p_debt_account:p.debtAccount}));
}
export async function readClassifiedPersonalActivity(from:string,to:string){
 const {supabase}=await requireUser(), rows=[];
 for(let offset=0;offset<5000;offset+=500){
  const page=unpack(await supabase.rpc('read_personal_income_expense',{p_from:from,p_to:to})
   .order('entry_date').order('transaction_id').range(offset,offset+499)) as unknown[];
  rows.push(...page);
  if(page.length<500)return projectClassifiedPersonalActivity(rows);
 }
 throw Error('PERSONAL_CLASSIFICATION_SOURCE_LIMIT');
}
export async function classifyPersonalActivity(input:unknown){
 const p=z.object({transaction:uuid,kind:z.enum(['INCOME','EXPENSE']),categoryCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
  description:z.string().trim().min(3).max(500)}).strict().parse(input);
 const {supabase}=await requireUser();
 return unpack(await supabase.rpc('classify_personal_income_expense',{
  p_transaction:p.transaction,p_kind:p.kind,p_code:p.categoryCode,p_description:p.description,
 }));
}

export async function readPersonalCutoffSources(input:unknown){
 const p=z.object({asOf:date,asset:uuid.optional()}).strict().parse(input);
 const {supabase,user}=await requireUser();
 const debts=unpack(await supabase.rpc('read_personal_debts_at_cutoff',{p_as_of:p.asOf}));
 if(!p.asset)return {asOf:p.asOf,scope:'PERSONAL',debts,asset:null,assetCoverage:'REQUEST_ASSET_ID'};
 const read=()=>supabase.from('asset_accounts').select('id,asset_type,currency,metadata')
  .eq('id',p.asset!).eq('user_id',user.id).eq('ownership_scope','PERSONAL').is('organization_id',null).maybeSingle();
 const candidate=unpack(await read());
 if(!candidate)throw Error('PERSONAL_CUTOFF_SOURCE_DENIED');
 const m=candidate.metadata??{};
 if(m.investment_id||m.personal_contract_id||m.register_source)
  return {asOf:p.asOf,scope:'PERSONAL',debts,asset:null,assetCoverage:'SPECIALIZED_SOURCE_REQUIRED'};
 const statement=await readAssetStatement(p.asset,{asOf:p.asOf,offset:0,limit:1});
 const repeated=unpack(await read());
 if(JSON.stringify(candidate)!==JSON.stringify(repeated))throw Error('PERSONAL_CUTOFF_SOURCE_CHANGED');
 const closing=statement.closing;
 const valuation=statement.complete&&closing.quantity!==null&&closing.cost!==null&&m.market_valuation_date===p.asOf&&
   m.market_price_currency===statement.baseCurrency&&m.market_value_auto!==true&&
   typeof m.market_price_source==='string'&&m.market_price_source!=='ACQUISITION_COST'
  ?currentAssetValuation({type:candidate.asset_type,currency:candidate.currency,baseCurrency:statement.baseCurrency,
    metadata:m,quantity:closing.quantity,cost:closing.cost,date:p.asOf})
  :null;
 return {asOf:p.asOf,scope:'PERSONAL',debts,
  asset:{id:p.asset,quantity:closing.quantity,cost:closing.cost,currency:closing.currency,valuation},
  assetCoverage:!statement.complete?'BOOK_EVIDENCE_INCOMPLETE':valuation?'BOOK_AND_EXACT_DATE_PRICE':'BOOK_ONLY'};
}
