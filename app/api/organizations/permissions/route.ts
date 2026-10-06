import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

const status=(m:string)=>m==='UNAUTHORIZED'?401:m.includes('OWNER_REQUIRED')?403:400;
export async function GET(request:Request){
 try{
  const organizationId=new URL(request.url).searchParams.get('organization_id');
  if(!organizationId)return NextResponse.json({error:'ORGANIZATION_REQUIRED'},{status:400});
  const {supabase}=await requireUser();
  const [{data:organization,error:oe},{data:roles,error:re},{data:overrides,error:pe}]=await Promise.all([
   supabase.from('organizations').select('id,approval_policy').eq('id',organizationId).single(),
   supabase.from('organization_roles').select('id,name,description,permissions,role_key,is_system_template,is_editable,amount_limits').eq('organization_id',organizationId).order('is_system_template',{ascending:false}).order('name'),
   supabase.from('organization_member_permission_overrides').select('user_id,permission,effect,amount_limit,currency').eq('organization_id',organizationId)
  ]);
  if(oe)throw oe;if(re)throw re;if(pe)throw pe;
  return NextResponse.json({approval_policy:organization?.approval_policy??'OWNER_CONTROLLED',roles:roles??[],overrides:overrides??[]});
 }catch(e){const m=e instanceof Error?e.message:'REQUEST_FAILED';return NextResponse.json({error:m},{status:status(m)});}
}
export async function POST(request:Request){
 try{const b=await request.json();const {supabase}=await requireUser();const {error}=await supabase.rpc('seed_default_organization_roles',{p_org:String(b.organization_id??'')});if(error)throw error;return NextResponse.json({ok:true});}
 catch(e){const m=e instanceof Error?e.message:'REQUEST_FAILED';return NextResponse.json({error:m},{status:status(m)});}
}
export async function PATCH(request:Request){
 try{
  const b=await request.json();const org=String(b.organization_id??'');const {supabase}=await requireUser();
  if(b.action==='policy'){const {error}=await supabase.rpc('owner_set_organization_approval_policy',{p_org:org,p_policy:String(b.policy??'')});if(error)throw error;}
  else if(b.action==='role'){const {error}=await supabase.rpc('owner_update_organization_role',{p_org:org,p_role_id:String(b.role_id??''),p_permissions:Array.isArray(b.permissions)?b.permissions:[],p_amount_limits:b.amount_limits??{}});if(error)throw error;}
  else if(b.action==='override'){const {error}=await supabase.rpc('owner_set_member_permission_override',{p_org:org,p_user:String(b.user_id??''),p_permission:String(b.permission??''),p_effect:b.effect??null,p_amount_limit:b.amount_limit??null,p_currency:b.currency??null});if(error)throw error;}
  else return NextResponse.json({error:'ACTION_INVALID'},{status:400});
  return NextResponse.json({ok:true});
 }catch(e){const m=e instanceof Error?e.message:'REQUEST_FAILED';return NextResponse.json({error:m},{status:status(m)});}
}