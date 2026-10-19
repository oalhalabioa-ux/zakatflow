'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** One form, one set of controls; only its position changes with the theme. */
export default function DashboardActionBridge({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{const shell=document.querySelector('.corp-shell');if(!shell)return;const sync=()=>setTarget(shell.classList.contains('theme-yaqeen-business')?document.getElementById('yql-main-action-slot'):null);sync();const observer=new MutationObserver(sync);observer.observe(shell,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect()},[]);
 return target?createPortal(children,target):children;
}
