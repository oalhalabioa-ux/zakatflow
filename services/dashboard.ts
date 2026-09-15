import Decimal from 'decimal.js';
import { requireUser } from './auth';
export async function getDashboard(){
 const {supabase,user}=await requireUser();
 const [{data:assets,error:ae},{data:lots,error:le},{data:assessments,error:xe}]=await Promise.all([
  supabase.from('asset_accounts').select('id,name,asset_type,is_zakatable').eq('user_id',user.id).eq('status','ACTIVE'),
  supabase.from('lots').select('id,remaining_value_base,hawl_due_date,status').eq('user_id',user.id).gt('remaining_quantity',0),
  supabase.from('zakat_assessments').select('zakat_due,status,assessment_date,currency').eq('user_id',user.id).order('assessment_date',{ascending:false}).limit(10)
 ]);
 if(ae)throw ae;if(le)throw le;if(xe)throw xe;
 const totalLots=(lots??[]).reduce((s:any,l:any)=>s.add(l.remaining_value_base||0),new Decimal(0));
 const now=new Date(); const in30=new Date(now.getTime()+30*86400000);
 const upcoming=(lots??[]).filter((l:any)=>new Date(l.hawl_due_date)<=in30 && new Date(l.hawl_due_date)>=now).length;
 const latest=assessments?.[0];
 return {assetCount:assets?.length??0,lotCount:lots?.length??0,totalTrackedValue:totalLots.toString(),latestZakat:latest?.zakat_due??'0',latestCurrency:latest?.currency??'SAR',upcoming30:upcoming,assets:assets??[],latestAssessments:assessments??[]};
}
