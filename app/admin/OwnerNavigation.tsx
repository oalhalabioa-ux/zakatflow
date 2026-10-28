'use client';
import Link from 'next/link';
import OwnerThemeSelector from './OwnerThemeSelector';
import {usePathname} from 'next/navigation';
import { LayoutDashboard, UsersRound, Building2, CreditCard, WalletCards, ChartNoAxesCombined, Settings2 } from 'lucide-react';
const sections=[
 {href:'/admin',label:'الرئيسية',Icon:LayoutDashboard},
 {href:'/admin/users',label:'المستخدمون',Icon:UsersRound},
 {href:'/admin/companies',label:'الشركات',Icon:Building2},
 {href:'/admin/subscriptions',label:'الاشتراكات',Icon:CreditCard},
 {href:'/admin/payments',label:'المدفوعات',Icon:WalletCards},
 {href:'/admin/analytics',label:'التحليلات',Icon:ChartNoAxesCombined},
 {href:'/admin/settings',label:'الإعدادات',Icon:Settings2}
];
export default function OwnerNavigation({variant='tabs'}:{variant?:'tabs'|'sidebar'}){
 const pathname=usePathname();
 return <nav className={variant==='tabs'?'owner-section-nav owner-tabs':'owner-side-links'} aria-label={variant==='tabs'?'تبويبات إدارة المنصة':'القائمة الجانبية لإدارة المنصة'}>
  {sections.map(s=>{const active=pathname===s.href||(s.href!=='/admin'&&pathname.startsWith(s.href+'/'));
   return <Link key={s.href} href={s.href} aria-current={active?'page':undefined} className={active?'selected':undefined}><s.Icon className="owner-nav-symbol" size={17} strokeWidth={1.8} aria-hidden="true"/><span>{s.label}</span></Link>;
  })}
  {variant==='tabs'&&<div className="owner-tabs-theme"><OwnerThemeSelector/></div>}
 </nav>;
}
