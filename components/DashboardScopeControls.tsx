'use client';
import {useOptimistic} from 'react';
import TopbarOrganizationControls from './TopbarOrganizationControls';
import TopbarGroupSwitch from './TopbarGroupSwitch';
import {useWorkspaceNavigation} from './WorkspaceNavigation';
import {dashboardScopeHref} from '../lib/dashboard-scope-navigation';
type Organization={id:string;name:string;base_currency:string};
export default function DashboardScopeControls({locale,organizations,organizationId,group,query}:{locale:string;organizations:Array<{organization:Organization;depth:number}>;organizationId:string;group:boolean;query:Record<string,string|undefined>}){
 const ar=locale==='ar',{pending,navigate}=useWorkspaceNavigation(),[selection,choose]=useOptimistic({organizationId,group},(_previous,next:{organizationId:string;group:boolean})=>next);
 function update(organizationId:string,group:boolean){const fields={...query};const form=document.getElementById('dashboard-scope-form');if(form instanceof HTMLFormElement)for(const [key,value] of new FormData(form))if(typeof value==='string')fields[key]=value;navigate(dashboardScopeHref(locale,fields,organizationId,group),()=>choose({organizationId,group}))}
 return <TopbarOrganizationControls><label>{ar?'المنشأة':'Organization'}<select value={selection.organizationId} disabled={pending} onChange={e=>update(e.target.value,selection.group)}><option value="" disabled>{ar?'اختر منشأة':'Select organization'}</option>{organizations.map(({organization:o,depth})=><option key={o.id} value={o.id}>{`${depth?'↳ ':''}${o.name} · ${o.base_currency}`}</option>)}</select></label><TopbarGroupSwitch ar={ar} checked={selection.group} disabled={pending||!selection.organizationId} onChange={value=>update(selection.organizationId,value)}/></TopbarOrganizationControls>;
}
