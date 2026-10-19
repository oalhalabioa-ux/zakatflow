'use client';
import {useEffect,useRef} from 'react';
import TopbarCompanyLevel from './TopbarGroupSwitch';
import {organizationTree,organizationOptionLabel,preferredOrganization,rememberedOrganization,rememberedCompanyGroup,rememberOrganization,type WorkspaceOrganization} from '../lib/workspace-organization';
/** One company picker and one display-level control for every operational workspace. */
export default function WorkspaceOrganizationPicker({organizations,value,onChange,group,onGroupChange,disabled=false,ar=true,restore=true}:{organizations:WorkspaceOrganization[];value:string;onChange:(id:string)=>void;group?:boolean;onGroupChange?:(group:boolean)=>void;disabled?:boolean;ar?:boolean;restore?:boolean}){
 const initialized=useRef(false),callbacks=useRef({onChange,onGroupChange});callbacks.current={onChange,onGroupChange};
 const selected=organizations.find(o=>o.id===value),canGroup=!!selected&&organizations.some(o=>o.parent_organization_id===value);
 useEffect(()=>{if(!restore||initialized.current||!organizations.length)return;initialized.current=true;const q=new URLSearchParams(window.location.search),explicit=q.get('organization')??q.get('organization_id');const next=preferredOrganization(organizations,explicit??rememberedOrganization());if(!next)return;callbacks.current.onChange(next.id);const hasChildren=organizations.some(o=>o.parent_organization_id===next.id);callbacks.current.onGroupChange?.(hasChildren&&(q.has('level')?q.get('level')==='GROUP':rememberedCompanyGroup()));},[organizations,restore]);
 // Selection persistence happens only on deliberate changes, never from stale mount defaults.
 function choose(id:string){const nextGroup=!!group&&organizations.some(o=>o.parent_organization_id===id);rememberOrganization(id,nextGroup);onChange(id);onGroupChange?.(nextGroup)}
 return <><label className="workspace-organization-picker">{ar?'الشركة':'Company'}<select aria-label={ar?'الشركة':'Company'} value={value} disabled={disabled||!organizations.length} onChange={e=>choose(e.target.value)}><option value="" disabled>{ar?'اختر شركة':'Select company'}</option>{organizationTree(organizations).map(({organization:o,depth})=><option key={o.id} value={o.id}>{organizationOptionLabel(o,ar,depth)}</option>)}</select></label>{onGroupChange&&<TopbarCompanyLevel ar={ar} checked={!!group&&canGroup} disabled={disabled||!value} groupDisabled={!canGroup} onChange={next=>{rememberOrganization(value,next);onGroupChange(next)}}/>}</>;
}
