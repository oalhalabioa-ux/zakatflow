import {z} from 'zod';
import type {WorkspaceScope} from './topbar-navigation';

export const lotWorkspaceScopeSchema=z.object({
 scope:z.enum(['PERSONAL','ORGANIZATION']).default('PERSONAL'),
 organization_id:z.string().uuid().nullable().default(null),
 group:z.boolean().default(false),
}).strict().superRefine((value,context)=>{
 if(value.scope==='PERSONAL'&&(value.organization_id||value.group)||value.scope==='ORGANIZATION'&&!value.organization_id)context.addIssue({code:'custom',message:'LOT_SCOPE_INVALID'});
});
export function readLotWorkspaceScope(query:URLSearchParams){
 if([...query.keys()].some(key=>!['scope','organization_id','group'].includes(key)||query.getAll(key).length!==1)||query.has('group')&&!['0','1'].includes(query.get('group')!))throw Error('LOT_SCOPE_INVALID');
 return lotWorkspaceScopeSchema.parse({scope:query.get('scope')??'PERSONAL',organization_id:query.get('organization_id'),group:query.get('group')==='1'});
}
export function lotWorkspaceQuery(scope:WorkspaceScope,organization:string,group:boolean){
 const query=new URLSearchParams({scope});
 if(scope==='ORGANIZATION'){
  if(!organization)return null;
  query.set('organization_id',organization);if(group)query.set('group','1');
 }
 return query.toString();
}
