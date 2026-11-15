import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {evaluateFeasibilityAccess} from '../../../../lib/feasibility/access';
import {feasibilityDraftSchema} from '../../../../lib/feasibility/draft-schema';
import {handoffReadiness} from '../../../../lib/feasibility/handoff';

export const dynamic='force-dynamic';
const enabled=()=>process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const input=z.object({projectId:z.string().uuid(),sourceRevision:z.number().int().positive(),notes:z.string().trim().max(2000)}).strict();
async function context(){
 const supabase=await supabaseServer();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return {supabase,user:null,access:null,accessError:null};
 const {data:grant,error:accessError}=await supabase.from('feasibility_access_grants')
  .select('status,starts_at,ends_at').eq('user_id',user.id).maybeSingle();
 return {supabase,user,access:evaluateFeasibilityAccess(grant),accessError};
}
export async function GET(request:Request){
 if(!enabled())return json({error:'REVIEW_QA_DISABLED'},404);
 const id=new URL(request.url).searchParams.get('project_id');
 if(!z.string().uuid().safeParse(id).success)return json({error:'INVALID_PROJECT'},400);
 const {supabase,user,access,accessError}=await context();
 if(!user)return json({error:'UNAUTHORIZED'},401);
 if(accessError)return json({error:'ENTITLEMENT_UNAVAILABLE'},503);
 if(!access?.canRead)return json({error:'FEASIBILITY_ACCESS_REQUIRED'},403);
 const {data,error}=await supabase.from('feasibility_review_snapshots')
  .select('id,project_id,source_revision,notes,created_at')
  .eq('project_id',id!).eq('owner_user_id',user.id)
  .order('created_at',{ascending:false}).limit(40);
 if(error)return json({error:'REVIEW_READ_FAILED'},500);
 return json(data??[]);
}
export async function POST(request:Request){
 if(!enabled())return json({error:'REVIEW_QA_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const {supabase,user,access,accessError}=await context();
 if(!user)return json({error:'UNAUTHORIZED'},401);
 if(accessError)return json({error:'ENTITLEMENT_UNAVAILABLE'},503);
 if(!access?.canWrite)return json({error:'FEASIBILITY_READ_ONLY'},403);
 let body:unknown;
 try{const text=await request.text();if(text.length>6000)return json({error:'INVALID_INPUT'},400);body=JSON.parse(text);}
 catch{return json({error:'INVALID_INPUT'},400);}
 const parsed=input.safeParse(body);
 if(!parsed.success)return json({error:'INVALID_INPUT'},400);
 const {projectId,sourceRevision,notes}=parsed.data;
 const {data:project,error:projectError}=await supabase.from('feasibility_projects')
  .select('id,revision,study').eq('id',projectId).eq('owner_user_id',user.id).maybeSingle();
 if(projectError)return json({error:'PROJECT_READ_FAILED'},500);
 if(!project)return json({error:'PROJECT_NOT_FOUND'},404);
 if(project.revision!==sourceRevision)return json({error:'STUDY_REVISION_CONFLICT'},409);
 const checked=feasibilityDraftSchema.safeParse(project.study);
 if(!checked.success||!handoffReadiness(checked.data).ready)
  return json({error:'STUDY_NOT_READY_FOR_INTERNAL_REVIEW'},422);
 // The DB trigger captures study_snapshot from the locked persisted row and verifies its revision.
 // Never accept a client-controlled snapshot or financial-approval field.
 const {data,error}=await supabase.from('feasibility_review_snapshots')
  .insert({project_id:projectId,source_revision:sourceRevision,notes})
  .select('id,project_id,source_revision,notes,created_at').single();
 if(error)return json({error:error.code==='23505'||error.message?.includes('STALE_STUDY_REVISION')?
   'STUDY_REVISION_CONFLICT':'REVIEW_SAVE_FAILED'},error.code==='23505'||error.message?.includes('STALE_STUDY_REVISION')?409:500);
 return json(data,201);
}
