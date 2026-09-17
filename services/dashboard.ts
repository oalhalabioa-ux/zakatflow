import Decimal from 'decimal.js';
import { requireUser } from './auth';

export async function getDashboard(){
 const {supabase,user}=await requireUser();
 const {data:assets,error:ae}=await supabase.from('asset_accounts').select('id,name,asset_type,is_zakatable,currency,status,metadata').eq('user_id',user.id).eq('status','ACTIVE');
 if(ae)throw ae;
 const [assessmentResult,allocationResult,paymentResult]=await Promise.all([
  supabase.from('zakat_assessments').select('id,zakat_due,total_zakatable_value,status,assessment_date,currency,calculation_snapshot').eq('user_id',user.id).neq('status','CANCELLED').order('assessment_date',{ascending:false}).order('created_at',{ascending:false}).limit(10),
  supabase.from('zakat_payment_allocations').select('assessment_id,assessment_line_id,asset_account_id,allocated_amount').eq('user_id',user.id),
  supabase.from('zakat_payments').select('id,payment_date,amount,base_amount,currency,payee,status,assessment_id').eq('user_id',user.id).order('payment_date',{ascending:false}).limit(5)
 ]);
 const assessments=assessmentResult.error?[]:(assessmentResult.data??[]);
 const allocations=allocationResult.error?[]:(allocationResult.data??[]);
 const payments=paymentResult.error?[]:(paymentResult.data??[]);
 const latest=assessments[0];
 const lineResult=latest?.id?await supabase.from('zakat_assessment_lines').select('id,lot_id,market_value,eligible_value,zakat_amount,eligibility_status,lots!inner(asset_account_id,hawl_start_date,hawl_due_date)').eq('assessment_id',latest.id):{data:[],error:null};
 const assessmentLines=(lineResult as any).error?[]:((lineResult as any).data??[]);
 const rows=assets??[],n=(x:any)=>new Decimal(x||0);
 const current=(a:any)=>n(a?.metadata?.market_value??a?.metadata?.estimated_value??a?.metadata?.purchase_value??a?.metadata?.opening_value??0),purchase=(a:any)=>n(a?.metadata?.purchase_value??a?.metadata?.opening_value??0);
 const totalCurrent=rows.reduce((s,a)=>s.add(current(a)),new Decimal(0)),totalPurchase=rows.reduce((s,a)=>s.add(purchase(a)),new Decimal(0));
 const zakatable=rows.filter((a:any)=>a.is_zakatable),rawZakatableValue=zakatable.reduce((s,a)=>s.add(current(a)),new Decimal(0));
 const goldWeightKg=rows.filter((a:any)=>a.asset_type==='GOLD').reduce((s,a)=>s.add(a?.metadata?.weight_kg??n(a?.metadata?.quantity).div(1000)),new Decimal(0));
 const assessedDue=n(latest?.zakat_due||0),assessedBase=n(latest?.total_zakatable_value||0);
 const latestAssessmentId=latest?.id,paidByAsset=new Map<string,Decimal>();let allocatedPaid=new Decimal(0);
 for(const p of allocations){if(!latestAssessmentId||(p as any).assessment_id!==latestAssessmentId)continue;const amount=n((p as any).allocated_amount);allocatedPaid=allocatedPaid.add(amount);const aid=(p as any).asset_account_id;if(aid)paidByAsset.set(aid,(paidByAsset.get(aid)||new Decimal(0)).add(amount))}
 const remaining=Decimal.max(0,assessedDue.sub(allocatedPaid)),paymentPct=assessedDue.gt(0)?Decimal.min(100,allocatedPaid.div(assessedDue).mul(100)):new Decimal(0);
 const eligibleAssets=new Set<string>(),upcomingAssets=new Set<string>();const today=new Date();today.setHours(0,0,0,0);const in30=new Date(today);in30.setDate(in30.getDate()+30);
 for(const l of assessmentLines){const lot:any=Array.isArray((l as any).lots)?(l as any).lots[0]:(l as any).lots;const aid=lot?.asset_account_id;if(!aid)continue;if((l as any).eligibility_status==='ELIGIBLE')eligibleAssets.add(aid);if((l as any).eligibility_status==='HAWL_NOT_COMPLETED'&&lot?.hawl_due_date){const due=new Date(`${lot.hawl_due_date}T00:00:00`);if(due>=today&&due<=in30)upcomingAssets.add(aid)}}
 const hawlCompleted=assessmentLines.length?eligibleAssets.size:0,upcoming30=assessmentLines.length?upcomingAssets.size:0;
 const hawlValue=assessmentLines.reduce((s:any,l:any)=>l.eligibility_status==='ELIGIBLE'?s.add(n(l.eligible_value)):s,new Decimal(0));
 const displayZakatableValue=latest?assessedBase:rawZakatableValue;
 const assetDetails=rows.map((a:any)=>{const cur=current(a),cost=purchase(a),gain=cur.sub(cost),paid=paidByAsset.get(a.id)||new Decimal(0);return{id:a.id,name:a.name,type:a.asset_type,currency:a.currency,currentSar:cur.toFixed(2),purchaseSar:cost.toFixed(2),gainSar:gain.toFixed(2),gainPct:cost.gt(0)?gain.div(cost).mul(100).toFixed(2):'0.00',zakatable:!!a.is_zakatable,purchaseDate:a?.metadata?.purchase_date||'',zakahPaidSar:paid.toFixed(2),weightKg:a?.metadata?.weight_kg??''}});
 return {assetCount:rows.length,totalCurrentSar:totalCurrent.toFixed(2),totalPurchaseSar:totalPurchase.toFixed(2),gainSar:totalCurrent.sub(totalPurchase).toFixed(2),gainPct:totalPurchase.gt(0)?totalCurrent.sub(totalPurchase).div(totalPurchase).mul(100).toFixed(2):'0.00',zakatableValueSar:displayZakatableValue.toFixed(2),rawZakatableAssetsValueSar:rawZakatableValue.toFixed(2),hawlCompleted,hawlValueSar:hawlValue.toFixed(2),upcoming30,goldWeightKg:goldWeightKg.toFixed(3),explicitZakahDueSar:assessedDue.toFixed(2),allocatedZakahPaidSar:allocatedPaid.toFixed(2),remainingZakahSar:remaining.toFixed(2),zakatPaymentPct:paymentPct.toFixed(2),assessedZakatableValueSar:assessedBase.toFixed(2),latestAssessmentDate:latest?.assessment_date??null,latestAssessmentStatus:latest?.status??null,latestAssessments:assessments,recentPayments:payments,assetDetails,dataHealth:{assets:true,assessments:!assessmentResult.error,assessmentLines:!(lineResult as any).error,allocations:!allocationResult.error,payments:!paymentResult.error}};
}
