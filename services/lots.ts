import {z} from 'zod';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {calculateHawl} from '../engine/hawl';
import {organizationScopeIds} from '../lib/workspace-organization';
import {lotWorkspaceScopeSchema} from '../lib/lot-workspace-scope';

const assetFields='id,user_id,name,asset_type,currency,is_zakatable,organization_id,ownership_scope';
async function all(query:()=>any,key='id'){
 const rows:any[]=[];
 for(let offset=0;offset<50000;offset+=500){let q=query().order(key,{ascending:true,nullsFirst:false});if(key!=='id')q=q.order('id');const r=await q.range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}
 throw Error('LOTS_TOO_LARGE');
}
async function authorizeCompany(supabase:any,userId:string,organizationId:string){
 await requireOrganizationMember(supabase,userId,organizationId);
 const result=await supabase.rpc('has_organization_permission',{p_organization_id:organizationId,p_permission:'assets.view'});
 if(result.error)throw result.error;if(result.data!==true)throw Error('LOT_ACCESS_DENIED');
}
function parentAsset(row:any){const relation=row.asset_accounts;return Array.isArray(relation)?relation[0]:relation;}
function resolveLotOwner(row:any,asset:any,userId:string){
 if(!asset||asset.id!==row.asset_account_id||!['PERSONAL','ORGANIZATION'].includes(asset.ownership_scope))throw Error('LOT_SCOPE_INVALID');
 const organizationId=asset.organization_id??null;
 if(asset.ownership_scope==='PERSONAL'){
  if(organizationId||asset.user_id!==userId||row.user_id!==userId||row.organization_id)throw Error('LOT_ACCESS_DENIED');
 }else if(!organizationId)throw Error('LOT_SCOPE_INVALID');
 if(row.organization_id!=null&&row.organization_id!==organizationId)throw Error('LOT_SCOPE_INVALID');
 // Existing corporate acquisition commands can leave lots.organization_id NULL.
 // The parent asset is the authority in lots_org_read; resolve only the response.
 return {...row,organization_id:organizationId};
}

export async function listLots(input:unknown={scope:'PERSONAL',organization_id:null,group:false}){
 const scope=lotWorkspaceScopeSchema.parse(input),{supabase,user}=await requireUser();
 let organizationIds:string[]=[];
 if(scope.scope==='ORGANIZATION'){
  await authorizeCompany(supabase,user.id,scope.organization_id!);organizationIds=[scope.organization_id!];
  if(scope.group){
   const result=await supabase.from('organizations').select('id,name,parent_organization_id,organization_kind');if(result.error)throw result.error;
   if(!(result.data??[]).some(o=>o.id===scope.organization_id))throw Error('ORGANIZATION_ACCESS_REQUIRED');
   organizationIds=[...organizationScopeIds(result.data??[],scope.organization_id!,true)];
   for(const id of organizationIds)if(id!==scope.organization_id)await authorizeCompany(supabase,user.id,id);
  }
 }
 const assets=await all(()=>{
  let query=supabase.from('asset_accounts').select('id').eq('ownership_scope',scope.scope);
  return scope.scope==='PERSONAL'?query.eq('user_id',user.id).is('organization_id',null):query.in('organization_id',organizationIds);
 });
 const ids=assets.map(asset=>asset.id),rows:any[]=[];
 for(let index=0;index<ids.length;index+=150){
  rows.push(...await all(()=>{
   let query=supabase.from('lots').select(`*,asset_accounts(${assetFields}),transactions!lots_source_transaction_id_fkey(transaction_date)`).in('asset_account_id',ids.slice(index,index+150));
   return scope.scope==='PERSONAL'?query.eq('user_id',user.id):query;
  },'hawl_due_date'));
 }
 const {data:profile,error}=scope.scope==='PERSONAL'?await supabase.from('profiles').select('calendar_type').eq('id',user.id).single():{data:null,error:null};if(error)throw error;
 const calendar=profile?.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR';
 return rows.map(row=>{
  const asset=parentAsset(row),lot=resolveLotOwner(row,asset,user.id);
  if(asset.ownership_scope!==scope.scope||scope.scope==='ORGANIZATION'&&!organizationIds.includes(asset.organization_id))throw Error('LOT_SCOPE_INVALID');
  // Preserve opening lots with no established Hawl date and legacy invalid dates.
  const start=lot.hawl_start_date?new Date(`${lot.hawl_start_date}T00:00:00Z`):null;
  return {...lot,computed_hawl_due_date:scope.scope==='ORGANIZATION'||!start||Number.isNaN(start.getTime())?lot.hawl_due_date??null:calculateHawl(calendar,start,new Date()).dueDate.toISOString().slice(0,10)};
 }).sort((a,b)=>(a.hawl_due_date??'9999').localeCompare(b.hawl_due_date??'9999')||a.id.localeCompare(b.id));
}

export async function getLot(id:string){
 z.string().uuid().parse(id);const {supabase,user}=await requireUser();
 const found=await supabase.from('lots').select('id,user_id,asset_account_id,organization_id').eq('id',id).maybeSingle();if(found.error)throw found.error;if(!found.data)throw Error('LOT_NOT_FOUND');
 const parent=await supabase.from('asset_accounts').select(assetFields).eq('id',found.data.asset_account_id).maybeSingle();if(parent.error)throw parent.error;if(!parent.data)throw Error('LOT_ACCESS_DENIED');
 const owner=resolveLotOwner(found.data,parent.data,user.id);
 if(parent.data.ownership_scope==='ORGANIZATION')await authorizeCompany(supabase,user.id,owner.organization_id);
 const result=await supabase.from('lots').select(`*,asset_accounts(${assetFields}),transactions!lots_source_transaction_id_fkey(id,transaction_type,transaction_date,quantity,gross_value,currency,base_value,base_currency,reference,notes),transaction_allocations(id,transaction_id,quantity,value_base,allocation_method,created_at,transactions(transaction_type,transaction_date))`).eq('id',id).eq('asset_account_id',found.data.asset_account_id).single();
 if(result.error)throw result.error;if(!result.data)throw Error('LOT_NOT_FOUND');
 const data=resolveLotOwner(result.data,parentAsset(result.data),user.id);
 if(data.organization_id!==owner.organization_id)throw Error('LOT_SCOPE_INVALID');
 let query=supabase.from('zakat_assessment_lines').select('*,zakat_assessments!inner(id,user_id,organization_id,assessment_date,valuation_date,status,zakat_due,currency)').eq('lot_id',id);
 query=owner.organization_id?query.eq('zakat_assessments.organization_id',owner.organization_id):query.eq('zakat_assessments.user_id',user.id).is('zakat_assessments.organization_id',null);
 const lines=await query;if(lines.error)throw lines.error;
 return {...data,assessment_lines:lines.data??[]};
}
