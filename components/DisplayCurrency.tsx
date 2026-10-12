'use client';
import {createContext,useCallback,useContext,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {displayAmount,displayQuote,type DisplayCurrencyMode,type DisplayFxRate} from '../lib/display-currency';
type Scope={currency:string;organizationId?:string;pathname?:string};
type State={mode:DisplayCurrencyMode;setMode:(mode:DisplayCurrencyMode)=>void;scope:Scope;setScope:(scope:Scope)=>void;rates:DisplayFxRate[];today:string;ar:boolean;loading:boolean};
const Context=createContext<State>({mode:'PRIMARY',setMode:()=>{},scope:{currency:'SAR'},setScope:()=>{},rates:[],today:'2026-10-12',ar:true,loading:false});
const storageKey='zf-display-currency';
const noRates:DisplayFxRate[]=[];
export function DisplayCurrencyProvider({children,locale}:{children:ReactNode;locale:string}){
 const pathname=usePathname(),[mode,setModeState]=useState<DisplayCurrencyMode>('PRIMARY'),[scope,setScopeState]=useState<Scope>({currency:'SAR'}),[loadedRates,setRates]=useState<{organizationId?:string;rows:DisplayFxRate[]}>({rows:[]}),[loading,setLoading]=useState(false);
 const setScope=useCallback((next:Scope)=>setScopeState({...next,pathname}),[pathname]);
 const profileCurrency=useRef('SAR');
 const rates=loadedRates.organizationId===scope.organizationId?loadedRates.rows:noRates;
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
 useEffect(()=>{try{setModeState(localStorage.getItem(storageKey)==='USD'?'USD':'PRIMARY')}catch{}const sync=(e:StorageEvent)=>{if(e.key===storageKey)setModeState(e.newValue==='USD'?'USD':'PRIMARY')};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync)},[]);
 useEffect(()=>{const controller=new AbortController();fetch('/api/settings',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(d=>{if(d?.profile?.base_currency){profileCurrency.current=d.profile.base_currency;setScopeState(previous=>previous.pathname?previous:{currency:profileCurrency.current})}}).catch(()=>{});return()=>controller.abort()},[]);
 useEffect(()=>{setScopeState(previous=>previous.pathname===pathname?previous:{currency:profileCurrency.current,pathname})},[pathname]);
 useEffect(()=>{const controller=new AbortController();setRates({rows:[]});if(!scope.organizationId){setLoading(false);return()=>controller.abort()}setLoading(true);fetch(`/api/fx?organization_id=${encodeURIComponent(scope.organizationId)}`,{signal:controller.signal,cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{if(!controller.signal.aborted)setRates({organizationId:scope.organizationId,rows:Array.isArray(rows)?rows:[]})}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[scope.organizationId]);
 const setMode=useCallback((next:DisplayCurrencyMode)=>{setModeState(next);try{localStorage.setItem(storageKey,next)}catch{}},[]);
 const value=useMemo(()=>({mode,setMode,scope,setScope,rates,today,ar:locale==='ar',loading}),[mode,setMode,scope,setScope,rates,today,locale,loading]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function CurrencyScope({currency,organizationId}:{currency:string;organizationId?:string}){
 const {setScope}=useContext(Context),pathname=usePathname();
 useEffect(()=>{setScope({currency:currency.toUpperCase(),organizationId})},[currency,organizationId,setScope,pathname]);return null;
}
export function useDisplayCurrencyCode(currency:string){const {mode,rates,today}=useContext(Context);const result=displayAmount(0,currency,mode,rates,today);return result.currency+(result.missing?' *':'');}
export function useDisplayMoney(){
 const {mode,rates,today}=useContext(Context);
 return (value:unknown,currency='SAR',_locale?:string)=>{const amount=displayAmount(value,currency,mode,rates,today);return amount.value==null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount.value)+' '+amount.currency+(amount.missing?' *':'')};
}
export function Money({value,currency='SAR'}:{value:unknown;currency?:string}){
 const state=useContext(Context),amount=displayAmount(value,currency,state.mode,state.rates,state.today);
 const original=new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(value));
 const title=amount.missing?(state.ar?'سعر التحويل غير متوفر؛ المبلغ بعملته الأصلية':'FX rate unavailable; amount remains in its original currency'):amount.quote?`${original} ${currency} · ${amount.quote.source} · ${amount.quote.date}`:undefined;
 return <span className="display-money" dir="ltr" title={title}>{amount.value==null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount.value)+' '+amount.currency}{amount.missing&&<span aria-label={state.ar?'سعر الصرف غير متوفر':'FX rate unavailable'}> *</span>}</span>;
}
export function CurrencySwitcher(){
 const {mode,setMode,scope,rates,today,ar,loading}=useContext(Context),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 const quote=displayQuote(scope.currency,rates,today),active=mode==='USD'?'USD':scope.currency;
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
 const choose=(next:DisplayCurrencyMode)=>{setMode(next);setOpen(false);trigger.current?.focus()};
 return <div ref={root} className="corp-currency" onPointerEnter={e=>{if(e.pointerType==='mouse')setOpen(true)}} onPointerLeave={e=>{if(e.pointerType==='mouse'&&!root.current?.querySelector('.corp-currency-panel')?.contains(document.activeElement))setOpen(false)}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}if(e.key==='ArrowDown'&&e.target===trigger.current){e.preventDefault();setOpen(true);requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus())}}}>
 <button ref={trigger} type="button" className="corp-currency-trigger" aria-label={ar?`عملة العرض: ${active}`:`Display currency: ${active}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-1-1-5-1-5 1.5s5 1.5 5 4-4 2.5-5 1.5M12 6v12"/></svg><b dir="ltr">{active}</b><span aria-hidden="true">⌄</span></button>
 {open&&<div id={id} className="corp-currency-panel"><strong>{ar?'عملة العرض':'Display currency'}</strong><div role="radiogroup" onKeyDown={e=>{if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'PRIMARY':e.key==='End'?'USD':mode==='PRIMARY'?'USD':'PRIMARY';setMode(next);e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next==='PRIMARY'?0:1]?.focus()}}} aria-label={ar?'اختر عملة العرض':'Choose display currency'}>{(['PRIMARY','USD'] as const).map(option=><button type="button" role="radio" aria-checked={mode===option} key={option} onClick={()=>choose(option)}><span>{option==='PRIMARY'?(ar?'العملة الرئيسية':'Primary currency'):(ar?'الدولار الأمريكي':'US dollar')} <b dir="ltr">{option==='PRIMARY'?scope.currency:'USD'}</b></span><span aria-hidden="true">{mode===option?'✓':''}</span></button>)}</div><small>{ar?'تحويل للعرض فقط؛ الإدخال والفواتير والتصدير بعملتها الأصلية.':'Display conversion only; inputs, invoices and exports retain their original currency.'}</small>{loading?<small role="status">{ar?'جار تحميل سعر الصرف…':'Loading FX rate…'}</small>:quote&&scope.currency!=='USD'?<small dir="ltr">1 {scope.currency} = {new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(quote.rate)} USD<br/>{quote.source} · {quote.date}</small>:scope.currency!=='USD'?<small>{ar?'لا يتوفر سعر تحويل لهذه العملة. تبقى مبالغها الأصلية مع علامة *.':'No FX rate for this currency. Original amounts are marked *.'}</small>:null}<small>{ar?'* تعني عدم توفر سعر؛ لم يتم تحويل المبلغ.':'* means no FX rate; the amount was not converted.'}</small></div>}
 </div>;
}
