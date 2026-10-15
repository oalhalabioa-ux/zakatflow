import {workspaceScopeHref,isClientWorkspaceScope,type WorkspaceScope} from './topbar-navigation';
/** Update client-owned filters and bookmark state without fetching a server page. */
export function updateClientWorkspaceScope(scope:WorkspaceScope,replace=false){
 const parts=window.location.pathname.split('/'),locale=parts[1],page=parts.slice(2).join('/');
 if(!isClientWorkspaceScope(page))return false;
 const href=workspaceScopeHref(locale,page,window.location.search,scope);
 if(href!==window.location.pathname+window.location.search)window.history[replace?'replaceState':'pushState'](null,'',href);
 window.dispatchEvent(new CustomEvent('zf-workspace-scope',{detail:scope}));
 return true;
}
