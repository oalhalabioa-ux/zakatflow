"use client";
import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";

export default function AssetActionsMenu({name,ar,children}:{name:string;ar:boolean;children:(close:()=>void)=>ReactNode}){
 const [position,setPosition]=useState<{top:number;left:number}|null>(null);
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{
  if(!position)return;
  panel.current?.querySelector<HTMLElement>('button,a')?.focus();
  const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPosition(null);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPosition(null);trigger.current?.focus();}};
  const reposition=(e:Event)=>{if(!(e.target instanceof Node)||!panel.current?.contains(e.target))setPosition(null);};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
 },[position]);
 const toggle=()=>{
  if(position){setPosition(null);return;}
  const box=trigger.current?.getBoundingClientRect();if(!box)return;
  const width=Math.min(240,window.innerWidth-16);
  setPosition({left:Math.max(8,Math.min(ar?box.right-width:box.left,window.innerWidth-width-8)),top:box.bottom+6});
 };
 return <><button ref={trigger} type="button" className="btn secondary asset-actions-trigger" aria-label={ar?`إجراءات ${name}`:`Actions for ${name}`} title={ar?'الإجراءات':'Actions'} aria-expanded={Boolean(position)} aria-controls={position?id:undefined} aria-haspopup="dialog" onClick={toggle}>⋯</button>{position&&createPortal(<div ref={panel} id={id} dir={ar?'rtl':'ltr'} role="dialog" aria-label={ar?`إجراءات ${name}`:`Actions for ${name}`} className="asset-actions-popover" style={{left:position.left,top:Math.min(position.top,Math.max(8,window.innerHeight-260))}}>{children(()=>setPosition(null))}</div>,document.body)}</>;
}
