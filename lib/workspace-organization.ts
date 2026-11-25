import {organizationDisplayName} from './organization-display';
export type WorkspaceOrganization={id:string;name:string;organization_kind?:string;parent_organization_id?:string|null;sort_order?:number;base_currency?:string};
export const organizationStorageKey='zf-liquidity-org';
export const groupStorageKey='zf-workspace-company-level';
export function organizationTree<T extends WorkspaceOrganization>(items:T[]):Array<{organization:T;depth:number}>{
 const byId=new Map(items.map(o=>[o.id,o])),seen=new Set<string>(),result:Array<{organization:T;depth:number}>=[];
 const priority=(o:T)=>!o.parent_organization_id&&(/ليفانت|levant/i.test(o.name))?0:!o.parent_organization_id&&o.organization_kind==='HOLDING'?1:2;
 const sorted=[...items].sort((a,b)=>priority(a)-priority(b)||(a.sort_order??100)-(b.sort_order??100)||a.name.localeCompare(b.name,'ar'));
 function visit(o:T,depth:number){if(seen.has(o.id))return;seen.add(o.id);result.push({organization:o,depth});for(const child of sorted)if(child.parent_organization_id===o.id)visit(child,depth+1)}
 for(const o of sorted)if(!o.parent_organization_id||!byId.has(o.parent_organization_id))visit(o,0);
 for(const o of sorted)visit(o,0);
 return result;
}
export function preferredOrganization<T extends WorkspaceOrganization>(items:T[],saved?:string|null){return items.find(o=>o.id===saved)??organizationTree(items)[0]?.organization;}
/** An explicit URL selection must never resolve to another company. */
export function requestedOrganization<T extends WorkspaceOrganization>(items:T[],explicit:string|null,saved?:string|null){return explicit!==null?items.find(o=>o.id===explicit):preferredOrganization(items,saved);}
export function organizationOptionLabel(o:WorkspaceOrganization,ar:boolean,depth=0){return `${depth||o.parent_organization_id||o.organization_kind==='SUBSIDIARY'?'↳':'▣'} ${organizationDisplayName(o.name,ar)}`;}
export function organizationScopeIds(items:WorkspaceOrganization[],id:string,group:boolean){const ids=new Set<string>(id?[id]:[]);if(group){let changed=true;while(changed){changed=false;for(const o of items)if(o.parent_organization_id&&ids.has(o.parent_organization_id)&&!ids.has(o.id)){ids.add(o.id);changed=true}}}return ids;}
export function rememberedOrganization(){try{return sessionStorage.getItem(organizationStorageKey)??localStorage.getItem(organizationStorageKey)}catch{return null}}
export function rememberedCompanyGroup(){try{return localStorage.getItem(groupStorageKey)==='GROUP'}catch{return false}}
export function rememberOrganization(id:string,group?:boolean){
 if(!id)return;
 const q=new URLSearchParams(window.location.search),previous=q.get('organization')??q.get('organization_id')??rememberedOrganization();
 try{sessionStorage.setItem(organizationStorageKey,id);localStorage.setItem(organizationStorageKey,id);if(group!==undefined)localStorage.setItem(groupStorageKey,group?'GROUP':'COMPANY')}catch{}
 const page=window.location.pathname.split('/').slice(2).join('/');
 if(page!=='dashboard'){
  q.set('organization',id);q.delete('organization_id');
  if(previous!==id)for(const key of ['entity','entity_id','branch','branch_id','cost_center','cost_center_id','center','center_id'])q.delete(key);
  if(group!==undefined)q.set('level',group?'GROUP':'COMPANY');
  window.history.replaceState(null,'',window.location.pathname+'?'+q);
 }
 window.dispatchEvent(new Event('zf-organization-selection'));
}
