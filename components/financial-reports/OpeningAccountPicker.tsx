'use client';

import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

export type OpeningAccountOption = {code:string;label:string};

type MenuPosition = {top:number;left:number;width:number;maxHeight:number;placement:'above'|'below'};

/** Keep every option within the visible browser viewport, including when Windows reserves a taskbar. */
export function openingAccountMenuPosition(
 rect:Pick<DOMRect,'top'|'bottom'|'left'|'right'|'width'>,
 viewport:{width:number;height:number},
 optionCount:number,
):MenuPosition {
 const margin=12, gap=5, availableBelow=Math.max(0,viewport.height-rect.bottom-margin-gap);
 const availableAbove=Math.max(0,rect.top-margin-gap);
 const desiredHeight=Math.min(350,Math.max(56,optionCount*43+10));
 const placement:MenuPosition['placement']=availableBelow>=desiredHeight||availableBelow>=availableAbove?'below':'above';
 const available=placement==='below'?availableBelow:availableAbove;
 const maxHeight=Math.max(0,Math.min(desiredHeight,available));
 const width=Math.min(Math.max(rect.width,300),Math.max(120,viewport.width-2*margin));
 return {
  placement,
  top:placement==='below'?rect.bottom+gap:Math.max(margin,rect.top-gap-maxHeight),
  left:Math.max(margin,Math.min(rect.left,viewport.width-margin-width)),
  width,
  maxHeight,
 };
}

export default function OpeningAccountPicker({options,value,onChange,disabled,label,en}:{
 options:OpeningAccountOption[];value:string;onChange:(code:string)=>void;disabled?:boolean;label:string;en:boolean;
}){
 const button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const[open,setOpen]=useState(false),[position,setPosition]=useState<MenuPosition|null>(null),[active,setActive]=useState(0);
 const listId='opening-accounts-'+useId();
 const selected=options.find(o=>o.code===value);
 const measure=useCallback(()=>{
  const bounds=button.current?.getBoundingClientRect();if(!bounds)return;
  const viewport=window.visualViewport;
  const next=openingAccountMenuPosition(bounds,{width:viewport?.width??window.innerWidth,height:viewport?.height??window.innerHeight},options.length);
  setPosition(previous=>previous&&Object.keys(next).every(key=>previous[key as keyof MenuPosition]===next[key as keyof MenuPosition])?previous:next);
 },[options.length]);
 const show=()=>{setActive(Math.max(0,options.findIndex(o=>o.code===value)));measure();setOpen(true)};
 const hide=()=>setOpen(false);
 const choose=(option:OpeningAccountOption)=>{onChange(option.code);hide();button.current?.focus()};
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!button.current?.contains(event.target as Node)&&!menu.current?.contains(event.target as Node))hide()};
  const reposition=()=>measure();
  document.addEventListener('pointerdown',outside);
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,{capture:true,passive:true});
  window.visualViewport?.addEventListener('resize',reposition);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);window.visualViewport?.removeEventListener('resize',reposition)};
 },[open,measure]);
 useEffect(()=>{
  if(open)menu.current?.querySelector<HTMLElement>(`[data-account-index="${active}"]`)?.scrollIntoView({block:'nearest'});
 },[active,open]);
 function keyboard(event:React.KeyboardEvent<HTMLButtonElement>){
  if(event.key==='Escape'&&open){event.preventDefault();hide();return}
  if(event.key==='Tab'){hide();return}
  if(!['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key))return;
  event.preventDefault();
  if(!open){show();return}
  if(event.key==='Enter'||event.key===' '){if(options[active])choose(options[active]);return}
  if(event.key==='Home')setActive(0);
  else if(event.key==='End')setActive(Math.max(0,options.length-1));
  else setActive(index=>(index+(event.key==='ArrowDown'?1:-1)+options.length)%Math.max(1,options.length));
 }
 return <>
  <button ref={button} type="button" role="combobox" className="ob-account-picker" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} aria-activedescendant={open?listId+'-'+active:undefined} onKeyDown={keyboard} onClick={()=>open?hide():show()}>
   <span dir="auto">{selected?selected.code+' · '+selected.label:(en?'Choose account':'اختر الحساب')}</span><span className="ob-account-caret" aria-hidden="true">▾</span>
  </button>
  {open&&position&&typeof document!=='undefined'&&createPortal(<div ref={menu} id={listId} className="ob-account-menu" role="listbox" aria-label={label} dir={en?'ltr':'rtl'} data-placement={position.placement} style={{position:'fixed',top:position.top,left:position.left,width:position.width,maxHeight:position.maxHeight,zIndex:100000}}>
   {options.map((option,index)=><button key={option.code} id={listId+'-'+index} data-account-index={index} type="button" role="option" aria-selected={option.code===value} className={index===active?'is-active':''} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)}><bdi>{option.code} · {option.label}</bdi></button>)}
  </div>,document.body)}
 </>;
}
