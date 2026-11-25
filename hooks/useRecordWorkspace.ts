'use client';
import {useEffect,useState} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {currentWorkspaceScope,rememberedWorkspaceScope} from '../lib/topbar-navigation';
import {rememberedOrganization,rememberedCompanyGroup,type WorkspaceOrganization} from '../lib/workspace-organization';
import {recordWorkspaceOwner,recordWorkspaceSelection,recordMatchesWorkspace,type RecordWorkspaceSelection} from '../lib/record-workspace-scope';

/** Read an authorized detail, then keep its actions hidden unless it matches the active banner. */
export function useRecordWorkspace(collection:'lots'|'transactions',id:string){
 const pathname=usePathname(),query=useSearchParams().toString(),endpoint=`/api/${collection}/${encodeURIComponent(id)}`;
 const [selected,setSelected]=useState<{pathQuery:string;selection:RecordWorkspaceSelection}|null>(null);
 const selection=selected?.pathQuery===pathname+'?'+query?selected.selection:null;
 const [loaded,setLoaded]=useState<{endpoint:string;data:any;error:string}|null>(null);
 const [catalog,setCatalog]=useState<{organizations:WorkspaceOrganization[];error:string}|null>(null);
 useEffect(()=>{
  const read=()=>{
   const scope=currentWorkspaceScope(window.location.pathname.split('/').slice(2).join('/'),window.location.search,rememberedWorkspaceScope());
   setSelected({pathQuery:window.location.pathname+'?'+new URLSearchParams(window.location.search),selection:recordWorkspaceSelection(window.location.search,scope,rememberedOrganization(),rememberedCompanyGroup())});
  };
  read();for(const event of ['popstate','zf-workspace-scope','zf-organization-selection'])window.addEventListener(event,read);
  return()=>{for(const event of ['popstate','zf-workspace-scope','zf-organization-selection'])window.removeEventListener(event,read)};
 },[pathname,query]);
 useEffect(()=>{
  const controller=new AbortController();setLoaded(null);
  fetch(endpoint,{cache:'no-store',signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok)throw Error(data.error??'RECORD_UNAVAILABLE');
   if(!controller.signal.aborted)setLoaded({endpoint,data,error:''});
  }).catch(error=>{if(!controller.signal.aborted)setLoaded({endpoint,data:null,error:error.message})});
  return()=>controller.abort();
 },[endpoint]);
 const needsCatalog=selection?.scope==='ORGANIZATION'&&selection.group;
 useEffect(()=>{
  if(!needsCatalog)return;
  const controller=new AbortController();setCatalog(null);
  fetch('/api/assets/catalog',{cache:'no-store',signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok)throw Error(data.error??'ORGANIZATION_ACCESS_REQUIRED');
   if(!controller.signal.aborted)setCatalog({organizations:data.organizations??[],error:''});
  }).catch(error=>{if(!controller.signal.aborted)setCatalog({organizations:[],error:error.message})});
  return()=>controller.abort();
 },[needsCatalog]);
 const response=loaded?.endpoint===endpoint?loaded:null,data=response?.data;
 const owner=data?recordWorkspaceOwner(data):null;
 const loading=!selection||!response||(needsCatalog&&!catalog);
 const error=response?.error||(data&&!owner?'RECORD_OWNER_INVALID':'')||(needsCatalog?catalog?.error:'')||'';
 const matches=!!owner&&!!selection&&recordMatchesWorkspace(owner,selection,catalog?.organizations);
 return {data,owner,selection,loading,error,matches};
}
