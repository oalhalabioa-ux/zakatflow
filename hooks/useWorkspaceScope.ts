'use client';
import {useCallback,useEffect,useState} from 'react';
import {currentWorkspaceScope,type WorkspaceScope} from '@/lib/topbar-navigation';
export function useWorkspaceScope(){
 const [scope,setScope]=useState<WorkspaceScope>('PERSONAL');
 useEffect(()=>{const read=()=>setScope(currentWorkspaceScope(window.location.pathname.split('/').slice(2).join('/'),window.location.search));const receive=(event:Event)=>{const value=(event as CustomEvent<WorkspaceScope>).detail;if(value==='PERSONAL'||value==='ORGANIZATION')setScope(value)};read();window.addEventListener('zf-workspace-scope',receive);window.addEventListener('popstate',read);return()=>{window.removeEventListener('zf-workspace-scope',receive);window.removeEventListener('popstate',read)}},[]);
 const choose=useCallback((value:WorkspaceScope)=>{setScope(value);window.dispatchEvent(new CustomEvent('zf-page-scope',{detail:value}))},[]);
 return [scope,choose] as const;
}
