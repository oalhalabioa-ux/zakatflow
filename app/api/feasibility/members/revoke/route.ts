import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {evaluateFeasibilityAccess} from '../../../../../lib/feasibility/access';

export const dynamic='force-dynamic';
const enabled=()=>process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true' &&
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true' &&
 process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA==='true';
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
const bodySchema=z.object({projectId:z.string().uuid(),userId:z.string().uuid()}).strict();

export async function POST(request:Request){
 if(!enabled())return json({error:'SHARING_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const supabase=await supabaseServer();
 const {data:{user},error:userError}=await supabase.auth.getUser();
 if(userError||!user)return json({error:'UNAUTHORIZED'},401);
 const {data:grant,error:grantError}=await supabase.from('feasibility_access_grants')
  .select('status,starts_at,ends_at').eq('user_id',user.id).maybeSingle();
 if(grantError)return json({error:'ENTITLEMENT_LOOKUP_FAILED'},503);
 if(!evaluateFeasibilityAccess(grant).canWrite)return json({error:'FEASIBILITY_READ_ONLY'},403);
 let parsed:z.infer<typeof bodySchema>;
 try{
  const raw=await request.text();
  if(raw.length>500)return json({error:'INVALID_INPUT'},400);
  parsed=bodySchema.parse(JSON.parse(raw));
 }catch{return json({error:'INVALID_INPUT'},400);}
 if(parsed.userId===user.id)return json({error:'OWNER_CANNOT_BE_REVOKED'},400);
 const {data:owned,error:ownerError}=await supabase.from('feasibility_projects')
  .select('id').eq('id',parsed.projectId).eq('owner_user_id',user.id).maybeSingle();
 if(ownerError)return json({error:'PROJECT_LOOKUP_FAILED'},503);
 if(!owned)return json({error:'PROJECT_OWNER_REQUIRED'},403);
 // The DB function rechecks authoritative ownership; its RLS status change is immediate.
 const {data,error}=await supabase.rpc('feasibility_revoke_project_member',
  {p_project_id:parsed.projectId,p_user_id:parsed.userId});
 if(error)return json({error:'MEMBER_REVOCATION_FAILED'},403);
 if(data!==true)return json({error:'MEMBER_NOT_ACTIVE'},409);
 return json({revoked:true});
}
