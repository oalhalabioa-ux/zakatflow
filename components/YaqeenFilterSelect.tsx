'use client';
import {useEffect,useId,useRef,useState} from 'react';
type Option={value:string;label:string};
/** Custom appearance in Yaqeen only; retain the native control in other themes. */
export default function YaqeenFilterSelect({label,value,options,onChange}:{label:string;value:string;options:Option[];onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false),[active,setActive]=useState(0);
 const root=useRef<HTMLSpanElement>(null),trigger=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
 const selected=Math.max(0,options.findIndex(o=>o.value===value));
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
 const focusOption=(i:number)=>{setActive(i);list.current?.querySelectorAll<HTMLButtonElement>('[role=option]')[i]?.focus()};
 useEffect(()=>{if(open)list.current?.querySelectorAll<HTMLButtonElement>('[role=option]')[selected]?.focus()},[open,selected]);
 const choose=(i:number)=>{onChange(options[i].value);setOpen(false);trigger.current?.focus()};
 return <span ref={root} className="yq-filter-select" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}}>
  <select className="yq-filter-native" aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
  <span className="yq-filter-custom"><button ref={trigger} type="button" className="yq-filter-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setActive(selected);setOpen(!open)}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();setActive(selected);setOpen(true)}}}><span>{options[selected]?.label}</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></button>
  {open&&<div id={id} ref={list} role="listbox" aria-label={label} className="yq-filter-options" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus()}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();focusOption(e.key==='Home'?0:e.key==='End'?options.length-1:(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length)}}}>{options.map((o,i)=><button key={o.value} type="button" role="option" aria-selected={o.value===value} tabIndex={i===active?0:-1} onFocus={()=>setActive(i)} onClick={()=>choose(i)}><span>{o.label}</span>{o.value===value&&<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>}</button>)}</div>}
  </span>
 </span>;
}
