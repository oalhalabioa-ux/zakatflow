import {invalidateZakatViews} from '@/lib/zakat-view-refresh';
import Decimal from 'decimal.js';
import {startNextCycle} from './zakat-cycles';
import { requireUser } from './auth';
import { calculateAssessment } from '@/engine/assessment';
import { calculateHawl } from '@/engine/hawl';
import { fetchReferenceMetalPrices } from './reference-prices';
import {assessmentRequestSchema,nisabFromPrice,frozenLotValuation,type FrozenMetalPrice} from '@/lib/zakat-valuation';

export async function listAssessments(){const {supabase,user}=await requireUser();const {data,error}=await supabase.from('zakat_assessments').select('*').eq('user_id',user.id).order('assessment_date',{ascending:false});if(error)throw error;return data;}
type InvoiceHawlPosition = {
 lotId: string; grossBase: Decimal.Value; netBase: Decimal.Value;
 hawlStartDate: string | null; hawlDueDate: string | null; coveredThrough: string | null;
 hawlPeriod: number; periodBasis: string;
};
export type AssessmentRequest={assessment_date:string;valuation_date?:string;nisab_standard?:'GOLD'|'SILVER';method_id?:string;gold_price?:number;silver_price?:number;price_currency?:string;fx_rate?:number;price_mode?:'REFERENCE'|'MANUAL';price_source?:string;nisab_reached_date?:string;nisab_start_method?:'MANUAL'|'HISTORICAL_RECORDED'};
export async function calculateAndSaveAssessment(request:AssessmentRequest,revisionOf?:string){
 const input=assessmentRequestSchema.parse(request);if(input.assessment_date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'}))throw new Error('ASSESSMENT_DATE_IN_FUTURE');
 const {supabase,user}=await requireUser();const valuationDate=input.valuation_date??input.assessment_date;const priceMode=input.price_mode??'MANUAL';
 const {data:profile,error:pe}=await supabase.from('profiles').select('base_currency,zakat_method_id,nisab_standard').eq('id',user.id).single();if(pe)throw pe;const methodId=input.method_id??profile.zakat_method_id;if(!methodId)throw new Error('ZAKAT_METHOD_NOT_CONFIGURED');
 const {data:method,error:me}=await supabase.from('zakat_methods').select('*').eq('id',methodId).single();if(me)throw me;
 const {data:lots,error:le}=await supabase.from('lots').select('*,asset_accounts(id,name,asset_type,currency,is_zakatable,metadata,ownership_scope),transactions!lots_source_transaction_id_fkey(id,transaction_date,transaction_type,sale_id:metadata->>sale_transaction_id)').eq('user_id',user.id);if(le)throw le;
 // Current residual lots cannot reconstruct a balance before a subsequent exit.
 const {data:futureExits,error:futureError}=await supabase.from('transactions').select('id').eq('user_id',user.id).gt('transaction_date',input.assessment_date).in('transaction_type',['SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT','ADJUSTMENT','REVERSAL']).limit(1);
 if(futureError)throw futureError;if(futureExits?.length)throw new Error('HISTORICAL_BALANCE_RECONSTRUCTION_REQUIRED');
 let {data:cycle,error:cycleError}=await supabase.from('zakat_hawl_cycles').select('*').eq('user_id',user.id).in('status',['OPEN','ACTIVE']).order('cycle_no',{ascending:false}).limit(1).maybeSingle();if(cycleError)throw cycleError;
 const readAssessmentContext=async()=>{
  const {data,error}=await supabase.rpc('personal_zakat_assessment_context',{p_cycle:cycle?.id??null,p_method:method.id,p_cutoff:input.assessment_date});
  if(error)throw error;
  return data;
 };
 let assessmentContext=await readAssessmentContext();
 const baseCurrency=profile.base_currency;const standard=assessmentContext?.continuity?.standard??input.nisab_standard??profile.nisab_standard??'SILVER';
 let priceQuery=supabase.from('market_prices').select('*').eq('valuation_date',valuationDate).in('asset_type',['GOLD','SILVER']).order('created_at',{ascending:false});if(input.price_source)priceQuery=priceQuery.eq('source',input.price_source);let {data:prices}=await priceQuery;
 if(priceMode==='REFERENCE'&&(!(prices??[]).length)){const refs=await fetchReferenceMetalPrices(valuationDate);if(refs.length){const {error:priceInsertError}=await supabase.from('market_prices').insert(refs.map(x=>({asset_type:x.metal,instrument_code:x.metal==='GOLD'?'XAU':'XAG',price_per_unit:x.pricePerGram,currency:x.currency,valuation_date:x.valuationDate,source:x.source})));if(priceInsertError)throw priceInsertError;let refreshed=supabase.from('market_prices').select('*').eq('valuation_date',valuationDate).in('asset_type',['GOLD','SILVER']).order('created_at',{ascending:false});if(input.price_source)refreshed=refreshed.eq('source',input.price_source);prices=(await refreshed).data;}}
 const metalPrices:Record<string,FrozenMetalPrice>={};
 for(const metal of ['GOLD','SILVER']){
  const ref=(prices??[]).find((p:any)=>p.asset_type===metal&&(p.karat==null||Number(p.karat)===(metal==='GOLD'?24:999)));
  const price=priceMode==='REFERENCE'?Number(ref?.price_per_unit??0):Number(metal==='GOLD'?input.gold_price??0:input.silver_price??0);
  const currency=priceMode==='REFERENCE'?(ref?.currency??baseCurrency):(input.price_currency??baseCurrency);
  if(currency!==baseCurrency&&(!input.fx_rate||input.price_currency!==currency))throw new Error('VALUATION_FX_RATE_REQUIRED');
  metalPrices[metal]={price,currency,fxRate:currency===baseCurrency?1:input.fx_rate!,source:priceMode==='REFERENCE'?(ref?.source??'market_prices'):'USER_MANUAL',priceId:priceMode==='REFERENCE'?ref?.id??null:null};
 }
 const goldPrice=metalPrices.GOLD.price,silverPrice=metalPrices.SILVER.price;
 const nisabValue=nisabFromPrice(standard,metalPrices);
 const zakatableLots=(lots??[]).filter((l:any)=>l.asset_accounts?.is_zakatable===true&&l.asset_accounts?.ownership_scope!=='ORGANIZATION'&&Number(l.remaining_quantity)>0&&l.acquisition_date<=input.assessment_date);
 const receiptPeriods=new Map<string,Array<{remaining_base:string;period_due:string;period_start:string}>>();
 for(const lot of zakatableLots){
  if(lot.hawl_start_date || lot.transactions?.transaction_type!=='ADD' || !lot.transactions.sale_id)continue;
  const {data,error}=await supabase.rpc('gold_receipt_assessment_periods',{p_receipt:lot.source_transaction_id,p_calendar:method.calendar_type});
  if(error)throw error;
  if(data?.length)receiptPeriods.set(lot.id,data);
 }
 const invoiceEvidence=():InvoiceHawlPosition[]=>assessmentContext?.invoicePositions??[];
 const invoicePositionMap=()=>new Map(invoiceEvidence().map(position=>[position.lotId,position]));
 let invoicePositions=invoicePositionMap();
 const valuation=(l:any)=>{
  const position=invoicePositions.get(l.id);
  if(!position)return frozenLotValuation(l,lots??[],baseCurrency,metalPrices);
  const quantity=new Decimal(l.remaining_quantity);
  const value=new Decimal(position.netBase);
  if(!quantity.eq(position.grossBase))throw new Error('HISTORICAL_BALANCE_RECONSTRUCTION_REQUIRED');
  const price=value.div(quantity).toString();
  return {marketValueBase:value,valuationPrice:price,valuationCurrency:baseCurrency,fxRate:1,
   purity:'1',valuationSource:'INVOICE_NET_V1',
   valuationSnapshot:{assetId:l.asset_account_id,assetName:l.asset_accounts?.name,assetType:l.asset_accounts?.asset_type,
    quantity:quantity.toString(),purity:'1',unitPrice:price,priceCurrency:baseCurrency,fxRate:1,
    priceSource:'INVOICE_NET_V1',priceId:null,marketValueBase:value.toString(),
    hawlStartDate:position.hawlStartDate,invoiceHawlPosition:position}};
 };
 const marketValue=(l:any)=>valuation(l).marketValueBase;
 const poolValue=zakatableLots.reduce((s:any,l:any)=>s.add(marketValue(l)),new Decimal(0));
 if(!cycle&&poolValue.gte(nisabValue)){const{data:previous}=await supabase.from('zakat_hawl_cycles').select('id').eq('user_id',user.id).in('status',['CLOSED','PAID']).order('cycle_no',{ascending:false}).limit(1).maybeSingle();if(previous){cycle=await startNextCycle(previous.id);assessmentContext=null;}}
 if(!cycle&&poolValue.gte(nisabValue)){if(input.nisab_start_method==='HISTORICAL_RECORDED')throw new Error('HISTORICAL_REVIEW_REQUIRED');const start=input.nisab_reached_date;if(!start)throw new Error('PORTFOLIO_NISAB_DATE_REQUIRED');if(start>input.assessment_date)throw new Error('NISAB_DATE_AFTER_ASSESSMENT');const due=calculateHawl(method.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR',new Date(start+'T00:00:00Z'),new Date(start+'T00:00:00Z')).dueDate.toISOString().slice(0,10);const {data:last}=await supabase.from('zakat_hawl_cycles').select('cycle_no').eq('user_id',user.id).order('cycle_no',{ascending:false}).limit(1).maybeSingle();const ins=await supabase.from('zakat_hawl_cycles').insert({user_id:user.id,cycle_no:Number(last?.cycle_no||0)+1,nisab_standard:standard,nisab_value_base:nisabValue.toString(),nisab_reached_date:start,hawl_start_date:start,hawl_due_date:due,status:'ACTIVE',price_mode:priceMode,price_source:priceMode==='REFERENCE'?(input.price_source??prices?.[0]?.source??'market_prices'):'USER_MANUAL',gold_price:goldPrice||null,silver_price:silverPrice||null,snapshot:{personal_start_policy:'FIRST_NISAB_V1',confirmed_start_date:start,confirmed_at:new Date().toISOString(),cycle_anchor_source:'USER_CONFIRMED_PORTFOLIO_NISAB_DATE'}}).select().single();if(ins.error)throw ins.error;cycle=ins.data;assessmentContext=null;}
 const personalHawlPeriodPolicy=cycle&&method.code==='UNIFIED_HAWL'?'PERSONAL_POOL_V1':null;
 assessmentContext??=await readAssessmentContext();
 invoicePositions=invoicePositionMap();
 const periodRows=assessmentContext?.periods;
 const hawlContinuity=assessmentContext?.continuity;
 const periods=new Map<string,any>((periodRows??[]).map((p:any)=>[p.lot_id,p]));
 const {data:coverageRows,error:coverageError}=await supabase.rpc('investment_zakat_lot_coverage',{p_calendar:method.calendar_type});if(coverageError)throw coverageError;
 const coverages=new Map<string,any>((coverageRows??[]).map((c:any)=>[c.lot_id,c]));
 const candidates=zakatableLots.filter((lot:any)=>!!lot.hawl_start_date||receiptPeriods.has(lot.id)||invoicePositions.has(lot.id)).map((lot:any)=>{
  const account=lot.asset_accounts;const v=valuation(lot);
  const invoice=invoicePositions.get(lot.id);
  if(invoice){
   const due=invoice.hawlDueDate;
   if(invoice.coveredThrough&&input.assessment_date<invoice.coveredThrough)throw new Error('ASSESSMENT_BEFORE_FINAL_COVERAGE');
   if(due&&calculateHawl(method.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR',new Date(due+'T00:00:00Z'),new Date(input.assessment_date+'T00:00:00Z')).completed)
    throw new Error('MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW');
   return {lotId:lot.id,assetName:account?.name,assetType:account?.asset_type,...v,quantity:lot.remaining_quantity,
    hawlCompleted:!!due&&due<=input.assessment_date,externalCoveredDays:0,hawlPeriodDays:0,
    valuationSnapshot:{...v.valuationSnapshot,hawlStartDate:invoice.hawlStartDate,hawlDueDate:due,
     hawlPeriod:invoice.hawlPeriod,coveredThrough:invoice.coveredThrough,periodBasis:invoice.periodBasis,
     hawlPeriodPolicy:'FINAL_COVERAGE_V1',valuationDate}};
  }
  const parts=receiptPeriods.get(lot.id);
  if(parts){
   const receiptComponents=parts.map(part=>({remainingBase:part.remaining_base,hawlCompleted:part.period_due<=input.assessment_date}));
   return {lotId:lot.id,assetName:account?.name,assetType:account?.asset_type,...v,quantity:lot.remaining_quantity,
    receiptComponents,hawlCompleted:receiptComponents.some(part=>part.hawlCompleted),externalCoveredDays:0,hawlPeriodDays:0,
    valuationSnapshot:{...v.valuationSnapshot,hawlDueDate:parts[0].period_due,valuationDate,receiptComponentPolicy:'SOURCE_PERIOD_V1'}};
  }
  const period=periods.get(lot.id);if(!period)throw new Error('LOT_HAWL_PERIOD_REQUIRED');
  const coverage=coverages.get(lot.id);const institutionCoverage={policy:'CAPITAL_PERIOD_EXCLUSION_V1',coveredDays:coverage?.covered_days??0,periodDays:coverage?.period_days??0,intervals:coverage?.coverage_intervals??[]};
  const due=period.hawl_due_date;const following=calculateHawl(method.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR',new Date(due+'T00:00:00Z'),new Date(input.assessment_date+'T00:00:00Z'));if(following.completed)throw new Error('MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW');if(period.covered_through&&input.assessment_date<period.covered_through)throw new Error('ASSESSMENT_BEFORE_FINAL_COVERAGE');
  return {lotId:lot.id,assetName:account?.name,assetType:account?.asset_type,...v,hawlCompleted:due<=input.assessment_date,externalCoveredDays:institutionCoverage.coveredDays,hawlPeriodDays:institutionCoverage.periodDays,quantity:lot.remaining_quantity,
   hawlStartDate:period.hawl_start_date,hawlDueDate:due,valuationSnapshot:{...v.valuationSnapshot,institutionCoverage,hawlStartDate:period.hawl_start_date,hawlDueDate:due,hawlPeriod:period.hawl_period,periodBasis:period.period_basis,coveredThrough:period.covered_through,hawlPeriodPolicy:'FINAL_COVERAGE_V1',valuationDate}};
 }).filter((x:any)=>x.marketValueBase.gt(0));
 const qualificationValue=candidates.reduce((sum:Decimal,c:any)=>sum.add(c.marketValueBase),new Decimal(0));
 const calc=calculateAssessment(candidates,nisabValue,method.zakat_rate,qualificationValue);const snapshot={schemaVersion:2,hawlPeriodPolicy:'FINAL_COVERAGE_V1',...(personalHawlPeriodPolicy?{personalHawlPeriodPolicy}:{}),...(hawlContinuity?{hawlContinuity}:{}),...(invoiceEvidence().length?{invoiceHawlEvidence:invoiceEvidence()}:{}),nisabQualificationBasis:'PORTFOLIO_MARKET_VALUE',nisabQualificationValue:qualificationValue.toString(),priceCurrency:input.price_currency??baseCurrency,baseCurrency,metalPrices,revisionOf:revisionOf??null,assessmentDate:input.assessment_date,valuationDate,methodCode:method.code,methodVersion:method.version,calendarType:method.calendar_type,nisabStandard:standard,nisabValue:nisabValue.toString(),portfolioMarketValue:poolValue.toString(),priceMode,priceSource:priceMode==='REFERENCE'?(input.price_source??prices?.[0]?.source??'market_prices'):'USER_MANUAL',prices:{gold:goldPrice,silver:silverPrice},fxRate:input.fx_rate??1,candidateLots:candidates.length,valuationSources:Array.from(new Set(candidates.map((c:any)=>c.valuationSource))),hawlCycleId:cycle?.id??null,calculatedAt:new Date().toISOString()};
 const assessmentPayload={assessment_date:input.assessment_date,valuation_date:valuationDate,method_id:method.id,nisab_standard:standard,nisab_quantity:standard==='GOLD'?85:595,nisab_value_base:nisabValue.toString(),total_zakatable_value:calc.totalEligibleValue.toString(),zakat_rate:method.zakat_rate,zakat_due:calc.zakatDue.toString(),currency:baseCurrency,status:'CALCULATED',method_version:method.version,calculation_snapshot:snapshot,hawl_cycle_id:cycle?.id??null,cycle_number:cycle?.cycle_no??null,assessment_kind:'RECALCULATION'};
 const lines=candidates.map((c:any,i:number)=>({lot_id:c.lotId,quantity:c.quantity,valuation_price:c.valuationPrice,valuation_currency:c.valuationCurrency,fx_rate:c.fxRate,valuation_snapshot:c.valuationSnapshot,market_value:c.marketValueBase.toString(),eligible_value:calc.lines[i].eligibleValue.toString(),zakat_amount:calc.lines[i].zakatAmount.toString(),eligibility_status:calc.lines[i].status,reason_code:c.externalCoveredDays>0&&c.hawlCompleted?'INSTITUTION_COVERED_PERIOD':calc.lines[i].status,explanation:c.externalCoveredDays>0&&c.hawlCompleted?`${c.assetName??'أصل'}: استبعاد ${c.externalCoveredDays} يومًا مزكّى عنها لدى الجهة من ${c.hawlPeriodDays} يومًا في الحول؛ احتساب المدة غير المغطاة فقط دون تسجيل دفع نقدي.`:`${c.assetName??'Asset'} → Lot ${c.lotId}: ${calc.lines[i].explanation}`}));
 const{data:assessment,error:saveError}=await supabase.rpc('save_zakat_assessment_snapshot',{p_assessment:assessmentPayload,p_lines:lines,p_revision_of:revisionOf??null});
 if(saveError)throw saveError;invalidateZakatViews();return{assessment,lines,cycle};
}
export async function confirmAssessment(id:string){
 const {supabase,user}=await requireUser();
 const {data:a,error}=await supabase.from('zakat_assessments').select('id,hawl_cycle_id').eq('id',id).eq('user_id',user.id).single();
 if(error)throw error;if(!a.hawl_cycle_id)throw new Error('ASSESSMENT_CYCLE_REQUIRED');
 const {error:finalError}=await supabase.rpc('close_zakat_cycle',{p_cycle_id:a.hawl_cycle_id,p_final_assessment_id:a.id});
 if(finalError)throw finalError;invalidateZakatViews();
 const {data:final, error:readError}=await supabase.from('zakat_assessments').select('*').eq('id',id).eq('user_id',user.id).single();
 if(readError)throw readError;return final;
}
