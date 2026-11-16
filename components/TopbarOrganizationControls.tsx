'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** Render page-owned scope controls in the shared header without changing their callbacks. */
export default function TopbarOrganizationControls({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  const syncTarget=()=>setTarget(document.getElementById('corp-organization-controls'));
  syncTarget();
  // The navigation can remount when its suspense boundary refreshes.
  const observer=new MutationObserver(syncTarget);
  observer.observe(document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[]);
 return target?createPortal(<div className="corp-organization-inner">{children}</div>,target):null;
}
