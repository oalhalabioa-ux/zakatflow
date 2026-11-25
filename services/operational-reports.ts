import {z} from 'zod';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {listAssets} from './assets';
import {corporateStatus} from '../lib/corporate-zakat-assessment';
import {corporateZakatFlows} from '../lib/corporate-zakat-flows';
import {isLiquidityFlowSettled} from '../lib/liquidity-forecast';
import {calculateManualZakat,manualZakatInputSchema} from '../lib/manual-zakat-assessment';
import {organizationScopeIds} from '../lib/workspace-organization';
import {operationalReportScopeSchema,operationalReportTypes,type OperationalReportScope,type OperationalReportType} from '../lib/operational-report-scope';

async function all(query:()=>any,key='id',ascending=true):Promise<any[]>{
 const rows:any[]=[];
 for(let offset=0;offset<50000;offset+=500){let q=query().order(key,{ascending});if(key!=='id'&&key!=='assessment_id')q=q.order('id');const r=await q.range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}
 throw Error('REPORT_TOO_LARGE');
}
async function batches(ids:string[],query:(ids:string[])=>any,key='id',ascending=true){
 const rows:any[]=[];for(let i=0;i<ids.length;i+=150)rows.push(...await all(()=>query(ids.slice(i,i+150)),key,ascending));return rows;
}
export async function readOperationalReports(types:OperationalReportType[],input:unknown){
 for(const type of types)z.enum(operationalReportTypes).parse(type);
 const scope=operationalReportScopeSchema.parse(input),{supabase,user}=await requireUser();
 let organizationIds:string[]=[],organizations:any[]=[],owner='';
 if(scope.scope==='ORGANIZATION'){
  await requireOrganizationMember(supabase,user.id,scope.organization_id!);
  let query=supabase.from('organizations').select('id,name,parent_organization_id,organization_kind');
  if(!scope.group)query=query.eq('id',scope.organization_id!);
  const r=await query;if(r.error)throw r.error;
  organizationIds=[...organizationScopeIds(r.data??[],scope.organization_id!,scope.group)];
  organizations=(r.data??[]).filter(o=>organizationIds.includes(o.id));
  if(!organizations.some(o=>o.id===scope.organization_id))throw Error('ORGANIZATION_ACCESS_REQUIRED');
  owner=organizations.find(o=>o.id===scope.organization_id)?.name??'';
  const permissions=new Set<string>();
  if(types.some(type=>['assets','transactions','lots'].includes(type)))permissions.add('assets.view');
  if(types.some(type=>['assessments','payments'].includes(type)))permissions.add('zakat.view');
  if(types.includes('payments'))permissions.add('liquidity.view');
  for(const id of organizationIds){
   if(id!==scope.organization_id)await requireOrganizationMember(supabase,user.id,id);
   for(const permission of permissions){const r=await supabase.rpc('has_organization_permission',{p_organization_id:id,p_permission:permission});if(r.error)throw r.error;if(r.data!==true)throw Error('REPORT_ACCESS_DENIED');}
  }
  if(scope.entity_id){const r=await supabase.from('organization_entities').select('id').eq('id',scope.entity_id).in('organization_id',organizationIds).maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error('REPORT_ENTITY_SCOPE_INVALID');}
 }else{
  const r=await supabase.from('profiles').select('name').eq('id',user.id).single();if(r.error)throw r.error;owner=r.data?.name||user.email||'';
 }
 const orgName=new Map(organizations.map(o=>[o.id,o.name]));
 const scoped=(query:any)=>scope.scope==='PERSONAL'?query.eq('user_id',user.id).is('organization_id',null):query.in('organization_id',organizationIds);
 const rows:Partial<Record<OperationalReportType,any[]>>={};
 if(types.some(type=>['transactions','lots'].includes(type))){
  const assetRows=await all(()=>{let q=supabase.from('asset_accounts').select('id').eq('ownership_scope',scope.scope);q=scoped(q);return scope.entity_id?q.eq('entity_id',scope.entity_id):q;});
  const ids=assetRows.map(a=>a.id);
  if(types.includes('transactions'))rows.transactions=await batches(ids,ids=>{
   let q=scoped(supabase.from('transactions').select('id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,reference,notes,asset_account_id').in('asset_account_id',ids));
   return scope.entity_id?q.eq('entity_id',scope.entity_id):q;
  },'transaction_date');
  if(types.includes('lots'))rows.lots=await batches(ids,ids=>{
   let q=supabase.from('lots').select('id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status').in('asset_account_id',ids);
   return scope.scope==='PERSONAL'?q.eq('user_id',user.id):q;
  },'hawl_due_date');
 }
 if(types.includes('assets')){
  const assets=(await listAssets()).filter((r:any)=>(scope.scope==='PERSONAL'?r.ownership_scope!=='ORGANIZATION'&&!r.organization_id:organizationIds.includes(r.organization_id))&&(!scope.entity_id||r.entity_id===scope.entity_id));
  rows.assets=assets.map((r:any)=>({asset_type:r.asset_type,name:r.name,organization_id:r.organization_id||'',entity_id:r.entity_id||'',source:r.metadata?.register_source||'ASSETS',purchase_date:r.metadata?.purchase_date||'',currency:r.current_value_currency||r.currency,purchase_cost:r.current_cost_value,current_value:r.current_market_value,profit_margin:Number(r.current_market_value||0)-Number(r.current_cost_value||0),zakat_due:r.zakat_calculation?.zakat_amount??'',zakat_paid:r.zakat_calculation?.paid_amount??'',zakatable:r.is_zakatable?'YES':'NO',status:r.lifecycle_status}));
 }
 if(scope.scope==='PERSONAL'){
  if(types.includes('assessments'))rows.assessments=await all(()=>supabase.from('zakat_assessments').select('id,assessment_date,valuation_date,total_zakatable_value,zakat_rate,zakat_due,currency,status,method_version').eq('user_id',user.id).is('organization_id',null),'assessment_date',false);
  if(types.includes('payments')){
   // Legacy payments have no organization column; ownership follows their
   // assessment, which may belong to an institution owned by this same user.
   const assessments=rows.assessments??await all(()=>supabase.from('zakat_assessments').select('id').eq('user_id',user.id).is('organization_id',null));
   rows.payments=await batches(assessments.map(a=>a.id),ids=>supabase.from('zakat_payments').select('id,assessment_id,payment_date,amount,currency,base_amount,beneficiary,reference,notes').eq('user_id',user.id).in('assessment_id',ids),'payment_date',false);
  }
 }else if(types.some(type=>['assessments','payments'].includes(type))){
  const assessments=await all(()=>supabase.from('manual_zakat_assessments').select('id,organization_id,title,assessment_date,currency,status,model,input').in('organization_id',organizationIds),'assessment_date',false);
  const workflows=await batches(assessments.map(a=>a.id),ids=>supabase.from('corporate_zakat_workflow').select('*').in('organization_id',organizationIds).in('assessment_id',ids),'assessment_id');
  const byAssessment=new Map(workflows.map(w=>[w.assessment_id,w]));
  if(types.includes('assessments'))rows.assessments=assessments.map(a=>{
   const w=byAssessment.get(a.id),input=manualZakatInputSchema.parse(a.input);
   if(input.organization_id!==a.organization_id||input.model==='PERSONAL'||w&&w.organization_id!==a.organization_id)throw Error('REPORT_SCOPE_INVALID');
   const result=calculateManualZakat(input);
   return {id:a.id,organization_id:a.organization_id,organization_name:orgName.get(a.organization_id),title:a.title,assessment_date:a.assessment_date,valuation_date:a.assessment_date,total_zakatable_value:w?.final_base??result.base,zakat_rate:w?.final_rate??result.rate,zakat_due:w?.amount??result.zakat_due,currency:a.currency,status:w?corporateStatus(w):a.status,basis:w?'REVIEWED_CORPORATE_WORKFLOW':'MANUAL_DRAFT',paid_amount:w?.paid??0,remaining_amount:w?.remaining??null};
  });
  if(types.includes('payments')){
   const [flows,categories]=await Promise.all([
    all(()=>supabase.from('liquidity_flows').select('id,organization_id,entity_id,category_id,direction,transfer_id,intercompany_transfer_id,title,counterparty,due_date,amount,currency,status,settlement_status,settled_amount,reference').in('organization_id',organizationIds),'due_date'),
    all(()=>supabase.from('liquidity_flow_categories').select('id,organization_id,accounting_group,treatment_code').in('organization_id',organizationIds)),
   ]);
   const linkedFlowIds=new Set(workflows.map(w=>w.flow_id).filter(Boolean));
   const liabilities=assessments.flatMap(a=>{
    const w=byAssessment.get(a.id);if(!w)return [];if(w.organization_id!==a.organization_id)throw Error('REPORT_SCOPE_INVALID');
    return [{id:a.id,organization_id:a.organization_id,organization_name:orgName.get(a.organization_id),source:'CORPORATE_ZAKAT_ASSESSMENT',assessment_id:a.id,title:a.title,due_date:w.period_end,currency:a.currency,amount:w.amount,paid_amount:w.paid,remaining_amount:w.remaining,status:corporateStatus(w),reference:w.review_reference}];
   });
   const directFlows=corporateZakatFlows(flows,categories,organizationIds).filter(f=>!linkedFlowIds.has(f.id)).map(f=>{
    const paid=isLiquidityFlowSettled(f)?Number(f.amount):Number(f.settled_amount??0);
    return {id:f.id,organization_id:f.organization_id,organization_name:orgName.get(f.organization_id),source:'LIQUIDITY_FLOW',assessment_id:'',title:f.title,due_date:f.due_date,currency:f.currency,amount:f.amount,paid_amount:paid,remaining_amount:Math.max(0,Number(f.amount)-paid),status:f.status,settlement_status:f.settlement_status??'',reference:f.reference??''};
   });
   rows.payments=[...liabilities,...directFlows];
  }
 }
 // Corporate Zakat is assessed at company level, not allocated to a selected
 // asset entity. Keep its actual source scope explicit in print/export metadata.
 return {scope,owner,organizations,organizationIds,rows,zakatCompanyWide:scope.scope==='ORGANIZATION'};
}
export async function readOperationalReport(type:OperationalReportType,input:OperationalReportScope){return (await readOperationalReports([type],input)).rows[type]??[];}
