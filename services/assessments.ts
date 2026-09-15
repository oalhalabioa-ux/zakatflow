import Decimal from 'decimal.js';
import { requireUser } from './auth';
import { calculateAssessment } from '@/engine/assessment';
import { calculateHawl } from '@/engine/hawl';

export async function listAssessments(){
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('zakat_assessments').select('*').eq('user_id',user.id).order('assessment_date',{ascending:false});
  if(error)throw error; return data;
}

export type AssessmentRequest={assessment_date:string; valuation_date?:string; nisab_standard?:'GOLD'|'SILVER'; method_id?:string; gold_price?:number; silver_price?:number; price_currency?:string; fx_rate?:number};

export async function calculateAndSaveAssessment(input: AssessmentRequest){
  const {supabase,user}=await requireUser();
  const valuationDate=input.valuation_date ?? input.assessment_date;
  const {data:profile,error:pe}=await supabase.from('profiles').select('base_currency,zakat_method_id,nisab_standard').eq('id',user.id).single();
  if(pe) throw pe;
  const methodId=input.method_id ?? profile.zakat_method_id;
  if(!methodId) throw new Error('ZAKAT_METHOD_NOT_CONFIGURED');
  const {data:method,error:me}=await supabase.from('zakat_methods').select('*').eq('id',methodId).single();
  if(me) throw me;

  const {data:lots,error:le}=await supabase.from('lots').select('*,asset_accounts(name,asset_type,currency,is_zakatable),transactions!lots_source_transaction_id_fkey(id,transaction_date)').eq('user_id',user.id).gt('remaining_quantity',0);
  if(le) throw le;

  const baseCurrency=profile.base_currency;
  const standard=input.nisab_standard ?? profile.nisab_standard ?? 'SILVER';
  const {data:prices}=await supabase.from('market_prices').select('*').eq('valuation_date',valuationDate).in('asset_type',['GOLD','SILVER']).order('created_at',{ascending:false});
  const goldPrice = input.gold_price ?? Number(prices?.find((p:any)=>p.asset_type==='GOLD')?.price_per_unit ?? 0);
  const silverPrice = input.silver_price ?? Number(prices?.find((p:any)=>p.asset_type==='SILVER')?.price_per_unit ?? 0);
  if((standard==='GOLD' && goldPrice<=0)||(standard==='SILVER' && silverPrice<=0)) throw new Error('NISAB_PRICE_REQUIRED');
  const nisabValue = new Decimal(standard==='GOLD'?85:595).mul(standard==='GOLD'?goldPrice:silverPrice);

  const candidates=(lots??[]).map((lot:any)=>{
    const account=lot.asset_accounts;
    let value=new Decimal(lot.remaining_value_base||0);
    if(account?.asset_type==='GOLD' || account?.asset_type==='SILVER'){
      const p=account.asset_type==='GOLD'?goldPrice:silverPrice;
      const fx=input.fx_rate ?? 1;
      value=new Decimal(lot.remaining_quantity).mul(p).mul(fx);
    }
    const assessment=new Date(input.assessment_date+'T00:00:00Z');
    const start=new Date(lot.hawl_start_date+'T00:00:00Z');
    const hawl=calculateHawl(method.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR',start,assessment);
    return {lotId:lot.id, transactionId:lot.source_transaction_id, assetName:account?.name, marketValueBase:value, hawlCompleted:hawl.completed, quantity:lot.remaining_quantity, valuationPrice:account?.asset_type==='GOLD'?goldPrice:account?.asset_type==='SILVER'?silverPrice:null, valuationCurrency:baseCurrency, fxRate:input.fx_rate ?? 1, hawlDueDate:hawl.dueDate.toISOString().slice(0,10)};
  }).filter((x:any)=>x.marketValueBase.gt(0));

  const calc=calculateAssessment(candidates,nisabValue,method.zakat_rate);
  const snapshot={assessmentDate:input.assessment_date,valuationDate,methodCode:method.code,methodVersion:method.version,nisabStandard:standard,nisabValue:nisabValue.toString(),prices:{gold:goldPrice,silver:silverPrice},fxRate:input.fx_rate??1,calculatedAt:new Date().toISOString()};
  const {data:assessment,error:ae}=await supabase.from('zakat_assessments').insert({user_id:user.id,assessment_date:input.assessment_date,valuation_date:valuationDate,method_id:method.id,nisab_standard:standard,nisab_quantity:standard==='GOLD'?85:595,nisab_value_base:nisabValue.toString(),total_zakatable_value:calc.totalEligibleValue.toString(),zakat_rate:method.zakat_rate,zakat_due:calc.zakatDue.toString(),currency:baseCurrency,status:'CALCULATED',method_version:method.version,calculation_snapshot:snapshot}).select().single();
  if(ae) throw ae;

  const lines=candidates.map((c:any,i:number)=>({assessment_id:assessment.id,lot_id:c.lotId,quantity:c.quantity,valuation_price:c.valuationPrice,valuation_currency:c.valuationCurrency,fx_rate:c.fxRate,market_value:c.marketValueBase.toString(),eligible_value:calc.lines[i].eligibleValue.toString(),zakat_amount:calc.lines[i].zakatAmount.toString(),eligibility_status:calc.lines[i].status,reason_code:calc.lines[i].status,explanation:`${c.assetName??'Asset'} → Lot ${c.lotId}: ${calc.lines[i].explanation}` }));
  const {error:lineError}=await supabase.from('zakat_assessment_lines').insert(lines);
  if(lineError) throw lineError;
  await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'zakat_assessment',entity_id:assessment.id,action:'CREATE_SNAPSHOT',new_data:assessment});
  return {assessment,lines};
}

export async function confirmAssessment(id:string){
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('zakat_assessments').update({status:'CONFIRMED'}).eq('id',id).eq('user_id',user.id).eq('status','CALCULATED').select().single();
  if(error) throw error;
  await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'zakat_assessment',entity_id:id,action:'CONFIRM',new_data:data});
  return data;
}
