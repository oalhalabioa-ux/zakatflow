'use client';
import Link from 'next/link';
import OwnerThemeSelector from './OwnerThemeSelector';
import {usePathname} from 'next/navigation';
const sections=[
 {href:'/admin',label:'الرئيسية',symbol:'⌂'},
 {href:'/admin/users',label:'المستخدمون',symbol:'♙'},
 {href:'/admin/companies',label:'الشركات',symbol:'▤'},
 {href:'/admin/subscriptions',label:'الاشتراكات',symbol:'◇'},
 {href:'/admin/payments',label:'المدفوعات',symbol:'▣'},
 {href:'/admin/analytics',label:'التحليلات',symbol:'▥'},
 {href:'/admin/settings',label:'الإعدادات',symbol:'⚙'}
];
export default function OwnerNavigation({variant='tabs'}:{variant?:'tabs'|'sidebar'}){
 const pathname=usePathname();
 return <nav className={variant==='tabs'?'owner-section-nav owner-tabs':'owner-side-links'} aria-label={variant==='tabs'?'تبويبات إدارة المنصة':'القائمة الجانبية لإدارة المنصة'}>
  {sections.map(s=>{const active=pathname===s.href||(s.href!=='/admin'&&pathname.startsWith(s.href+'/'));
   return <Link key={s.href} href={s.href} aria-current={active?'page':undefined} className={active?'selected':undefined}><span className="owner-nav-symbol" aria-hidden="true">{s.symbol}</span><span>{s.label}</span></Link>;
  })}
  {variant==='tabs'&&<div className="owner-tabs-theme"><OwnerThemeSelector/></div>}
 </nav>;
}
