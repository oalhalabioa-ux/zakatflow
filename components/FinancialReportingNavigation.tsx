'use client';
import Link from './WorkspaceLink';
import PersonalLink from 'next/link';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import {usePathname,useSearchParams} from 'next/navigation';
import {useState} from 'react';
export default function FinancialReportingNavigation({locale,statements}:{locale:string;statements:boolean}){
 const ar=locale==='ar',path=usePathname(),screen=useSearchParams().get('screen')??'overview',current=['opening-balances','financial-reports','financial-reporting-policy','chart-of-accounts'].some(p=>path===`/${locale}/${p}`),[open,setOpen]=useState(current);
 const [scope]=useWorkspaceScope();
 const personalReports=[
  ['financial-position','ملخص المركز المالي الشخصي','Personal financial position summary'],
  ['cash-and-banks','النقد والبنوك الشخصية','Personal cash and banks'],
  ['debt-report','كشف الذمم الشخصية','Personal debt statement'],
  ['reports','تقرير الأصول الشخصية','Personal asset report'],
 ];
 const links=[...(statements?[['financial-reports?screen=overview','لوحة التقارير والقوائم المالية','Reports & statements dashboard'],['financial-reports?screen=statements','القوائم المالية','Financial statements'],['financial-reports?screen=income','قائمة الدخل','Income statement'],['financial-reports?screen=position','المركز المالي','Financial position'],['financial-reports?screen=cash-flow','التدفقات النقدية','Cash flow'],['financial-reports?screen=kpis','المؤشرات المالية','Financial indicators']]:[]),['opening-balances','الأرصدة الافتتاحية','Opening balances'],...(statements?[['chart-of-accounts','دليل الحسابات','Chart of accounts'],['financial-reporting-policy','قواعد الترحيل','Posting rules']]:[])];
 const icon=<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 17v-3m4 3v-6m4 6v-4"/></svg>;
 return <><button type="button" className="module-toggle" data-module-current={current||undefined} aria-expanded={open} aria-controls="corp-financial-reporting-nav" onClick={()=>setOpen(v=>!v)}>{icon}<span className="corp-label">{ar?'التقارير والقوائم المالية':'Financial reports & statements'}</span><b className="corp-label">{open?'⌃':'⌄'}</b></button>{open&&<div className="corp-subnav" id="corp-financial-reporting-nav">{scope==='PERSONAL'&&<><Link href={`/${locale}/financial-reports?screen=overview`}>{icon}<span className="corp-label">{ar?'لوحة التقارير المالية المؤسسية':'Business reports & statements'}</span></Link><Link href={`/${locale}/financial-reports?screen=position`}>{icon}<span className="corp-label">{ar?'المركز المالي':'Financial position'}</span></Link>{personalReports.map(([route,arabic,english])=><PersonalLink key={route} href={`/${locale}/${route}?scope=PERSONAL`}>{icon}<span className="corp-label">{ar?arabic:english}</span></PersonalLink>)}</>}{scope==='ORGANIZATION'&&links.map(([route,arabic,english])=><Link key={route} href={`/${locale}/${route}`} aria-current={path===`/${locale}/${route.split('?')[0]}`&&(!route.includes('?')||route.endsWith('='+screen))?'page':undefined}>{icon}<span className="corp-label">{ar?arabic:english}</span></Link>)}</div>}</>;
}
