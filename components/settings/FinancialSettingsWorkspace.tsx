'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useSettingsOrganization} from './useSettingsOrganization';
import FiscalYearManagement from './FiscalYearManagement';
import SettingsIcon,{type SettingsIconName} from './SettingsIcon';
import FinancialSetupOverview from './FinancialSetupOverview';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
const Chart=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'));
const Posting=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'));
const Opening=dynamic(()=>import('../financial-reports/LiveOpeningBalances'));
const Cash=dynamic(()=>import('../FinancialRegisterWorkspace'));
const financeIcons:Record<string,SettingsIconName>={fiscal:'calendar',chart:'chart',posting:'posting',banking:'bank',opening:'opening'};
const sections=[['fiscal','السنة المالية','Fiscal year'],['chart','دليل الحسابات','Chart of accounts'],['posting','قواعد الترحيل','Posting rules'],['banking','النقد والبنوك','Cash & banks'],['opening','الأرصدة الافتتاحية','Opening balances']] as const;
export default function FinancialSettingsWorkspace({locale,preferredOrg='',initialFiscalEditor=false}:{locale:string;preferredOrg?:string;initialFiscalEditor?:boolean}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg);
 const [fiscalEditor,setFiscalEditor]=useState(initialFiscalEditor);
 const fiscalEdit=useRef({dirty:false,busy:false});
 const onFiscalEdit=useRef((dirty:boolean,busy:boolean)=>{fiscalEdit.current={dirty,busy};}).current;
 function canLeaveFiscal(){return !fiscalEdit.current.busy&&(!fiscalEdit.current.dirty||window.confirm(ar?'تجاهل التغييرات غير المحفوظة؟':'Discard unsaved changes?'));}
 const [tab,setTab]=useState<string>('fiscal'),[readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setReadiness(null);
  const params=new URLSearchParams({organization:ctx.organizationId});
  try{const saved=JSON.parse(localStorage.getItem('yaqeen:financial-setup:v1:'+ctx.organizationId)??'null');if(saved?.mode==='EXISTING'||saved?.mode==='NEW')params.set('mode',saved.mode);}catch{}
  if(ctx.organizationId)fetch('/api/financial-reporting/setup-readiness?'+params,{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(!controller.signal.aborted&&r.organizationId===ctx.organizationId)setReadiness(r);}).catch(()=>{});
  return()=>controller.abort();
 },[ctx.organizationId,revision]);
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'تعذر الوصول إلى المؤسسة.':'Organization unavailable.'}</p>;
 return <section className="settings-finance-native" data-financial-settings>
  <TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={ctx.organizationId} beforeChange={canLeaveFiscal} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>
  <header className="settings-section-heading"><h2>{ar?'الإعدادات المالية والمحاسبية':'Financial & accounting settings'}</h2><p>{ar?'بناء أساس محاسبي موثوق وربط الحسابات بالعمليات والتقارير.':'Configure fiscal years, accounts and posting for reliable reporting.'}</p></header>
  <nav className="settings-local-tabs" aria-label={ar?'الإعدادات المالية التفصيلية':'Financial settings sections'}>{sections.map(([id,a,e])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{if(id!==tab&&!canLeaveFiscal())return;setTab(id);if(id==='fiscal')setFiscalEditor(true);setRevision(v=>v+1);}}><SettingsIcon name={financeIcons[id]}/>{ar?a:e}</button>)}</nav>
  <div className="settings-finance-status">{sections.slice(0,4).map(([id,a,e])=>{const status=readiness?.statuses[id as 'fiscal'],state=status==='READY'?'complete':status==='IN_PROGRESS'?'pending':status?'incomplete':'unverified';return <article key={id} className={'settings-finance-state-'+state}><h3><SettingsIcon name={financeIcons[id]}/>{ar?a:e}</h3><span className={'settings-state '+state}>{!status?(ar?'قيد التحقق':'Checking'):status==='READY'?(ar?'مكتمل':'Complete'):status==='IN_PROGRESS'?(ar?'قيد التنفيذ':'In progress'):(ar?'ناقص':'Incomplete')}</span></article>;})}</div>
  <div className="settings-native-content" key={ctx.organizationId+':'+tab}>
   {tab==='fiscal'&&!fiscalEditor&&<FinancialSetupOverview locale={locale} organization={ctx.organizationId} readiness={readiness} onEdit={id=>{setTab(id);if(id==='fiscal')setFiscalEditor(true);}}/>}
   {tab==='fiscal'&&fiscalEditor&&<button type="button" className="btn secondary" onClick={()=>{if(canLeaveFiscal())setFiscalEditor(false);}}>{ar?'ملخص التأسيس المالي':'Financial setup overview'}</button>}
   {tab==='fiscal'&&fiscalEditor&&<FiscalYearManagement organization={ctx.organizationId} locale={locale} onEditState={onFiscalEdit} onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='chart'&&<Chart locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='posting'&&<Posting locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onEditState={onFiscalEdit} onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='banking'&&<Cash locale={locale} view="cash" initialScope="ORGANIZATION" preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='opening'&&<Opening locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
  </div>
 </section>;
}
