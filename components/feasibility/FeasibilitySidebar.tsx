'use client';

import {createContext,useContext,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {StudyTab} from '@/lib/feasibility/engine';
import {RoyalIcon,studyTabIcons} from './RoyalIcon';

export const FeasibilitySidebarSlot=createContext<{
 target:HTMLElement|null;
 moduleIcon:ReactNode;
 expandMobileMenu:()=>void;
 closeMobileMenu:()=>void;
}|null>(null);

export function feasibilitySidebarLabel(locale:string){
 return locale==='ar'?'دراسات جدوى المشاريع':'Project Feasibility Studies';
}

export default function FeasibilitySidebar({locale,sections,active,onSelect}:{
 locale:string;
 sections:readonly {id:StudyTab;ar:string;en:string}[];
 active:StudyTab;
 onSelect:(id:StudyTab)=>void;
}){
 const slot=useContext(FeasibilitySidebarSlot);
 const [expanded,setExpanded]=useState(false);
 if(!slot?.target||!sections.length)return null;
 const moduleName=feasibilitySidebarLabel(locale);
 const label=locale==='ar'?'أقسام دراسات جدوى المشاريع':'Project Feasibility Studies sections';

 return createPortal(<>
  <button type="button" className="module-toggle" aria-label={moduleName} title={moduleName}
   aria-expanded={expanded} aria-controls="corp-feasibility-sections"
   onClick={()=>{
    setExpanded(!expanded);
    if(!expanded)slot.expandMobileMenu();
   }}>
   {slot.moduleIcon}<span className="corp-label">{moduleName}</span>
   <b className="corp-label" aria-hidden="true">{expanded?'⌃':'⌄'}</b>
  </button>
  <div className="corp-subnav corp-feasibility-sections" id="corp-feasibility-sections" role="group"
   aria-label={label} hidden={!expanded}>
   {expanded&&sections.map(section=>{
    const name=locale==='ar'?section.ar:section.en;
    return <button key={section.id} type="button" title={name} aria-label={name}
     aria-current={section.id===active?'location':undefined} onClick={()=>{
      onSelect(section.id);
      slot.closeMobileMenu();
     }}>
     <RoyalIcon name={studyTabIcons[section.id]}/><span className="corp-label">{name}</span>
    </button>;
   })}
  </div>
 </>,slot.target);
}
