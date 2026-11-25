import {clearOrganizationScopeQuery,currentWorkspaceScope,isSharedWorkspacePage,isWorkspaceScopePage,type WorkspaceScope} from './topbar-navigation';

type Selection={scope:WorkspaceScope;organization?:string|null;group?:boolean};

/** Resolve sidebar and search links from the same banner selection. */
export function workspaceNavigationHref(href:string,selection:Selection):string{
 if(!/^\/(ar|en)\//.test(href))return href;
 const url=new URL(href,'https://workspace.invalid');
 let page=url.pathname.split('/').slice(2).join('/');
 const q=url.searchParams;
 // Both setup journeys already exist. A generic journey link uses the active scope.
 if(page==='settings/financial/setup'&&selection.scope==='PERSONAL'&&!q.has('organization')&&q.get('scope')!=='ORGANIZATION'){
  page='settings/personal-setup';url.pathname=url.pathname.replace('settings/financial/setup',page);
 }
 const explicit=q.get('scope');
 const organizationOnly=!isWorkspaceScopePage(page)&&page!=='settings/personal-setup'&&currentWorkspaceScope(page,'')==='ORGANIZATION';
 const scope:WorkspaceScope=page==='settings/personal-setup'?'PERSONAL':isWorkspaceScopePage(page)
  ?explicit==='PERSONAL'||explicit==='ORGANIZATION'?explicit:selection.scope
  :organizationOnly?'ORGANIZATION':selection.scope;
 if(isWorkspaceScopePage(page)||organizationOnly||page==='settings/personal-setup')q.set('scope',scope);
 if(scope==='PERSONAL'||isSharedWorkspacePage(page)){
  clearOrganizationScopeQuery(q);
  if(page==='financial-reports')q.delete('screen');
 }else if(isWorkspaceScopePage(page)||organizationOnly||page==='settings/personal-setup'){
  // Older callers still use organization_id. Never replace an explicit target
  // with the currently remembered company, or leave conflicting aliases.
  const requested=q.get('organization')??q.get('organization_id');
  if(requested!==null){q.set('organization',requested);if(q.has('organization_id'))q.set('organization_id',requested);}
  else if(selection.organization)q.set('organization',selection.organization);
  if(!q.has('level'))q.set('level',selection.group&&q.get('organization')===selection.organization?'GROUP':'COMPANY');
 }
 return url.pathname+url.search+url.hash;
}
