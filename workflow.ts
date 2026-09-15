import {createServerSupabase} from '@/lib/supabase/server';
import {transition,WorkflowStatus} from '@/engine/workflow';
export async function createCase(input:{title:string;assessment_id?:string;organization_id?:string;entity_id?:string}){
 const db=await createServerSupabase(); const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('UNAUTHENTICATED');
 const {data,error}=await db.from('workflow_cases').insert({...input,owner_id:user.id,status:'DRAFT',current_step:'DATA_ENTRY'}).select().single(); if(error) throw error; return data;
}
export async function moveCase(id:string,to:WorkflowStatus,comment?:string){
 const db=await createServerSupabase(); const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('UNAUTHENTICATED');
 const {data:current,error:e}=await db.from('workflow_cases').select('id,status').eq('id',id).eq('owner_id',user.id).single(); if(e||!current) throw new Error('CASE_NOT_FOUND');
 const next=transition(current.status as WorkflowStatus,to);
 const {data,error}=await db.from('workflow_cases').update({...next,updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id).select().single(); if(error) throw error;
 await db.from('workflow_events').insert({case_id:id,actor_id:user.id,from_status:current.status,to_status:to,comment}); return data;
}
export async function listCases(){const db=await createServerSupabase(); const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('UNAUTHENTICATED'); const {data,error}=await db.from('workflow_cases').select('*').eq('owner_id',user.id).order('created_at',{ascending:false}); if(error) throw error; return data??[];}
