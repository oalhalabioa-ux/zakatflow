import { createServerSupabase } from '@/lib/supabase/server';

// Reuse the canonical atomic organization + owner + trial path.
export async function createOrganization(input:{name:string;slug:string;plan?:string;base_currency:string}){
 const {createOrganization:createWorkspace}=await import('./organizations');
 return createWorkspace({name:input.name,base_currency:input.base_currency,entity_type:'BUSINESS',organization_kind:'HOLDING'});
}
export async function createEntity(input:{organization_id:string;name:string;type:string;base_currency:string;registration_no?:string}){
 const db=await createServerSupabase();
 const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('UNAUTHENTICATED');
 const {data,error}=await db.from('organization_entities').insert(input).select().single(); if(error) throw error; return data;
}
