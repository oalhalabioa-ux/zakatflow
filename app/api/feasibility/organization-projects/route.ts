import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {cloudDraftWrite} from '../../../../lib/feasibility/draft-schema';
import {evaluateFeasibilityAccess} from '../../../../lib/feasibility/access';

export const dynamic='force-dynamic';
/** Explicitly disabled until QA-V2 migration + RLS and role tests are signed off. */
const enabled=()=>process.env.FEASIBILITY_ORG_QA==='true' &&
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true' &&
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=z.string().uuid();

async function authorize(request:Request){
 if(!enabled())return json({error:'ORGANIZATION_FEASIBILITY_DISABLED'},404);
 const organizationId=new URL(request.url).searchParams.get('organization');
 if(!uuid.safeParse(organizationId).success)return json({error:'INVALID_ORGANIZATION'},400);
 const supabase=await supabaseServer();
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user)return json({error:'UNAUTHORIZED'},401);
 const {data:grant,error:grantError}=await supabase.from('feasibility_access_grants')
  .select('status,starts_at,ends_at').eq('user_id',user.id).maybeSingle();
 if(grantError)return json({error:'ENTITLEMENT_UNAVAILABLE'},503);
 const access=evaluateFeasibilityAccess(grant);
 if(!access.canRead)return json({error:'FEASIBILITY_ACCESS_REQUIRED'},403);
 // RLS enforces tenant membership again at query time; never trust the topbar UUID.
 const [membership,org]=await Promise.all([
  supabase.from('organization_members').select('role,status')
   .eq('organization_id',organizationId!).eq('user_id',user.id).maybeSingle(),
  supabase.from('organizations').select('id,status')
   .eq('id',organizationId!).maybeSingle()
 ]);
 if(membership.error||org.error)return json({error:'ORGANIZATION_UNAVAILABLE'},503);
 if(!membership.data||membership.data.status!=='ACTIVE'||!org.data||
  org.data.status!=='ACTIVE')return json({error:'ORGANIZATION_NOT_AVAILABLE'},404);
 const canWrite=access.canWrite&&['OWNER','ADMIN'].includes(membership.data.role);
 return {supabase,organizationId:organizationId!,userId:user.id,canWrite};
}
async function parseInput(request:Request){
 const raw=await request.text();
 if(raw.length>950000)return null;
 try{const checked=cloudDraftWrite.safeParse(JSON.parse(raw));
  return checked.success?checked.data:null;
 }catch{return null}
}
export async function GET(request:Request){
 const ctx=await authorize(request);
 if(ctx instanceof NextResponse)return ctx;
 const {data,error}=await ctx.supabase.from('feasibility_projects')
  .select('id,title,revision,updated_at,study,owner_user_id,organization_id')
  .eq('organization_id',ctx.organizationId)
  .order('updated_at',{ascending:false}).limit(300);
 if(error)return json({error:'ORGANIZATION_DRAFT_READ_FAILED'},500);
 return json(data??[]);
}
export async function POST(request:Request){
 if(!enabled())return json({error:'ORGANIZATION_FEASIBILITY_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const ctx=await authorize(request);
 if(ctx instanceof NextResponse)return ctx;
 if(!ctx.canWrite)return json({error:'ORGANIZATION_WRITE_DENIED'},403);
 const parsed=await parseInput(request);
 if(!parsed||parsed.revision!==undefined)return json({error:'INVALID_STUDY'},400);
 const {study}=parsed;
 const {data,error}=await ctx.supabase.from('feasibility_projects').insert({
  id:study.id,organization_id:ctx.organizationId,
  owner_user_id:null,created_by_user_id:ctx.userId,
  title:study.title,study
 }).select('id,revision,updated_at').single();
 if(error)return json({error:error.code==='23505'?'DRAFT_CONFLICT':'DRAFT_SAVE_FAILED'},error.code==='23505'?409:400);
 return json(data,201);
}
export async function PATCH(request:Request){
 if(!enabled())return json({error:'ORGANIZATION_FEASIBILITY_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const ctx=await authorize(request);
 if(ctx instanceof NextResponse)return ctx;
 if(!ctx.canWrite)return json({error:'ORGANIZATION_WRITE_DENIED'},403);
 const parsed=await parseInput(request);
 if(!parsed||parsed.revision===undefined)return json({error:'INVALID_STUDY'},400);
 const {study,revision}=parsed;
 const {data,error}=await ctx.supabase.from('feasibility_projects').update({
  title:study.title,study,revision:revision+1,updated_at:new Date().toISOString()
 }).eq('id',study.id).eq('organization_id',ctx.organizationId)
  .eq('revision',revision).select('id,revision,updated_at').maybeSingle();
 if(error)return json({error:'DRAFT_SAVE_FAILED'},500);
 if(!data)return json({error:'DRAFT_CONFLICT'},409);
 return json(data);
}
