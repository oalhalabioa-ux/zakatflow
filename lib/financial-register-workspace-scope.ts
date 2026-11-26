import {requestedOrganization,type WorkspaceOrganization} from './workspace-organization';

/** Resolve only authorized catalog entries. A missing explicit company is an error, never a default. */
export function financialRegisterSelection(
 organizations:WorkspaceOrganization[],query:string,
 options:{preferredOrg?:string;setupEmbedded?:boolean;remembered?:string|null;rememberedGroup?:boolean}={},
){
 const q=new URLSearchParams(query);
 const explicit=options.preferredOrg||(q.get('organization')??q.get('organization_id'));
 const selected=requestedOrganization(organizations,explicit,options.remembered);
 const group=!!selected&&!options.setupEmbedded&&organizations.some(item=>item.parent_organization_id===selected.id)
  &&(q.has('level')?q.get('level')==='GROUP':selected.id===options.remembered&&!!options.rememberedGroup);
 return {organizationId:selected?.id??'',group,unavailable:explicit!==null&&!selected};
}
