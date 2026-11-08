'use client';

import {useEffect,useState} from 'react';
import {rememberedOrganization} from '@/lib/workspace-organization';
import Link from 'next/link';
import SettingsIcon from './SettingsIcon';

export default function OrganizationSubnav({locale,organization,active}:{
 locale:string;organization?:string;active:'details'|'structure'|'billing';
}){
 const ar=locale==='ar';
 const [selected,setSelected]=useState(organization??'');
 useEffect(()=>{
  const read=()=>setSelected(new URLSearchParams(window.location.search).get('organization')
    ??rememberedOrganization()??organization??'');
  read();
  window.addEventListener('zf-organization-selection',read);
  window.addEventListener('popstate',read);
  return ()=>{
   window.removeEventListener('zf-organization-selection',read);
   window.removeEventListener('popstate',read);
  };
 },[organization]);
 const prefix=selected?'?organization='+encodeURIComponent(selected):'';
 const sections=[
  {id:'details',path:'settings',ar:'البيانات الأساسية',en:'Organization details'},
  {id:'structure',path:'settings/structure',ar:'الهيكل والفروع',en:'Structure & branches'},
 ] as const;
 return <nav className="settings-subsection-nav"
   aria-label={ar?'أقسام إعدادات المؤسسة':'Organization settings sub-sections'}>
   {sections.map(s=><Link key={s.id} href={`/${locale}/${s.path}${prefix}`}
     aria-current={s.id===active?'page':undefined}><SettingsIcon name={s.id==='details'?'organization':'structure'}/><span>{ar?s.ar:s.en}</span></Link>)}
 </nav>;
}