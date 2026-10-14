'use client';
import React,{createContext,useCallback,useContext,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {displayAmount,displayQuote,scopedDisplayRates,type DisplayCurrencyMode,type DisplayFxRate} from '../lib/display-currency';
type Scope={currency:string;organizationId?:string;pathname?:string;explicit?:boolean};
type State={mode:DisplayCurrencyMode;setMode:(mode:DisplayCurrencyMode)=>void;scope:Scope;setScope:(scope:Scope)=>void;rates:DisplayFxRate[];today:string;ar:boolean;loading:boolean};
const Context=createContext<State>({mode:'PRIMARY',setMode:()=>{},scope:{currency:'SAR'},setScope:()=>{},rates:[],today:'2026-10-12',ar:true,loading:false});
const storageKey='zf-display-currency';
const noRates:DisplayFxRate[]=[];
export function DisplayCurrencyProvider({children,locale,initialMode='PRIMARY'}:{children:ReactNode;locale:string;initialMode?:DisplayCurrencyMode}){
 const pathname=usePathname(),[mode,setModeState]=useState<DisplayCurrencyMode>(initialMode),[scope,setScopeState]=useState<Scope>({currency:'SAR'}),[rates,setRates]=useState<DisplayFxRate[]>(noRates),[loading,setLoading]=useState(false);
 const setScope=useCallback((next:Scope)=>setScopeState({...next,pathname,explicit:true}),[pathname]);
 const profileCurrency=useRef('SAR');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
 useEffect(()=>{try{setModeState(localStorage.getItem(storageKey)==='USD'?'USD':'PRIMARY')}catch{}const sync=(e:StorageEvent)=>{if(e.key===storageKey)setModeState(e.newValue==='USD'?'USD':'PRIMARY')};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync)},[]);
 useEffect(()=>{const controller=new AbortController();fetch('/api/settings',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(d=>{if(d?.profile?.base_currency){profileCurrency.current=d.profile.base_currency;setScopeState(previous=>previous.explicit?previous:{...previous,currency:profileCurrency.current})}}).catch(()=>{});return()=>controller.abort()},[]);
 useEffect(()=>{setScopeState(previous=>previous.pathname===pathname?previous:{currency:profileCurrency.current,pathname})},[pathname]);
 useEffect(()=>{const controller=new AbortController();const refresh=()=>{setLoading(true);fetch('/api/display-currency',{signal:controller.signal,cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{if(!controller.signal.aborted)setRates(Array.isArray(rows)?rows:noRates)}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})};refresh();window.addEventListener('zf-fx-rates-updated',refresh);return()=>{controller.abort();window.removeEventListener('zf-fx-rates-updated',refresh)}},[pathname]);
 const setMode=useCallback((next:DisplayCurrencyMode)=>{setModeState(next);try{localStorage.setItem(storageKey,next)}catch{}},[]);
 const value=useMemo(()=>({mode,setMode,scope,setScope,rates,today,ar:locale==='ar',loading}),[mode,setMode,scope,setScope,rates,today,locale,loading]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function CurrencyScope({currency,organizationId}:{currency:string;organizationId?:string}){
 const {setScope}=useContext(Context),pathname=usePathname();
 useEffect(()=>{setScope({currency:currency.toUpperCase(),organizationId})},[currency,organizationId,setScope,pathname]);return null;
}
export function useDisplayCurrencyCode(currency:string){const {mode,rates,today,scope}=useContext(Context);const result=displayAmount(0,currency,mode,scopedDisplayRates(rates,scope.organizationId),today,scope.currency);return result.currency+(result.missing?' *':'');}
export function useDisplayMoney(){
 const {mode,rates,today,scope}=useContext(Context);
 return (value:unknown,currency='SAR',_locale?:string,organizationId?:string|null)=>{const amount=displayAmount(value,currency,mode,scopedDisplayRates(rates,organizationId===undefined?scope.organizationId:organizationId),today,scope.currency);return amount.value==null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount.value)+' '+amount.currency+(amount.missing?' *':'')};
}
export function Money({value,currency='SAR',precision=2,preservePrint=false,organizationId}:{value:unknown;currency?:string;precision?:number;preservePrint?:boolean;organizationId?:string|null}){
 const state=useContext(Context),amount=displayAmount(value,currency,state.mode,scopedDisplayRates(state.rates,organizationId===undefined?state.scope.organizationId:organizationId),state.today,state.scope.currency);
 const original=new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(value));
 const title=amount.missing?(state.ar?'سعر التحويل غير متوفر؛ المبلغ بعملته الأصلية':'FX rate unavailable; amount remains in its original currency'):amount.quote?`${original} ${currency} · ${amount.quote.source} · ${amount.quote.date}`:undefined;
 const formatted=amount.value==null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:Math.min(2,precision),maximumFractionDigits:precision}).format(amount.value)+' '+amount.currency;
 const originalFormatted=value==null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:Math.min(2,precision),maximumFractionDigits:precision}).format(Number(value))+' '+currency;
 return <span className="display-money" dir="ltr" title={title} data-source-value={value==null?undefined:String(value)} data-source-currency={currency} data-display-currency={amount.currency}><span className={preservePrint?'display-money-screen':undefined}>{formatted}{amount.missing&&<span aria-label={state.ar?'سعر التحويل غير متوفر':'FX rate unavailable'}> *</span>}</span>{preservePrint&&<span className="display-money-print">{originalFormatted}</span>}</span>;
}
export function CurrencySwitcher(){
 const {mode,setMode,scope,rates,today,ar,loading}=useContext(Context),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),hovered=useRef(false);
 const quote=displayQuote(scope.currency,scopedDisplayRates(rates,scope.organizationId),today),active=mode==='USD'?'USD':scope.currency;
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
 const choose=(next:DisplayCurrencyMode)=>{setMode(next);setOpen(false);trigger.current?.focus()};
 return <div ref={root} className="corp-currency" onPointerEnter={e=>{if(e.pointerType==='mouse'){hovered.current=true;setOpen(true)}}} onPointerLeave={e=>{hovered.current=false;if(e.pointerType==='mouse'&&!root.current?.querySelector('.corp-currency-panel')?.contains(document.activeElement))setOpen(false)}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}if(e.key==='ArrowDown'&&e.target===trigger.current){e.preventDefault();setOpen(true);requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus())}}}>
 <button ref={trigger} type="button" className="corp-currency-trigger" aria-label={ar?`عملة العرض: ${active}`:`Display currency: ${active}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>hovered.current?true:!v)}><b dir="ltr">{active}</b></button>
 {open&&<div id={id} className="corp-currency-panel"><strong>{ar?'عملة العرض':'Display currency'}</strong><div role="radiogroup" onKeyDown={e=>{if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'PRIMARY':e.key==='End'?'USD':mode==='PRIMARY'?'USD':'PRIMARY';setMode(next);e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next==='PRIMARY'?0:1]?.focus()}}} aria-label={ar?'اختر عملة العرض':'Choose display currency'}>{(['PRIMARY','USD'] as const).map(option=><button type="button" role="radio" aria-checked={mode===option} key={option} onClick={()=>choose(option)}><span>{option==='PRIMARY'?(ar?'العملة الرئيسية':'Primary currency'):(ar?'الدولار الأمريكي':'US dollar')} <b dir="ltr">{option==='PRIMARY'?scope.currency:'USD'}</b></span><span aria-hidden="true">{mode===option?'✓':''}</span></button>)}</div><div className="corp-currency-foot"><span>{ar?'للعرض فقط':'Display only'}</span><span className="corp-currency-info" tabIndex={0} aria-label={ar?'معلومات سعر الصرف':'FX rate information'} title={(ar?'الإدخالات والمستندات تحفظ بعملتها الأصلية. ':'Inputs and documents retain their recorded currency. ')+(quote?`${quote.source} · ${quote.date}`:(ar?'سعر الصرف غير متوفر؛ علامة * تعني بقاء العملة الأصلية.':'FX unavailable; * marks amounts in their original currency.'))}>ⓘ</span></div>{loading?<small role="status">{ar?'تحميل سعر الصرف…':'Loading FX…'}</small>:quote&&scope.currency!=='USD'?<small className="corp-currency-rate" dir="ltr">1 USD = {new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(1/quote.rate)} {scope.currency}</small>:!quote?<small>{ar?'سعر الصرف غير متوفر *':'FX rate unavailable *'}</small>:null}</div>}
 </div>;
}
