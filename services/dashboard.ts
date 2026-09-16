import Decimal from 'decimal.js';
import { requireUser } from './auth';

export async function getDashboard(){
 const {supabase,user}=await requireUser();
 const [{data:assets,error:ae},{data:assessments,error:xe}]=await Promise.all([
  supabase.from('asset_accounts').select('id,name,asset_type,is_zakatable,currency,status,metadata').eq('user_id',user.id).eq('status','ACTIVE'),
  supabase.from('zakat_assessments').select('zakat_due,status,assessment_date,currency').eq('user_id',user.id).order('assessment_date',{ascending:false}).limit(10)
 ]);
 if(ae)throw ae;if(xe)throw xe;
 const rows=assets??[];
 const n=(x:any)=>new Decimal(x||0);
 const current=(a:any)=>n(a?.metadata?.market_value||a?.metadata?.estimated_value||a?.metadata?.purchase_value||a?.metadata?.opening_value||0);
 const purchase=(a:any)=>n(a?.metadata?.purchase_value||a?.metadata?.opening_value||0);
 const totalCurrent=rows.reduce((s,a)=>s.add(current(a)),new Decimal(0));
 const totalPurchase=rows.reduce((s,a)=>s.add(purchase(a)),new Decimal(0));
 const zakatable=rows.filter((a:any)=>a.is_zakatable);
 const zakatableValue=zakatable.reduce((s,a)=>s.add(current(a)),new Decimal(0));
 const now=Date.now();
 const days=(s?:string)=>s?Math.max(0,Math.floor((now-new Date(`${s}T00:00:00`).getTime())/86400000)):0;
 const hawlCompleted=zakatable.filter((a:any)=>days(a?.metadata?.purchase_date)>=354);
 const upcoming30=zakatable.filter((a:any)=>{const d=days(a?.metadata?.purchase_date);return d>=324&&d<354}).length;
 const hawlValue=hawlCompleted.reduce((s,a)=>s.add(current(a)),new Decimal(0));
 const goldWeightKg=rows.filter((a:any)=>a.asset_type==='GOLD').reduce((s,a)=>s.add(a?.metadata?.weight_kg??n(a?.metadata?.quantity).div(1000)),new Decimal(0));
 const explicitDue=rows.reduce((s,a)=>s.add(a?.metadata?.zakah_due_sar||0),new Decimal(0));
 const assetDetails=rows.map((a:any)=>{const cur=current(a),cost=purchase(a),gain=cur.sub(cost),age=days(a?.metadata?.purchase_date);return{id:a.id,name:a.name,type:a.asset_type,currency:a.currency,currentSar:cur.toFixed(2),purchaseSar:cost.toFixed(2),gainSar:gain.toFixed(2),gainPct:cost.gt(0)?gain.div(cost).mul(100).toFixed(2):'0.00',zakatable:!!a.is_zakatable,purchaseDate:a?.metadata?.purchase_date||'',hawlDays:age,hawlCompleted:age>=354,zakahDueSar:n(a?.metadata?.zakah_due_sar).toFixed(2),zakahPaidSar:n(a?.metadata?.zakah_paid_sar).toFixed(2),weightKg:a?.metadata?.weight_kg??''}});
 const latest=assessments?.[0];
 return {assetCount:rows.length,totalCurrentSar:totalCurrent.toFixed(2),totalPurchaseSar:totalPurchase.toFixed(2),gainSar:totalCurrent.sub(totalPurchase).toFixed(2),gainPct:totalPurchase.gt(0)?totalCurrent.sub(totalPurchase).div(totalPurchase).mul(100).toFixed(2):'0.00',zakatableValueSar:zakatableValue.toFixed(2),hawlCompleted:hawlCompleted.length,hawlValueSar:hawlValue.toFixed(2),upcoming30,goldWeightKg:goldWeightKg.toFixed(3),explicitZakahDueSar:explicitDue.toFixed(2),latestZakat:latest?.zakat_due??'0',latestCurrency:latest?.currency??'SAR',latestAssessments:assessments??[],assetDetails};
}
