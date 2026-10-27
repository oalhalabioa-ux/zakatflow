'use client';
import { useEffect, useState } from 'react';
type Theme = 'yaqeen' | 'elegant' | 'modern' | 'classic';
const themes: {id:Theme;label:string}[]=[{id:'yaqeen',label:'يقين الأساسي'},{id:'elegant',label:'الأنيق'},{id:'modern',label:'العصري'},{id:'classic',label:'الكلاسيكي'}];
export default function OwnerThemeSelector(){
 const [theme,setTheme]=useState<Theme>('yaqeen');
 useEffect(()=>{const saved=localStorage.getItem('yaqeen-owner-theme');if(themes.some(x=>x.id===saved))setTheme(saved as Theme)},[]);
 useEffect(()=>{document.documentElement.dataset.ownerTheme=theme;localStorage.setItem('yaqeen-owner-theme',theme);return ()=>{delete document.documentElement.dataset.ownerTheme}},[theme]);
 return <label className="owner-theme-label">الثيم <select aria-label="ثيم لوحة المالك" value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{themes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>;
}
