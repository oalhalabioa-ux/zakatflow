'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** Keep dashboard-owned controls and form submission while displaying them in the shell. */
export default function TopbarOrganizationControls({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{const find=()=>document.getElementById('corp-organization-controls');const initial=find();if(initial){setTarget(initial);return}const observer=new MutationObserver(()=>{const element=find();if(element){setTarget(element);observer.disconnect()}});observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect()},[]);
 return target?createPortal(<div className="corp-organization-inner" onChange={event=>{const control=event.target;if(control instanceof HTMLSelectElement&&control.name==='organization')control.form?.requestSubmit()}}>{children}</div>,target):null;
}
