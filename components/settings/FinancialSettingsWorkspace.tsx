'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {useSettingsOrganization} from './useSettingsOrganization';
import FiscalYearManagement from './FiscalYearManagement';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
const Chart=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'));
const Posting=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'));
const Opening=dynamic(()=>import('../financial-reports/LiveOpeningBalances'));
const Cash=dynamic(()=>import('../FinancialRegisterWorkspace'));
const sections=[['fiscal','السنة المالية','Fiscal year'],['chart','دليل الحسابات','Chart of accounts'],['posting','قواعد الترحيل','Posting rules'],['banking','النقد والبنوك','Cash & banks'],['opening','الأرصدة الافتتاحية','Opening balances']] as const;
export default function FinancialSettingsWorkspace({locale,preferredOrg=''}:{locale:string;preferredOrg?:string}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg);
 const [tab,setTab]=useState<string>('fiscal'),[readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setReadiness(null);
  if(ctx.organizationId)fetch('/api/financial-reporting/setup-readiness?'+new URLSearchParams({organization:ctx.organizationId,mode:'EXISTING'}),{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(!controller.signal.aborted&&r.organizationId===ctx.organizationId)setReadiness(r);}).catch(()=>{});
  return()=>controller.abort();
 },[ctx.organizationId,revision]);
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'تعذر الوصول إلى المؤسسة.':'Organization unavailable.'}</p>;
 return <section className="settings-finance-native" data-financial-settings>
  <TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={ctx.organizationId} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>
  <header className="settings-section-heading"><h2>{ar?'الإعدادات المالية والمحاسبية':'Financial & accounting settings'}</h2><p>{ar?'بناء أساس محاسبي موثوق وربط الحسابات بالعمليات والتقارير.':'Configure fiscal years, accounts and posting for reliable reporting.'}</p></header>
  <nav className="settings-local-tabs" aria-label={ar?'الإعدادات المالية التفصيلية':'Financial settings sections'}>{sections.map(([id,a,e])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{setTab(id);setRevision(v=>v+1);}}>{ar?a:e}</button>)}</nav>
  <div className="settings-finance-status">{sections.slice(0,4).map(([id,a,e])=><button type="button" key={id} onClick={()=>setTab(id)}><strong>{ar?a:e}</strong><span className={'settings-state '+(readiness?.statuses[id as 'fiscal']==='READY'?'complete':'pending')}>{!readiness?(ar?'لم يتم التحقق':'Not verified'):readiness.statuses[id as 'fiscal']==='READY'?(ar?'مكتمل':'Complete'):(ar?'بحاجة إلى إعداد':'Needs setup')}</span></button>)}</div>
  <div className="settings-native-content" key={ctx.organizationId+':'+tab}>
   {tab==='fiscal'&&<FiscalYearManagement organization={ctx.organizationId} locale={locale} onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='chart'&&<Chart locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='posting'&&<Posting locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='banking'&&<Cash locale={locale} view="cash" initialScope="ORGANIZATION" preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='opening'&&<Opening locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
  </div>
 </section>;
}
