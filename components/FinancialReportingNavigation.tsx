'use client';
import Link from './WorkspaceLink';
import PersonalLink from 'next/link';
import {useWorkspaceScope} from '../hooks/useWorkspaceScope';
import {usePathname,useSearchParams} from 'next/navigation';
import {useState} from 'react';
type ReportIcon='dashboard'|'statements'|'income'|'position'|'cash'|'kpis'|'opening'|'chart'|'rules'|'debts'|'assets';
function ReportNavIcon({kind}:{kind:ReportIcon}){
 const paths:Record<ReportIcon,React.ReactNode>={
  dashboard:<><path d="M3 3v18h18"/><path d="M7 17v-5h3v5m3 0V7h3v10m2 0V10h3v7"/></>,
  statements:<><rect x="4" y="3" width="14" height="17" rx="1"/><path d="M8 8h6M8 12h6M8 16h6M18 7h3v14H8"/></>,
  income:<><path d="M3 20V4M3 20h18M6 16l5-6 4 3 6-8M16 5h5v5"/></>,
  position:<><path d="M12 3v18M5 21h14M3 8h18M6 8l-4 8h8l-4-8ZM18 8l-4 8h8l-4-8Z"/></>,
  cash:<><path d="M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4"/></>,
  kpis:<><path d="M4 19a9 9 0 1 1 16 0M12 13l5-5M3 20h18"/><circle cx="12" cy="13" r="1"/></>,
  opening:<><path d="M4 3h12l4 4v14H4zM16 3v5h4M8 13h8M8 17h8"/><path d="m8 8 2 2 3-3"/></>,
  chart:<><rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="11" width="7" height="5" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><path d="M10 5.5h7.5v5.5M17.5 16v3h-7.5"/></>,
  rules:<><path d="M5 4v16M5 7h9M5 17h9M14 5v4m-2-2h4M14 15v4m-2-2h4"/></>,
  debts:<><circle cx="8" cy="8" r="3"/><path d="M2 20v-3a6 6 0 0 1 12 0v3M16 8h6M16 13h6M17 18h5"/></>,
  assets:<><path d="M3 21h18M5 21V6h14v15M9 10h2m2 0h2m-6 4h2m2 0h2M9 21v-4h6v4"/></>,
 };
 return <svg data-financial-nav-icon={kind} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function routeIcon(route:string):ReportIcon{
 if(route.includes('screen=overview'))return 'dashboard';
 if(route.includes('screen=statements'))return 'statements';
 if(route.includes('screen=income'))return 'income';
 if(route.includes('screen=position')||route==='financial-position')return 'position';
 if(route.includes('screen=cash-flow')||route==='cash-and-banks')return 'cash';
 if(route.includes('screen=kpis'))return 'kpis';
 if(route==='opening-balances')return 'opening';
 if(route==='chart-of-accounts')return 'chart';
 if(route==='financial-reporting-policy')return 'rules';
 if(route==='debt-report')return 'debts';
 return 'assets';
}
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
 const icon=<ReportNavIcon kind="dashboard"/>;
 return <><button type="button" className="module-toggle" data-module-current={current||undefined} aria-expanded={open} aria-controls="corp-financial-reporting-nav" onClick={()=>setOpen(v=>!v)}>{icon}<span className="corp-label">{ar?'التقارير والقوائم المالية':'Financial reports & statements'}</span><b className="corp-label">{open?'⌃':'⌄'}</b></button>{open&&<div className="corp-subnav" id="corp-financial-reporting-nav">{scope==='PERSONAL'&&<>{statements&&<><PersonalLink href={`/${locale}/financial-reports?scope=PERSONAL`}><ReportNavIcon kind="statements"/><span className="corp-label">{ar?'القوائم المالية الشخصية':'Personal financial statements'}</span></PersonalLink><Link href={`/${locale}/financial-reports?screen=overview`}><ReportNavIcon kind="dashboard"/><span className="corp-label">{ar?'لوحة التقارير المالية المؤسسية':'Business reports & statements'}</span></Link><Link href={`/${locale}/financial-reports?screen=position`}><ReportNavIcon kind="position"/><span className="corp-label">{ar?'المركز المالي':'Financial position'}</span></Link></>}{personalReports.map(([route,arabic,english])=><PersonalLink key={route} href={`/${locale}/${route}?scope=PERSONAL`}><ReportNavIcon kind={routeIcon(route)}/><span className="corp-label">{ar?arabic:english}</span></PersonalLink>)}</>}{scope==='ORGANIZATION'&&links.map(([route,arabic,english])=><Link key={route} href={`/${locale}/${route}`} aria-current={path===`/${locale}/${route.split('?')[0]}`&&(!route.includes('?')||route.endsWith('='+screen))?'page':undefined}><ReportNavIcon kind={routeIcon(route)}/><span className="corp-label">{ar?arabic:english}</span></Link>)}</div>}</>;
}
