'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import OwnerNavigation from './OwnerNavigation';

export default function OwnerSidebar(){
 const [collapsed,setCollapsed]=useState(false);
 useEffect(()=>{try{setCollapsed(localStorage.getItem('yaqeen-owner-sidebar')==='collapsed')}catch{}},[]);
 function toggle(){
  const next=!collapsed;
  setCollapsed(next);
  try{localStorage.setItem('yaqeen-owner-sidebar',next?'collapsed':'expanded')}catch{}
 }
 return <aside className={`owner-sidebar${collapsed?' owner-sidebar-collapsed':''}`} aria-label="إدارة المنصة">
  <div className="owner-brand-row">
   <Link href="/admin" className="owner-original-brand" aria-label="يقين الأعمال — لوحة المالك">
    <img className="owner-full-brand owner-dark-brand" src="/brand/owner/logo-white-gold.png" alt="يقين الأعمال" width="1448" height="1086"/>
    <img className="owner-full-brand owner-light-brand" src="/brand/owner/logo-navy-gold.png" alt="يقين الأعمال" width="1448" height="1086"/>
    <svg className="owner-compact-brand owner-dark-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true"><image href="/brand/sidebar/03_white_gold.png" width="1024" height="1024"/></svg>
    <svg className="owner-compact-brand owner-light-brand" viewBox="273 253 478 517" width="40" height="44" aria-hidden="true"><image href="/brand/owner/icon-navy-gold.png" width="1024" height="1024"/></svg>
   </Link>
   <button type="button" className="owner-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls="owner-sidebar-menu" aria-label={collapsed?'توسيع القائمة الجانبية':'تصغير القائمة الجانبية'}>{collapsed?'⇤':'⇥'}</button>
  </div>
  <div className="owner-menu-title">إدارة المنصة</div>
  <div id="owner-sidebar-menu"><OwnerNavigation variant="sidebar"/></div>
  <div className="owner-foot">لوحة مالك المنصة</div>
 </aside>;
}
