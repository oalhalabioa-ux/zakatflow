'use client';
import { useEffect, useState } from 'react';
type Theme = 'yaqeen' | 'elegant' | 'modern' | 'classic';
const themes: {id:Theme;label:string}[]=[{id:'yaqeen',label:'يقين الأساسي'},{id:'elegant',label:'الأنيق'},{id:'modern',label:'العصري'},{id:'classic',label:'الكلاسيكي'}];
export default function OwnerThemeSelector(){
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
 return <label className="owner-theme-label">الثيم <select aria-label="ثيم لوحة المالك" value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{themes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>;
}
