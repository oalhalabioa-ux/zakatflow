import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
import {calculateAndSaveAssessment} from '@/services/assessments';
export async function POST(req:Request){try{
 const{id,new_date}=await req.json();if(!id||!new_date)throw new Error('ASSESSMENT_AND_DATE_REQUIRED');
 const{supabase,user}=await requireUser();
 const{data:old,error}=await supabase.from('zakat_assessments').select('*').eq('id',id).eq('user_id',user.id).single();if(error)throw error;
 const{data:cycle,error:ce}=await supabase.from('zakat_hawl_cycles').select('status,assessment_id').eq('id',old.hawl_cycle_id).eq('user_id',user.id).single();if(ce)throw ce;
 if(!['OPEN','ACTIVE'].includes(cycle.status))throw new Error('CLOSED_CYCLE_ASSESSMENT_LOCKED');
 if(cycle.assessment_id!==id||old.superseded_by)throw new Error('ASSESSMENT_SUPERSEDED');
 const s=old.calculation_snapshot??{};
 const result=await calculateAndSaveAssessment({assessment_date:new_date,valuation_date:new_date,nisab_standard:old.nisab_standard,method_id:old.method_id,price_mode:s.priceMode||'MANUAL',price_source:s.priceMode==='REFERENCE'?s.priceSource:undefined,gold_price:s.priceMode==='REFERENCE'?undefined:Number(s.prices?.gold||0),silver_price:s.priceMode==='REFERENCE'?undefined:Number(s.prices?.silver||0),price_currency:s.priceCurrency??old.currency,fx_rate:Number(s.fxRate||1)},id);
 return NextResponse.json({...result,replaced_assessment_id:id});
}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
