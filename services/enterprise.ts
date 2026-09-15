import { createServerSupabase } from '@/lib/supabase/server';

export async function createOrganization(input:{name:string;slug:string;plan?:string;base_currency:string}){
 const db=await createServerSupabase();
 const {data:{user},error:authError}=await db.auth.getUser();
 if(authError||!user) throw new Error('UNAUTHENTICATED');
 const {data,error}=await db.from('organizations').insert({name:input.name,slug:input.slug,plan:input.plan??'FREE',base_currency:input.base_currency,owner_id:user.id}).select().single();
 if(error) throw error;
 const {error:memberError}=await db.from('organization_members').insert({organization_id:data.id,user_id:user.id,role:'OWNER'});
 if(memberError) throw memberError;
 return data;
}
export async function createEntity(input:{organization_id:string;name:string;type:string;base_currency:string;registration_no?:string}){
 const db=await createServerSupabase();
 const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('UNAUTHENTICATED');
 const {data,error}=await db.from('organization_entities').insert(input).select().single(); if(error) throw error; return data;
}
