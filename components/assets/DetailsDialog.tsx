'use client';
import {useEffect,useRef,type ReactNode} from 'react';
export default function DetailsDialog({children,onClose,label,className}:{children:ReactNode;onClose:()=>void;label:string;className?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();return()=>{dialog.close();document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className={className?`asset-details-dialog ${className}`:"asset-details-dialog"} aria-label={label} onCancel={e=>{e.preventDefault();if(!ref.current?.querySelector('[aria-busy="true"]'))onClose();}}>{children}</dialog>;
}
