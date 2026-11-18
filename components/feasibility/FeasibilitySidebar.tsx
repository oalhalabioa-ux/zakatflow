'use client';

import {createContext,useContext,useState} from 'react';
import {createPortal} from 'react-dom';
import type {StudyTab} from '@/lib/feasibility/engine';
import {RoyalIcon,studyTabIcons} from './RoyalIcon';

export const FeasibilitySidebarSlot=createContext<{
 target:HTMLElement|null;
 expandMobileMenu:()=>void;
 closeMobileMenu:()=>void;
}|null>(null);

export default function FeasibilitySidebar({locale,sections,active,onSelect}:{
 locale:string;
 sections:readonly {id:StudyTab;ar:string;en:string}[];
 active:StudyTab;
 onSelect:(id:StudyTab)=>void;
}){
 const slot=useContext(FeasibilitySidebarSlot);
 const [expanded,setExpanded]=useState(false);
 if(!slot?.target||!sections.length)return null;
 const label=locale==='ar'?'أقسام دراسات الجدوى':'Feasibility sections';

 return createPortal(<>
  <button type="button" className="module-toggle" aria-label={label} title={label}
   aria-expanded={expanded} aria-controls="corp-feasibility-sections"
   onClick={()=>{
    setExpanded(!expanded);
    if(!expanded)slot.expandMobileMenu();
   }}>
   <RoyalIcon name="layers"/><span className="corp-label">{label}</span>
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
