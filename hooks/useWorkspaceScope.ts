'use client';
import {useCallback,useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {currentWorkspaceScope,rememberWorkspaceScope,isWorkspaceScopePage,rememberedWorkspaceScope,type WorkspaceScope} from '../lib/topbar-navigation';
export function useWorkspaceScope(initialScope:WorkspaceScope='PERSONAL'){
 const pathname=usePathname(),[scope,setScope]=useState<WorkspaceScope>(initialScope);
 useEffect(()=>{const read=()=>setScope(currentWorkspaceScope(window.location.pathname.split('/').slice(2).join('/'),window.location.search,rememberedWorkspaceScope()));const receive=(event:Event)=>{const value=(event as CustomEvent<WorkspaceScope>).detail;if(value==='PERSONAL'||value==='ORGANIZATION')setScope(value)};read();window.addEventListener('zf-workspace-scope',receive);window.addEventListener('popstate',read);return()=>{window.removeEventListener('zf-workspace-scope',receive);window.removeEventListener('popstate',read)}},[pathname,initialScope]);
 const choose=useCallback((value:WorkspaceScope)=>{setScope(value);if(isWorkspaceScopePage(window.location.pathname.split('/').slice(2).join('/')))rememberWorkspaceScope(value);window.dispatchEvent(new CustomEvent('zf-page-scope',{detail:value}))},[]);
 return [scope,choose] as const;
}
