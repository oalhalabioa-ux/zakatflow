'use client';
import {useEffect,useId,useRef,useState} from 'react';
import TopbarCompanyLevel from './TopbarGroupSwitch';
import {organizationTree,organizationOptionLabel,preferredOrganization,rememberedOrganization,rememberedCompanyGroup,rememberOrganization,type WorkspaceOrganization} from '../lib/workspace-organization';
/** One company picker and one display-level control for every operational workspace. */
export default function WorkspaceOrganizationPicker({organizations,value,onChange,group,onGroupChange,disabled=false,ar=true,restore=true,label,beforeChange,royalDialog=false}:{organizations:WorkspaceOrganization[];value:string;onChange:(id:string)=>void;group?:boolean;onGroupChange?:(group:boolean)=>void;disabled?:boolean;ar?:boolean;restore?:boolean;label?:string;beforeChange?:()=>boolean;royalDialog?:boolean}){
 const initialized=useRef(false),callbacks=useRef({onChange,onGroupChange});callbacks.current={onChange,onGroupChange};
 const dialog=useRef<HTMLDialogElement>(null);
 const dialogTitle=useId();
 const [candidate,setCandidate]=useState('');
 const selected=organizations.find(o=>o.id===value),canGroup=!!selected&&organizations.some(o=>o.parent_organization_id===value);
 useEffect(()=>{if(!restore||initialized.current||!organizations.length)return;initialized.current=true;const q=new URLSearchParams(window.location.search),explicit=q.get('organization')??q.get('organization_id');const next=preferredOrganization(organizations,explicit??rememberedOrganization());if(!next)return;callbacks.current.onChange(next.id);const hasChildren=organizations.some(o=>o.parent_organization_id===next.id);callbacks.current.onGroupChange?.(hasChildren&&(q.has('level')?q.get('level')==='GROUP':rememberedCompanyGroup()));},[organizations,restore]);
 // Selection persistence happens only on deliberate changes, never from stale mount defaults.
 function choose(id:string){if(beforeChange&&!beforeChange())return false;const nextGroup=!!group&&organizations.some(o=>o.parent_organization_id===id);rememberOrganization(id,nextGroup);onChange(id);onGroupChange?.(nextGroup);return true}
 if(royalDialog)return <div className="fs-page fs-royal fs-royal-organization-control" data-labeled-organization-picker dir={ar?'rtl':'ltr'}>
  <button type="button" className="fs-royal-organization-trigger" aria-haspopup="dialog" title={selected?.name}
   aria-label={ar?'اختيار المؤسسة من البنر الرئيسي':'Choose organization from the main banner'} disabled={disabled||!organizations.length}
   onClick={()=>{setCandidate(value);dialog.current?.showModal()}}>
   <span>{selected?.name??(ar?'اختر المؤسسة':'Select organization')}</span><span aria-hidden="true">⌄</span>
  </button>
  <dialog ref={dialog} className="fs-dialog fs-royal-dialog" aria-labelledby={dialogTitle}>
   <div className="fs-royal-heading"><h2 id={dialogTitle}>{ar?'اختيار المؤسسة من البنر الرئيسي':'Choose organization from the main banner'}</h2>
    <button type="button" className="fs-royal-close" aria-label={ar?'إغلاق':'Close'} onClick={()=>dialog.current?.close()}>×</button>
   </div>
   <fieldset className="fs-study-scope fs-royal-organizations" disabled={disabled}>
    <legend className="fs-hint">{ar?'المؤسسات المصرح لك بالوصول إليها':'Organizations you can access'}</legend>
    {organizationTree(organizations).map(({organization:item,depth})=><label className="fs-check" key={item.id} data-selected={candidate===item.id}>
     <input type="radio" name={dialogTitle} checked={candidate===item.id} onChange={()=>setCandidate(item.id)}/>
     <span>{organizationOptionLabel(item,ar,depth)}</span>
     {item.id===value&&<small>{ar?'المؤسسة الحالية':'Current organization'}</small>}
    </label>)}
   </fieldset>
   <div className="fs-actions">
    <button type="button" className="fs-btn" disabled={disabled||!organizations.some(item=>item.id===candidate)}
     onClick={()=>{if(candidate===value||choose(candidate))dialog.current?.close()}}>{ar?'اختيار المؤسسة':'Select organization'}</button>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>dialog.current?.close()}>{ar?'إلغاء':'Cancel'}</button>
   </div>
  </dialog>
 </div>;
 return <><label className="workspace-organization-picker" data-labeled-organization-picker={label?true:undefined}>{label??(ar?'الشركة':'Company')}<select aria-label={label??(ar?'الشركة':'Company')} value={value} disabled={disabled||!organizations.length} onChange={e=>choose(e.target.value)}><option value="" disabled>{ar?'اختر شركة':'Select company'}</option>{organizationTree(organizations).map(({organization:o,depth})=><option key={o.id} value={o.id}>{organizationOptionLabel(o,ar,depth)}</option>)}</select></label>{onGroupChange&&<TopbarCompanyLevel ar={ar} checked={!!group&&canGroup} disabled={disabled||!value} groupDisabled={!canGroup} onChange={next=>{rememberOrganization(value,next);onGroupChange(next)}}/>}</>;
}
