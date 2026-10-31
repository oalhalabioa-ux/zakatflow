'use client';
import {ownerTranslator,ownerHref} from '@/lib/i18n/owner';
import type {Locale} from '@/lib/routing';

import Link from 'next/link';
import {useEffect, useState} from 'react';
import OwnerNavigation from './OwnerNavigation';

export default function OwnerSidebar({locale='ar'}:{locale?:Locale}){const translate=ownerTranslator(locale);
 const [collapsed,setCollapsed]=useState(false);
 useEffect(()=>{try{setCollapsed(localStorage.getItem('yaqeen-owner-sidebar')==='collapsed')}catch{}},[]);
 function toggle(){
  const next=!collapsed;
  setCollapsed(next);
  try{localStorage.setItem('yaqeen-owner-sidebar',next?'collapsed':'expanded')}catch{}
 }
 return <aside className={`owner-sidebar${collapsed?' owner-sidebar-collapsed':''}`} aria-label={translate("إدارة المنصة")}>
  {/* Elegant-only color mapping preserves the approved logo artwork and transparent pixels. */}
  <svg className="owner-elegant-logo-defs" width="0" height="0" aria-hidden="true" focusable="false">
   <defs>
    <filter id="owner-elegant-logo-colors" colorInterpolationFilters="sRGB">
     <feColorMatrix type="matrix" values="0.950 0 0 -0.016 0  0 0.197 0 0.447 0  0 0 -0.677 0.550 0  0 0 0 1 0"/>
    </filter>
   </defs>
  </svg>
  <div className="owner-brand-row">
   <Link href={ownerHref('/admin',locale)} className="owner-original-brand" aria-label={translate("يقين الأعمال — لوحة المالك")}>
    <img className="owner-full-brand owner-dark-brand" src="/brand/owner/logo-white-gold.png" alt={translate("يقين الأعمال")} width="1448" height="1086"/>
    <img className="owner-full-brand owner-light-brand" src="/brand/owner/logo-navy-gold.png" alt={translate("يقين الأعمال")} width="1448" height="1086"/>
    <svg className="owner-compact-brand owner-dark-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true"><image href="/brand/sidebar/03_white_gold.png" width="1024" height="1024"/></svg>
    <svg className="owner-compact-brand owner-light-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true"><image href="/brand/owner/icon-navy-gold.png" width="1024" height="1024"/></svg>
   </Link>
   <button type="button" className="owner-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls="owner-sidebar-menu" aria-label={collapsed?translate("توسيع القائمة الجانبية"):translate("تصغير القائمة الجانبية")}>{collapsed?'⇤':'⇥'}</button>
  </div>
  <div className="owner-menu-title">{translate("إدارة المنصة")}</div>
  <div id="owner-sidebar-menu"><OwnerNavigation variant="sidebar" locale={locale}/></div>
  <div className="owner-foot">{translate("لوحة مالك المنصة")}</div>
 </aside>;
}
