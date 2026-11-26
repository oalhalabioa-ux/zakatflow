import {z} from 'zod';
import {reviewGroupCurrencyTranslation,translationRatePurpose,type TranslationRatePurpose} from './financial-group-translation-review';
import {statementSourceEnvelope,type StatementSourceSnapshot} from './financial-statement-source';

const date=z.string().date(),uuid=z.string().uuid(),currency=z.string().regex(/^[A-Z]{3}$/);
const resolvedQuote=z.object({
 asOf:date,quoteId:uuid,quoteDate:date,quoteFrom:currency,quoteTo:currency,rate:z.string(),
 policy:z.object({id:uuid,organization_id:uuid,from_currency:currency,to_currency:currency,
  purpose:translationRatePurpose,period_start:date,period_end:date,source:z.string().min(1),
  selection_basis:z.enum(['EXACT_DATE','LATEST_ON_OR_BEFORE']),allow_inverse:z.boolean(),approved_by:uuid}),
});

export type GroupTranslationRateRequest={
 organization:string;fromCurrency:string;toCurrency:string;purpose:TranslationRatePurpose;asOf:string;
};

export const unavailableReportingRateCodes=new Set([
 'REPORTING_FX_POLICY_MISSING','REPORTING_FX_QUOTE_MISSING','REPORTING_FX_QUOTE_AMBIGUOUS',
]);

export class GroupTranslationRateUnavailable extends Error {
 constructor(readonly request:GroupTranslationRateRequest,code:string){super(code);}
}

/** Use the registered group's saved policies for the existing foreign-operation review. */
export async function reviewApprovedGroupTranslation(
 raw:unknown,snapshot:StatementSourceSnapshot,organization:string,presentationCurrency:string,
 resolve:(request:GroupTranslationRateRequest)=>Promise<unknown>,
){
 const source=statementSourceEnvelope.parse(raw);
 if(source.origin!=='LIVE_CANONICAL_EVENTS'||source.from!==source.fiscalStart||
  snapshot.origin!==source.origin||snapshot.statements.organizationId!==source.organizationId||
  snapshot.statements.from!==source.from||snapshot.statements.to!==source.to||!snapshot.periodLedger)
  throw Error('GROUP_FX_FISCAL_START_REQUIRED');

 const movements=new Set(snapshot.cashMovements.map(row=>row.date));
 const kinds=new Map(snapshot.accounts.map(row=>[row.id,row.kind]));
 for(const account of snapshot.periodLedger.accounts){
  if(!['ASSET','LIABILITY','EQUITY'].includes(kinds.get(account.id)!)){
   for(const row of account.entries)movements.add(row.date);
  }
 }
 const required:{date:string;purpose:TranslationRatePurpose}[]=[
  {date:source.openingDate,purpose:'PRIOR_CLOSING'},
  ...[...movements].sort().map(date=>({date,purpose:'TRANSACTION' as const})),
  {date:source.to,purpose:'CLOSING'},
 ];
 const quotes=[];
 for(let start=0;start<required.length;start+=12){
  quotes.push(...await Promise.all(required.slice(start,start+12).map(async({date,purpose})=>{
   const request={organization,fromCurrency:source.currency,toCurrency:presentationCurrency,purpose,asOf:date};
   const rawQuote=await resolve(request).catch(error=>{
    if(error instanceof Error&&unavailableReportingRateCodes.has(error.message))
     throw new GroupTranslationRateUnavailable(request,error.message);
    throw error;
   });
   const result=resolvedQuote.safeParse(rawQuote);
   if(!result.success)throw Error('GROUP_FX_POLICY_SOURCE_INVALID');
   const quote=result.data,policy=quote.policy;
   const direct=quote.quoteFrom===source.currency&&quote.quoteTo===presentationCurrency;
   const inverse=policy.allow_inverse&&quote.quoteFrom===presentationCurrency&&quote.quoteTo===source.currency;
   if(policy.organization_id!==organization||policy.from_currency!==source.currency||
    policy.to_currency!==presentationCurrency||policy.purpose!==purpose||quote.asOf!==date||
    date<policy.period_start||date>policy.period_end||quote.quoteDate>date||
    (policy.selection_basis==='EXACT_DATE'&&quote.quoteDate!==date)||(!direct&&!inverse))
    throw Error('GROUP_FX_POLICY_SOURCE_INVALID');
   return {date,purpose,rate:quote.rate,reference:policy.id+':'+quote.quoteId,quoteDate:quote.quoteDate,
    quoteId:quote.quoteId,policyId:policy.id,publication:policy.source};
  })));
 }
 const report=reviewGroupCurrencyTranslation(source,{functionalCurrency:source.currency,presentationCurrency,
  measurement:'NON_HYPERINFLATIONARY',rates:quotes.map(({date,purpose,rate,reference})=>({date,purpose,rate,reference}))});
 return {...report,approvedQuotes:quotes};
}
