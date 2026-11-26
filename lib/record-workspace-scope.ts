import type {WorkspaceScope} from './topbar-navigation';
import {organizationScopeIds,type WorkspaceOrganization} from './workspace-organization';

export type RecordWorkspace={scope:WorkspaceScope;organizationId:string|null};
export type RecordWorkspaceSelection=RecordWorkspace&{group:boolean};

/** The authorized record and its owning asset must agree before details/actions are displayed. */
export function recordWorkspaceOwner(payload:any):RecordWorkspace|null{
 const record=payload?.record??payload;
 const relation=payload?.asset??record?.asset_accounts;
 const asset=Array.isArray(relation)?relation[0]:relation;
 if(!asset||!['PERSONAL','ORGANIZATION'].includes(asset.ownership_scope))return null;
 const organizationId=asset.organization_id??null;
 if((asset.ownership_scope==='PERSONAL'&&organizationId)||(asset.ownership_scope==='ORGANIZATION'&&!organizationId))return null;
 if(record.organization_id!==undefined&&(record.organization_id??null)!==organizationId)return null;
 return {scope:asset.ownership_scope,organizationId};
}

export function recordWorkspaceSelection(query:string,scope:WorkspaceScope,remembered?:string|null,rememberedGroup=false):RecordWorkspaceSelection{
 if(scope==='PERSONAL')return {scope,organizationId:null,group:false};
 const q=new URLSearchParams(query),explicit=q.get('organization')??q.get('organization_id');
 const organizationId=explicit??remembered??null;
 return {scope,organizationId,group:q.has('level')?q.get('level')==='GROUP':!!organizationId&&organizationId===remembered&&rememberedGroup};
}

export function recordMatchesWorkspace(owner:RecordWorkspace,selection:RecordWorkspaceSelection,organizations:WorkspaceOrganization[]=[]){
 if(owner.scope!==selection.scope)return false;
 if(owner.scope==='PERSONAL')return true;
 if(!selection.organizationId)return false;
 if(owner.organizationId===selection.organizationId)return true;
 return selection.group&&organizations.some(item=>item.id===selection.organizationId)
  &&organizationScopeIds(organizations,selection.organizationId,true).has(owner.organizationId!);
}

/** Use this for detail, replacement and back links; no remembered company is injected into a personal link. */
export function recordWorkspaceHref(locale:string,collection:'lots'|'transactions',selection:RecordWorkspaceSelection,id?:string){
 const q=new URLSearchParams({scope:selection.scope});
 if(selection.scope==='ORGANIZATION'){
  if(selection.organizationId!==null)q.set('organization',selection.organizationId);
  q.set('level',selection.group?'GROUP':'COMPANY');
 }
 return `/${locale}/${collection}${id?'/'+encodeURIComponent(id):''}?${q}`;
}
