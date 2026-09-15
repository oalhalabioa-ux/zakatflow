import { requireUser } from './auth';

export async function audit(entityType:string, entityId:string|undefined, action:string, oldData:any=null, newData:any=null){
  const {supabase,user}=await requireUser();
  await supabase.from('audit_logs').insert({user_id:user.id,entity_type:entityType,entity_id:entityId??null,action,old_data:oldData,new_data:newData});
}
