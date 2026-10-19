'use client';
import {useOptimistic} from 'react';
import WorkspaceOrganizationPicker from './WorkspaceOrganizationPicker';
import {rememberOrganization} from '../lib/workspace-organization';
import TopbarOrganizationControls from './TopbarOrganizationControls';
import TopbarCompanyLevel from './TopbarGroupSwitch';
import {useWorkspaceNavigation} from './WorkspaceNavigation';
import {dashboardScopeHref} from '../lib/dashboard-scope-navigation';
type Organization={id:string;name:string;base_currency:string;parent_organization_id?:string|null;organization_kind?:string};
export default function DashboardScopeControls({locale,organizations,organizationId,group,query}:{locale:string;organizations:Array<{organization:Organization;depth:number}>;organizationId:string;group:boolean;query:Record<string,string|undefined>}){
 const ar=locale==='ar',{pending,navigate}=useWorkspaceNavigation(),[selection,choose]=useOptimistic({organizationId,group},(_previous,next:{organizationId:string;group:boolean})=>next);
 function update(organizationId:string,group:boolean){rememberOrganization(organizationId,group);const fields={...query};const form=document.getElementById('dashboard-scope-form');if(form instanceof HTMLFormElement)for(const [key,value] of new FormData(form))if(typeof value==='string')fields[key]=value;navigate(dashboardScopeHref(locale,fields,organizationId,group),()=>choose({organizationId,group}))}
 return <TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} organizations={organizations.map(({organization,depth})=>({...organization,organization_kind:organization.organization_kind??(depth?'SUBSIDIARY':'HOLDING')}))} value={selection.organizationId} onChange={id=>{if(id!==selection.organizationId)update(id,selection.group)}} group={selection.group} onGroupChange={value=>{if(value!==selection.group)update(selection.organizationId,value)}} restore={false}/></TopbarOrganizationControls>;
}
