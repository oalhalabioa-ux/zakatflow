import {invalidateZakatViews} from '@/lib/zakat-view-refresh';
import {NextResponse} from 'next/server';import {requireUser} from '@/services/auth';import {calculateAndSaveAssessment} from '@/services/assessments';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;const{supabase,user}=await requireUser();const{data,error}=await supabase.from('zakat_assessments').select('*,zakat_methods(code,name_ar,name_en),zakat_assessment_lines(*)').eq('id',id).eq('user_id',user.id).single();if(error)throw error;return NextResponse.json(data)}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:404})}}
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){try{
 const{id}=await params;const{supabase,user}=await requireUser();const body=await req.json();
 const{data:old,error}=await supabase.from('zakat_assessments').select('*').eq('id',id).eq('user_id',user.id).single();if(error||!old)throw new Error('ASSESSMENT_NOT_FOUND');
 const{data:cycle,error:ce}=old.hawl_cycle_id?await supabase.from('zakat_hawl_cycles').select('id,status,assessment_id,final_assessment_id,final_zakat_due').eq('id',old.hawl_cycle_id).eq('user_id',user.id).single():{data:null,error:null};
 if(ce)throw ce;
 if(!cycle||!['OPEN','ACTIVE'].includes(cycle.status)||cycle.final_assessment_id||cycle.final_zakat_due!=null||old.status==='CANCELLED')return NextResponse.json({error:'CLOSED_CYCLE_ASSESSMENT_LOCKED'},{status:409});
 if(cycle.assessment_id!==id||old.superseded_by)return NextResponse.json({error:'ASSESSMENT_SUPERSEDED'},{status:409});
 const s=old.calculation_snapshot??{};
 const result=await calculateAndSaveAssessment({assessment_date:body.assessment_date??old.assessment_date,
  valuation_date:body.valuation_date??old.valuation_date,method_id:body.method_id??old.method_id,
  nisab_standard:body.nisab_standard??old.nisab_standard,price_mode:body.price_mode??'MANUAL',
  gold_price:body.gold_price??s.prices?.gold,silver_price:body.silver_price??s.prices?.silver,
  price_currency:body.price_currency??s.priceCurrency??old.currency,fx_rate:body.fx_rate??s.fxRate??1,
  price_source:body.price_source},id);
 return NextResponse.json({...result,ok:true,replaced_assessment_id:id});
 }catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params;const {supabase}=await requireUser();
  const {data,error}=await supabase.rpc('cancel_open_zakat_assessment',{p_assessment_id:id});
  if(error)throw error;invalidateZakatViews();return NextResponse.json(data);
 }catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:e.message==='ASSESSMENT_NOT_FOUND'?404:e.message==='ASSESSMENT_PROTECTED'?409:400})}
}
