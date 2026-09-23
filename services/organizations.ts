import { requireUser } from '@/services/auth';

export type Organization={
 id:string;
 name:string;
 legal_name?:string|null;
 owner_user_id?:string|null;
 entity_type:string;
 base_currency:string;
 status?:string;
 parent_organization_id?:string|null;
 organization_kind:'HOLDING'|'SUBSIDIARY';
 sort_order:number;
 created_at?:string;
 updated_at?:string;
};

export async function listOrganizations(){
 const {supabase}=await requireUser();
 const {data,error}=await supabase
  .from('organizations')
  .select('id,name,legal_name,owner_user_id,entity_type,base_currency,status,parent_organization_id,organization_kind,sort_order,created_at,updated_at')
  .order('sort_order',{ascending:true})
  .order('created_at',{ascending:true});
 if(error)throw error;
 return (data??[]) as Organization[];
}

export async function createOrganization(input:{
 name:string;
 entity_type?:string;
 base_currency?:string;
 parent_organization_id?:string|null;
 organization_kind?:'HOLDING'|'SUBSIDIARY';
 sort_order?:number;
}){
 const {supabase,user}=await requireUser();
 const name=input.name.trim();
 if(!name)throw new Error('ORGANIZATION_NAME_REQUIRED');
 const parentId=input.parent_organization_id??null;
 if(parentId){
  const {data:parent,error:parentError}=await supabase.from('organizations').select('id').eq('id',parentId).single();
  if(parentError||!parent)throw parentError??new Error('PARENT_ORGANIZATION_NOT_FOUND');
 }
 const organizationKind=input.organization_kind??(parentId?'SUBSIDIARY':'HOLDING');
 const {data,error}=await supabase.from('organizations').insert({
  owner_user_id:user.id,
  name,
  entity_type:input.entity_type??'FAMILY',
  base_currency:input.base_currency??'SAR',
  parent_organization_id:parentId,
  organization_kind:organizationKind,
  sort_order:Number(input.sort_order??100)
 }).select().single();
 if(error)throw error;
 const m=await supabase.from('organization_members').insert({organization_id:data.id,user_id:user.id,role:'OWNER'});
 if(m.error)throw m.error;
 return data as Organization;
}

export async function updateOrganization(id:string,input:{
 name:string;
 parent_organization_id?:string|null;
 organization_kind?:'HOLDING'|'SUBSIDIARY';
 sort_order?:number;
}){
 const {supabase,user}=await requireUser();
 const name=input.name.trim();
 if(!name)throw new Error('ORGANIZATION_NAME_REQUIRED');
 if(input.parent_organization_id===id)throw new Error('ORGANIZATION_PARENT_SELF_REFERENCE');
 if(input.parent_organization_id){
  const {data:parent,error:parentError}=await supabase.from('organizations').select('id').eq('id',input.parent_organization_id).single();
  if(parentError||!parent)throw parentError??new Error('PARENT_ORGANIZATION_NOT_FOUND');
 }
 const {data:current,error:currentError}=await supabase.from('organizations').select('name').eq('id',id).single();
 if(currentError)throw currentError;
 const patch:Record<string,unknown>={name,updated_at:new Date().toISOString()};
 if(input.parent_organization_id!==undefined)patch.parent_organization_id=input.parent_organization_id;
 if(input.organization_kind!==undefined)patch.organization_kind=input.organization_kind;
 if(input.sort_order!==undefined)patch.sort_order=Number(input.sort_order);
 const {data,error}=await supabase.from('organizations').update(patch).eq('id',id).select().single();
 if(error)throw error;
 if(current?.name&&current.name!==name){
  const budgetUpdate=await supabase.from('budget_plans').update({organization_name:name}).eq('user_id',user.id).eq('organization_name',current.name);
  if(budgetUpdate.error)throw budgetUpdate.error;
 }
 return data as Organization;
}

export async function listEntities(orgId:string){
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('organization_entities').select('*').eq('organization_id',orgId).order('created_at');
 if(error)throw error;
 return data??[];
}

export async function createEntity(orgId:string,input:{name:string;entity_type?:string;base_currency?:string}){
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('organization_entities').insert({organization_id:orgId,name:input.name,entity_type:input.entity_type??'PERSON',base_currency:input.base_currency??'SAR'}).select().single();
 if(error)throw error;
 return data;
}

export type OrganizationCostCenter={id:string;organization_id:string;code:string;display_code?:string|null;name:string;active:boolean;created_at:string;updated_at:string};

export async function listCostCenters(organizationId:string){
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('organization_cost_centers').select('*').eq('organization_id',organizationId).eq('active',true).order('display_code',{ascending:true,nullsFirst:false}).order('name',{ascending:true});
 if(error)throw error;
 return (data??[]) as OrganizationCostCenter[];
}

export async function createCostCenter(input:{organization_id:string;code:string;name:string}){
 const {supabase}=await requireUser();
 const code=input.code.trim().toUpperCase(),name=input.name.trim();
 if(!code||!name)throw new Error('COST_CENTER_CODE_AND_NAME_REQUIRED');
 const {data,error}=await supabase.from('organization_cost_centers').insert({organization_id:input.organization_id,code,name}).select().single();
 if(error)throw error;
 return data as OrganizationCostCenter;
}

export async function updateCostCenter(id:string,input:{name:string}){
 const {supabase}=await requireUser();
 const name=input.name.trim();
 if(!name)throw new Error('COST_CENTER_NAME_REQUIRED');
 const {data,error}=await supabase.from('organization_cost_centers').update({name,updated_at:new Date().toISOString()}).eq('id',id).select().single();
 if(error)throw error;
 return data as OrganizationCostCenter;
}

export async function createInvitation(orgId:string,email:string,role:string){
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('organization_invitations').insert({organization_id:orgId,email,role}).select().single();
 if(error)throw error;
 return data;
}

export async function listInvitations(orgId:string){
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('organization_invitations').select('*').eq('organization_id',orgId).order('created_at',{ascending:false});
 if(error)throw error;
 return data??[];
}
