import {NextResponse} from 'next/server';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {evaluateFeasibilityAccess} from '../../../../lib/feasibility/access';
export const dynamic='force-dynamic';
const enabled=()=>process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA==='true';
const json=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
const schema=z.object({projectId:z.string().uuid(),email:z.string().trim().email().max(254),role:z.enum(['VIEWER','REVIEWER'])}).strict();
async function context(){
 const supabase=await supabaseServer();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return {supabase,user:null,access:null,accessError:null};
 const {data:grant,error:accessError}=await supabase.from('feasibility_access_grants').select('status,starts_at,ends_at').eq('user_id',user.id).maybeSingle();
 return {supabase,user,access:evaluateFeasibilityAccess(grant),accessError};
}
export async function GET(request:Request){
 if(!enabled())return json({error:'SHARING_DISABLED'},404);
 const id=new URL(request.url).searchParams.get('project_id');
 if(!z.string().uuid().safeParse(id).success)return json({error:'INVALID_PROJECT'},400);
 const {supabase,user,access,accessError}=await context();
 if(!user)return json({error:'UNAUTHORIZED'},401);
 if(accessError)return json({error:'ENTITLEMENT_LOOKUP_FAILED'},503);
 if(!access?.canRead)return json({error:'FEASIBILITY_ACCESS_REQUIRED'},403);
 const [invitations,members]=await Promise.all([
  supabase.from('feasibility_project_invitations')
   .select('id,invitee_email,role,expires_at,accepted_at,revoked_at,created_at')
   .eq('project_id',id!).eq('created_by',user.id).order('created_at',{ascending:false}).limit(40),
  supabase.from('feasibility_project_members')
   .select('user_id,role,status,created_at').eq('project_id',id!).limit(40)
 ]);
 if(invitations.error||members.error)return json({error:'SHARING_READ_FAILED'},500);
 return json({invitations:invitations.data??[],members:members.data??[]});
}
export async function POST(request:Request){
 if(!enabled())return json({error:'SHARING_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const {supabase,user,access,accessError}=await context();
 if(!user)return json({error:'UNAUTHORIZED'},401);
 if(accessError)return json({error:'ENTITLEMENT_LOOKUP_FAILED'},503);
 if(!access?.canWrite)return json({error:'FEASIBILITY_READ_ONLY'},403);
 let raw:unknown;try{const text=await request.text();if(text.length>1500)return json({error:'INVALID_INPUT'},400);raw=JSON.parse(text);}catch{return json({error:'INVALID_INPUT'},400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return json({error:'INVALID_INPUT'},400);
 const {projectId,email,role}=parsed.data;
 const {data:owned,error:ownedError}=await supabase.from('feasibility_projects')
   .select('id').eq('id',projectId).eq('owner_user_id',user.id).maybeSingle();
 if(ownedError)return json({error:'PROJECT_LOOKUP_FAILED'},500);
 if(!owned)return json({error:'PROJECT_OWNER_REQUIRED'},403);
 // Owner manually shares the 256-bit secret. The database only stores its SHA-256 digest.
 const code=randomBytes(32).toString('base64url');
 const token_digest=createHash('sha256').update(code).digest('hex');
 const expires_at=new Date(Date.now()+6*24*3600*1000).toISOString();
 const {data,error}=await supabase.from('feasibility_project_invitations').insert({
  project_id:projectId,created_by:user.id,invitee_email:email.toLowerCase(),role,token_digest,expires_at
 }).select('id,role,expires_at').single();
 if(error)return json({error:'INVITATION_FAILED'},500);
 return json({id:data.id,role:data.role,expires_at:data.expires_at,code},201);
}

const revokeInput=z.object({projectId:z.string().uuid(),invitationId:z.string().uuid()}).strict();
export async function PATCH(request:Request){
 if(!enabled())return json({error:'SHARING_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const {supabase,user,access,accessError}=await context();
 if(!user)return json({error:'UNAUTHORIZED'},401);
 if(accessError)return json({error:'ENTITLEMENT_LOOKUP_FAILED'},503);
 if(!access?.canWrite)return json({error:'FEASIBILITY_READ_ONLY'},403);
 let raw:unknown;
 try{const t=await request.text();if(t.length>600)return json({error:'INVALID_INPUT'},400);raw=JSON.parse(t)}
 catch{return json({error:'INVALID_INPUT'},400);}
 const parsed=revokeInput.safeParse(raw);if(!parsed.success)return json({error:'INVALID_INPUT'},400);
 const {projectId,invitationId}=parsed.data;
 const {data:owned,error:ownerError}=await supabase.from('feasibility_projects')
  .select('id').eq('id',projectId).eq('owner_user_id',user.id).maybeSingle();
 if(ownerError)return json({error:'PROJECT_LOOKUP_FAILED'},503);
 if(!owned)return json({error:'PROJECT_OWNER_REQUIRED'},403);
 const {data,error}=await supabase.rpc('feasibility_revoke_project_invitation',{
  p_project_id:projectId,p_invitation_id:invitationId
 });
 if(error)return json({error:'INVITATION_REVOKE_FAILED'},403);
 if(data!==true)return json({error:'INVITATION_ALREADY_USED_OR_REVOKED'},409);
 return json({revoked:true});
}
