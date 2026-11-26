import Decimal from 'decimal.js';
import {z} from 'zod';
import {endingForFiscalStart} from './financial-fiscal-end';
import {normalizeStatementSource,statementSourceEnvelope} from './financial-statement-source';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const currency=z.string().regex(/^[A-Z]{3}$/);
export const translationRatePurpose=z.enum(['PRIOR_CLOSING','TRANSACTION','CLOSING']);
export type TranslationRatePurpose=z.infer<typeof translationRatePurpose>;
const translationBasis=z.object({
 functionalCurrency:currency,
 presentationCurrency:currency,
 measurement:z.literal('NON_HYPERINFLATIONARY'),
 rates:z.array(z.object({
  date:z.string().date(),
  rate:z.string().regex(/^\d{1,12}(\.\d{1,36})?$/),
  purpose:translationRatePurpose.optional(),
  reference:z.string().trim().min(1),
 }).strict()).min(2).max(369),
}).strict();

/** One foreign company's fiscal-start review. The caller must establish the
 * reporting framework, functional currency and approved rate provenance.
 * Rates are presentation currency per unit of functional currency.
 */
export function reviewGroupCurrencyTranslation(raw:unknown,basis:unknown){
 const source=statementSourceEnvelope.parse(raw);
 const snapshot=normalizeStatementSource(source,{organization:source.organizationId,from:source.from,to:source.to},true);
 const evidence=translationBasis.parse(basis);
 if(source.from!==source.fiscalStart||source.to>endingForFiscalStart(source.fiscalStart))throw Error('GROUP_FX_FISCAL_START_REQUIRED');
 if(source.currency!==evidence.functionalCurrency||source.currency===evidence.presentationCurrency)
  throw Error('GROUP_FX_CURRENCY_MISMATCH');
 const rates=new Map<string,Decimal>();
 const typed=evidence.rates[0].purpose!==undefined;
 const key=(date:string,purpose?:TranslationRatePurpose)=>purpose?purpose+':'+date:date;
 for(const row of evidence.rates){
  const rate=new Money(row.rate);
  if((row.purpose!==undefined)!==typed||rates.has(key(row.date,row.purpose))||!rate.gt(0)||row.date<source.openingDate||row.date>source.to)
   throw Error('GROUP_FX_RATE_INVALID');
  rates.set(key(row.date,row.purpose),rate);
 }
 const rateAt=(date:string,purpose:TranslationRatePurpose)=>{
  const rate=rates.get(key(date,typed?purpose:undefined));
  if(!rate)throw Error('GROUP_FX_DATED_RATE_REQUIRED');
  return rate;
 };
 const openingRate=rateAt(source.openingDate,'PRIOR_CLOSING'),closingRate=rateAt(source.to,'CLOSING');
 const accounts=snapshot.periodLedger!.accounts;
 const kinds=new Map(source.accounts.map(a=>[a.id,a.kind]));
 const equity=accounts.filter(a=>kinds.get(a.id)==='EQUITY');
 if(equity.some(a=>a.entries.length))throw Error('GROUP_FX_EQUITY_MOVEMENT_UNSUPPORTED');

 const atPrecision=(n:Decimal)=>n.toDecimalPlaces(4);
 let profit=new Money(0);
 for(const account of accounts){
  const kind=kinds.get(account.id)!;
  if(kind==='ASSET'||kind==='LIABILITY'||kind==='EQUITY')continue;
  for(const entry of account.entries){
   profit=profit.plus(new Money(entry.credit).minus(entry.debit).times(rateAt(entry.date,'TRANSACTION')));
  }
 }
 const income=atPrecision(profit);
 const openingEquity=atPrecision(equity.reduce((n,a)=>n.minus(a.opening),new Money(0)).times(openingRate));
 const assets=atPrecision(new Money(snapshot.statements.position.assets).times(closingRate));
 const liabilities=atPrecision(new Money(snapshot.statements.position.liabilities).times(closingRate));
 const closingEquity=assets.minus(liabilities);
 const translationDifference=closingEquity.minus(openingEquity).minus(income);

 const cash=snapshot.statements.cash;
 const opening=atPrecision(new Money(cash.opening).times(openingRate));
 const closing=atPrecision(new Money(cash.closing).times(closingRate));
 const activities={OPERATING:new Money(0),INVESTING:new Money(0),FINANCING:new Money(0)};
 for(const flow of snapshot.cashMovements){
  activities[flow.activity]=activities[flow.activity].plus(new Money(flow.amount).times(rateAt(flow.date,'TRANSACTION')));
 }
 const operating=atPrecision(activities.OPERATING),investing=atPrecision(activities.INVESTING),financing=atPrecision(activities.FINANCING);
 const cashRateEffect=closing.minus(opening).minus(operating).minus(investing).minus(financing);

 return {
  status:'GROUP_FX_TRANSLATION_REVIEW_ONLY' as const,
  from:source.from,to:source.to,organizationId:source.organizationId,
  functionalCurrency:source.currency,presentationCurrency:evidence.presentationCurrency,
  sourceJournalIds:snapshot.statements.sourceJournalIds,openingSourceId:snapshot.openingSourceId,
  rates:evidence.rates,
  position:{assets:assets.toFixed(4),liabilities:liabilities.toFixed(4),
   openingEquity:openingEquity.toFixed(4),closingEquity:closingEquity.toFixed(4),translationDifference:translationDifference.toFixed(4)},
  netProfit:income.toFixed(4),
  cash:{opening:opening.toFixed(4),operating:operating.toFixed(4),investing:investing.toFixed(4),financing:financing.toFixed(4),
   exchangeRateEffect:cashRateEffect.toFixed(4),closing:closing.toFixed(4)},
 };
}
