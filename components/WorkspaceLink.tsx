'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {isSettingsPage} from './settings/navigation';
import type {ComponentProps} from 'react';
import {useEffect,useState} from 'react';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import {isWorkspaceScopePage,rememberedWorkspaceScope} from '../lib/topbar-navigation';
import {rememberedOrganization,rememberedCompanyGroup} from '../lib/workspace-organization';
export default function WorkspaceLink({href,...props}:ComponentProps<typeof Link>){
 const pathname=usePathname();
 const [scope]=useWorkspaceScope(),[company,setCompany]=useState({id:'',group:false,scope:undefined as 'PERSONAL'|'ORGANIZATION'|undefined});
 useEffect(()=>{const read=()=>setCompany({id:new URLSearchParams(window.location.search).get('organization')??rememberedOrganization()??'',group:rememberedCompanyGroup(),scope:rememberedWorkspaceScope()});read();window.addEventListener('zf-organization-selection',read);window.addEventListener('zf-workspace-scope',read);return()=>{window.removeEventListener('zf-organization-selection',read);window.removeEventListener('zf-workspace-scope',read)}},[pathname]);
 let target=href;
 if(typeof href==='string'&&/^\/(ar|en)\//.test(href)){
  const [base,query='']=href.split('?'),page=base.split('/').slice(2).join('/'),q=new URLSearchParams(query);
  if(isSettingsPage(page)){if(company.id&&!q.has('organization'))q.set('organization',company.id);target=base+(q.size?'?'+q:'');}
  else if(isWorkspaceScopePage(page)){if(!q.has('scope'))q.set('scope',company.scope??scope);if(company.id&&!q.has('organization'))q.set('organization',company.id);if(!q.has('level'))q.set('level',company.group?'GROUP':'COMPANY');target=base+'?'+q;}
 }
 return <Link {...props} href={target}/>;
}
