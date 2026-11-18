import {createHash} from 'node:crypto';
import {readFeasibilityGrant} from '../../../../lib/feasibility/grant';
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
const copyRequest=z.object({
 sourceId:uuid,revision:z.number().int().positive(),confirmed:z.literal(true)
}).strict();
const copyNamespace=Buffer.from('d517a4618fb3475db10e1bf2e1b5fb01','hex');

function copyId(sourceId:string,organizationId:string){
 const hash=createHash('sha1').update(copyNamespace).update(sourceId+':'+organizationId).digest();
 hash[6]=(hash[6]&15)|80;
 hash[8]=(hash[8]&63)|128;
 const id=hash.subarray(0,16).toString('hex');
 return [id.slice(0,8),id.slice(8,12),id.slice(12,16),id.slice(16,20),id.slice(20)].join('-');
}
const isCopyRequest=(request:Request)=>new URL(request.url).searchParams.get('action')==='copy';

async function authorize(request:Request){
 if(!enabled())return json({error:'ORGANIZATION_FEASIBILITY_DISABLED'},404);
 const organizationId=new URL(request.url).searchParams.get('organization')?.toLowerCase();
 if(!uuid.safeParse(organizationId).success)return json({error:'INVALID_ORGANIZATION'},400);
 const supabase=await supabaseServer();
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user)return json({error:'UNAUTHORIZED'},401);
 if(process.env.FEASIBILITY_ORG_SHARING==='true'){
  const {data,error}=await supabase.rpc('feasibility_company_workspace',{p_organization:organizationId});
  if(error)return json({error:'ENTITLEMENT_UNAVAILABLE'},503);
  if(!data?.canRead)return json({error:'ORGANIZATION_NOT_AVAILABLE'},404);
  return {supabase,organizationId:organizationId!,userId:user.id,canWrite:data.canWrite===true,canShare:data.canShare===true,organizationName:undefined};
 }
 // RLS enforces tenant membership again at query time; never trust the topbar UUID.
 const [membership,org]=await Promise.all([
  supabase.from('organization_members').select('role,status')
   .eq('organization_id',organizationId!).eq('user_id',user.id).maybeSingle(),
  supabase.from('organizations').select('id,status,name')
   .eq('id',organizationId!).maybeSingle()
 ]);
 if(membership.error||org.error)return json({error:'ORGANIZATION_UNAVAILABLE'},503);
 if(!membership.data||membership.data.status!=='ACTIVE'||!org.data||
  org.data.status!=='ACTIVE')return json({error:'ORGANIZATION_NOT_AVAILABLE'},404);
 const {data,error}=await supabase.rpc('feasibility_company_workspace',{p_organization:organizationId!});
 const companyRead=!error&&data?.canRead===true;
 if(!companyRead){
  // Preserve legacy portfolio reads while the company authorization RPC rolls out.
  const {data:grant,error:grantError}=await readFeasibilityGrant(supabase,user.id);
  if(grantError)return json({error:'ENTITLEMENT_UNAVAILABLE'},503);
  if(!evaluateFeasibilityAccess(grant).canRead)return json({error:'FEASIBILITY_ACCESS_REQUIRED'},403);
 }
 const canWrite=companyRead&&data.canWrite===true&&['OWNER','ADMIN'].includes(membership.data.role);
 return {supabase,organizationId:organizationId!,userId:user.id,canWrite,canShare:false,organizationName:org.data.name};
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
 if(isCopyRequest(request)){
  if(!ctx.canWrite)return json({error:'ORGANIZATION_WRITE_DENIED'},403);
  if(ctx.organizationName!==undefined)
   return json({organizationId:ctx.organizationId,organizationName:ctx.organizationName});
  const {data,error}=await ctx.supabase.from('organizations').select('name')
   .eq('id',ctx.organizationId).eq('status','ACTIVE').maybeSingle();
  if(error)return json({error:'ORGANIZATION_UNAVAILABLE'},503);
  if(!data)return json({error:'ORGANIZATION_NOT_AVAILABLE'},404);
  return json({organizationId:ctx.organizationId,organizationName:data.name});
 }
 const {data,error}=await ctx.supabase.from('feasibility_projects')
  .select('id,title,revision,updated_at,study,owner_user_id,created_by_user_id,organization_id')
  .eq('organization_id',ctx.organizationId)
  .order('updated_at',{ascending:false}).limit(300);
 if(error)return json({error:'ORGANIZATION_DRAFT_READ_FAILED'},500);
 return json({studies:data??[],canWrite:ctx.canWrite,...(ctx.canShare?{canShare:true}:{})});
}
export async function POST(request:Request){
 if(!enabled())return json({error:'ORGANIZATION_FEASIBILITY_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const ctx=await authorize(request);
 if(ctx instanceof NextResponse)return ctx;
 if(!ctx.canWrite)return json({error:'ORGANIZATION_WRITE_DENIED'},403);
 if(isCopyRequest(request))return copyPersonalStudy(request,ctx);
 const parsed=await parseInput(request);
 if(!parsed||parsed.revision!==undefined)return json({error:'INVALID_STUDY'},400);
 return insertOrganizationStudy(ctx,parsed.study);
}
type OrganizationContext=Exclude<Awaited<ReturnType<typeof authorize>>,NextResponse>;
type CloudStudy=z.infer<typeof cloudDraftWrite>['study'];

async function insertOrganizationStudy(ctx:OrganizationContext,study:CloudStudy){
 const {data,error}=await ctx.supabase.from('feasibility_projects').insert({
  id:study.id,organization_id:ctx.organizationId,
  owner_user_id:null,created_by_user_id:ctx.userId,
  title:study.title,study
 }).select('id,revision,updated_at').single();
 if(error)return json({error:error.code==='23505'?'DRAFT_CONFLICT':'DRAFT_SAVE_FAILED'},error.code==='23505'?409:400);
 return json(data,201);
}

async function copyPersonalStudy(request:Request,ctx:OrganizationContext){
 const raw=await request.text();
 if(raw.length>400)return json({error:'INVALID_COPY_REQUEST'},400);
 let input:unknown;
 try{input=JSON.parse(raw)}catch{return json({error:'INVALID_COPY_REQUEST'},400)}
 const checked=copyRequest.safeParse(input);
 if(!checked.success)return json({error:'INVALID_COPY_REQUEST'},400);
 const {revision}=checked.data;
 const sourceId=checked.data.sourceId.toLowerCase();
 const {data,error}=await ctx.supabase.from('feasibility_projects')
  .select('study,revision').eq('id',sourceId).eq('owner_user_id',ctx.userId)
  .is('organization_id',null).maybeSingle();
 if(error)return json({error:'DRAFT_READ_FAILED'},500);
 if(!data)return json({error:'PERSONAL_DRAFT_NOT_FOUND'},404);
 if(data.revision!==revision)return json({error:'SOURCE_REVISION_CONFLICT'},409);
 const source=cloudDraftWrite.safeParse({study:data.study});
 if(!source.success||source.data.study.id.toLowerCase()!==sourceId)return json({error:'INVALID_SOURCE_STUDY'},422);

 const {handoff,...study}=source.data.study;
 const now=new Date().toISOString();
 return insertOrganizationStudy(ctx,{
  ...study,id:copyId(sourceId,ctx.organizationId),status:'FEASIBILITY',createdAt:now,updatedAt:now
 });
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
