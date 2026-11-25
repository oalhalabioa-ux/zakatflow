import type {WorkspaceScope} from './topbar-navigation';

/** The banner supplies the only ownership context for investment requests. */
export function investmentWorkspaceQuery(scope:WorkspaceScope,organizationId?:string|null,group=false){
 const params=new URLSearchParams({scope});
 if(scope==='ORGANIZATION'){
  if(!organizationId)return null;
  params.set('organization_id',organizationId);
  if(group)params.set('group','1');
 }
 return params.toString();
}
