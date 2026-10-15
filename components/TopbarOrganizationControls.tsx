'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** Render page-owned scope controls in the shared header without changing their callbacks. */
export default function TopbarOrganizationControls({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{const find=()=>document.getElementById('corp-organization-controls');const initial=find();if(initial){setTarget(initial);return}const observer=new MutationObserver(()=>{const element=find();if(element){setTarget(element);observer.disconnect()}});observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect()},[]);
 return target?createPortal(<div className="corp-organization-inner">{children}</div>,target):null;
}
