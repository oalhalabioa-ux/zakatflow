'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ComponentProps} from 'react';
import {useEffect,useState} from 'react';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import {workspaceNavigationHref} from '../lib/workspace-navigation-href';
import {rememberedOrganization,rememberedCompanyGroup} from '../lib/workspace-organization';
export default function WorkspaceLink({href,...props}:ComponentProps<typeof Link>){
 const pathname=usePathname();
 const [scope]=useWorkspaceScope(),[company,setCompany]=useState({id:'',group:false});
 useEffect(()=>{
  const read=()=>{const q=new URLSearchParams(window.location.search),saved=rememberedOrganization(),id=q.get('organization')??q.get('organization_id')??saved??'';setCompany({id,group:q.has('level')?q.get('level')==='GROUP':id===saved&&rememberedCompanyGroup()})};
  read();window.addEventListener('zf-organization-selection',read);window.addEventListener('zf-workspace-scope',read);window.addEventListener('popstate',read);
  return()=>{window.removeEventListener('zf-organization-selection',read);window.removeEventListener('zf-workspace-scope',read);window.removeEventListener('popstate',read)};
 },[pathname]);
 const target=typeof href==='string'?workspaceNavigationHref(href,{scope,organization:company.id,group:company.group}):href;
 return <Link {...props} href={target}/>;
}
