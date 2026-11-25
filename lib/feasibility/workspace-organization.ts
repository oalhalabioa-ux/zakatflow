import type {WorkspaceScope} from '../topbar-navigation';
import type {WorkspaceOrganization} from '../workspace-organization';

/** Restore only an organization present in the page's authorized catalog. */
export function feasibilityOrganizationContext(query:string,scope:WorkspaceScope,organizations:readonly WorkspaceOrganization[],remembered:string|null){
 const params=new URLSearchParams(query);
 const explicit=scope==='ORGANIZATION'?(params.get('organization')??params.get('organization_id')):null;
 const saved=remembered&&organizations.some(item=>item.id===remembered)?remembered:'';
 const organizationId=explicit??saved;
 if(scope!=='ORGANIZATION'||explicit!==null||!organizationId)return {organizationId,canonicalQuery:null};
 params.set('organization',organizationId);
 params.set('level','COMPANY');
 return {organizationId,canonicalQuery:params.toString()};
}
