import { requireUser } from './auth';
import { assetSchema } from '@/lib/validation/schemas';

export async function listAssets(){
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('asset_accounts').select('*').eq('user_id',user.id).order('created_at',{ascending:false});
  if(error) throw error;
  const assets=data??[];
  const {data:latest}=await supabase.from('zakat_assessments').select('id,assessment_date,valuation_date,status,nisab_value_base,zakat_rate,calculation_snapshot').eq('user_id',user.id).neq('status','CANCELLED').order('assessment_date',{ascending:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(!latest) return assets.map((a:any)=>({...a,zakat_calculation:null}));
  const {data:lines,error:lineError}=await supabase.from('zakat_assessment_lines').select('lot_id,market_value,eligible_value,zakat_amount,eligibility_status,valuation_price,valuation_currency,explanation,lots!inner(asset_account_id,hawl_start_date,hawl_due_date)').eq('assessment_id',latest.id);
  if(lineError) throw lineError;
  const byAsset=new Map<string,any>();
  for(const line of lines??[]){
    const lot:any=Array.isArray((line as any).lots)?(line as any).lots[0]:(line as any).lots;
    if(!lot?.asset_account_id) continue;
    const x=byAsset.get(lot.asset_account_id)??{zakat_amount:0,market_value:0,eligible_value:0,statuses:[],lots:[],assessment_id:latest.id,assessment_date:latest.assessment_date,valuation_date:latest.valuation_date,assessment_status:latest.status,nisab_value_base:Number(latest.nisab_value_base||0),zakat_rate:Number(latest.zakat_rate||0),snapshot:latest.calculation_snapshot};
    x.zakat_amount+=Number((line as any).zakat_amount||0);x.market_value+=Number((line as any).market_value||0);x.eligible_value+=Number((line as any).eligible_value||0);x.statuses.push((line as any).eligibility_status);x.lots.push({lot_id:(line as any).lot_id,hawl_start_date:lot.hawl_start_date,hawl_due_date:lot.hawl_due_date,status:(line as any).eligibility_status,zakat_amount:Number((line as any).zakat_amount||0),valuation_price:(line as any).valuation_price,valuation_currency:(line as any).valuation_currency,explanation:(line as any).explanation});byAsset.set(lot.asset_account_id,x);
  }
  return assets.map((a:any)=>({...a,zakat_calculation:a.is_zakatable?(byAsset.get(a.id)??{assessment_id:latest.id,assessment_date:latest.assessment_date,valuation_date:latest.valuation_date,assessment_status:latest.status,nisab_value_base:Number(latest.nisab_value_base||0),zakat_rate:Number(latest.zakat_rate||0),zakat_amount:0,market_value:0,eligible_value:0,statuses:['NOT_ASSESSED'],lots:[],snapshot:latest.calculation_snapshot}):{assessment_id:latest.id,assessment_date:latest.assessment_date,statuses:['EXEMPT'],zakat_amount:0,lots:[]}}));
}

export async function createAsset(input:unknown){
  const parsed=assetSchema.parse(input);
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('asset_accounts').insert({...parsed,user_id:user.id}).select().single();
  if(error) throw error;
  return data;
}

export async function updateAsset(id:string,input:unknown){
  const parsed=assetSchema.parse(input);
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('asset_accounts').update(parsed).eq('id',id).eq('user_id',user.id).select().single();
  if(error) throw error;
  return data;
}
