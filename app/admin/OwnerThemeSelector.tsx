'use client';
import {ownerTranslator,ownerHref} from '@/lib/i18n/owner';
import type {Locale} from '@/lib/routing';

import { useEffect, useState } from 'react';
type Theme = 'yaqeen' | 'elegant' | 'modern' | 'classic';
const themes: {id:Theme;label:string}[]=[{id:'yaqeen',label:'يقين الأساسي'},{id:'elegant',label:'الأنيق'},{id:'modern',label:'العصري'},{id:'classic',label:'الكلاسيكي'}];
export default function OwnerThemeSelector({locale='ar'}:{locale?:Locale}){const translate=ownerTranslator(locale);
 const [theme,setTheme]=useState<Theme>('yaqeen');
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  try {
   const saved=localStorage.getItem('yaqeen-owner-theme');
   if(themes.some(x=>x.id===saved))setTheme(saved as Theme);
  } catch { /* Keep the default when browser storage is unavailable. */ }
  setReady(true);
 },[]);
 useEffect(()=>{
  if(!ready)return;
  document.documentElement.dataset.ownerTheme=theme;
  try { localStorage.setItem('yaqeen-owner-theme',theme); } catch { /* Theme remains usable without storage. */ }
 },[theme,ready]);
 useEffect(()=>()=>{delete document.documentElement.dataset.ownerTheme},[]);
 return <div className="owner-theme-picker" role="group" aria-label={translate("ثيم لوحة المالك")}>
  {themes.map(t=><button key={t.id} type="button" className={theme===t.id?'active':undefined} aria-label={translate(t.label)} title={translate(t.label)} aria-pressed={theme===t.id} onClick={()=>setTheme(t.id)}>
   <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {t.id==='yaqeen'?<><path d="M4 19V9l5 3V5l5 4V2l6 4v13H4Z"/><path d="M4 22h16"/></>:t.id==='elegant'?<><path d="m3 9 5-6h8l5 6-9 12L3 9Zm0 0h18M8 3l4 18 4-18"/></>:t.id==='modern'?<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>:<><path d="m3 8 9-5 9 5H3Zm2 3v7m7-7v7m7-7v7M3 21h18"/></>}
   </svg>
  </button>)}
 </div>;
}
