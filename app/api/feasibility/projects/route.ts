import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {cloudDraftWrite} from '@/lib/feasibility/draft-schema';

export const dynamic='force-dynamic';
const enabled=()=>process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const denied=()=>response({error:'FEASIBILITY_CLOUD_DISABLED'},404);
async function context(){
 const supabase=await supabaseServer();
 const {data:{user},error}=await supabase.auth.getUser();
 return {supabase,user:error?null:user};
}
async function input(request:Request){
 const raw=await request.text();
 if(raw.length>950000) return null;
 let json:unknown;try{json=JSON.parse(raw)}catch{return null}
 const parsed=cloudDraftWrite.safeParse(json);
 return parsed.success?parsed.data:null;
}
export async function GET(){
 if(!enabled())return denied();
 const {supabase,user}=await context();if(!user)return response({error:'UNAUTHORIZED'},401);
 const {data,error}=await supabase.from('feasibility_projects')
  .select('id,title,revision,updated_at,study').eq('owner_user_id',user.id)
  .order('updated_at',{ascending:false}).limit(300);
 if(error)return response({error:'DRAFT_READ_FAILED'},500);
 return response(data??[]);
}
export async function POST(request:Request){
 if(!enabled())return denied();
 if(!isSameOriginRequest(request))return response({error:'INVALID_ORIGIN'},403);
 const {supabase,user}=await context();if(!user)return response({error:'UNAUTHORIZED'},401);
 const parsed=await input(request);if(!parsed||parsed.revision!==undefined)return response({error:'INVALID_STUDY'},400);
 const {study}=parsed;
 const {data,error}=await supabase.from('feasibility_projects').insert({
  id:study.id,owner_user_id:user.id,title:study.title,study
 }).select('id,revision,updated_at').single();
 if(error)return response({error:error.code==='23505'?'DRAFT_CONFLICT':'DRAFT_SAVE_FAILED'},error.code==='23505'?409:400);
 return response(data,201);
}
export async function PATCH(request:Request){
 if(!enabled())return denied();
 if(!isSameOriginRequest(request))return response({error:'INVALID_ORIGIN'},403);
 const {supabase,user}=await context();if(!user)return response({error:'UNAUTHORIZED'},401);
 const parsed=await input(request);if(!parsed||parsed.revision===undefined)return response({error:'INVALID_STUDY'},400);
 const {study,revision}=parsed;
 const {data,error}=await supabase.from('feasibility_projects').update({
  title:study.title,study,revision:revision+1,updated_at:new Date().toISOString()
 }).eq('id',study.id).eq('owner_user_id',user.id).eq('revision',revision)
  .select('id,revision,updated_at').maybeSingle();
 if(error)return response({error:'DRAFT_SAVE_FAILED'},500);
 if(!data)return response({error:'DRAFT_CONFLICT'},409);
 return response(data);
}
export async function DELETE(request:Request){
 if(!enabled())return denied();
 if(!isSameOriginRequest(request))return response({error:'INVALID_ORIGIN'},403);
 const {supabase,user}=await context();if(!user)return response({error:'UNAUTHORIZED'},401);
 const id=new URL(request.url).searchParams.get('id');
 if(!z.string().uuid().safeParse(id).success)return response({error:'INVALID_STUDY_ID'},400);
 const {data,error}=await supabase.from('feasibility_projects').delete()
  .eq('id',id!).eq('owner_user_id',user.id).select('id').maybeSingle();
 if(error)return response({error:'DRAFT_DELETE_FAILED'},500);
 if(!data)return response({error:'DRAFT_NOT_FOUND'},404);
 return response({deleted:true});
}
