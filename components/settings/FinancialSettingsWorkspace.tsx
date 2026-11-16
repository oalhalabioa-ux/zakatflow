'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useSettingsOrganization} from './useSettingsOrganization';
import FiscalYearManagement from './FiscalYearManagement';
import SettingsIcon,{type SettingsIconName} from './SettingsIcon';
import FinancialSetupOverview from './FinancialSetupOverview';
import type {FinancialSetupReadiness,FinancialSetupCardKey,FinancialSourceCheckId} from '@/lib/financial-setup-readiness';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
const Chart=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'));
const Posting=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'));
const Opening=dynamic(()=>import('../financial-reports/LiveOpeningBalances'));
const Cash=dynamic(()=>import('../FinancialRegisterWorkspace'));
const financeIcons:Record<string,SettingsIconName>={summary:'opening',fiscal:'calendar',chart:'chart',posting:'posting',banking:'bank',opening:'opening-progress'};
const sections=[['summary','ملخص التأسيس المالي','Financial setup overview'],['fiscal','السنة المالية','Fiscal year'],['chart','دليل الحسابات','Chart of accounts'],['posting','قواعد الترحيل','Posting rules'],['banking','النقد والبنوك','Cash & banks'],['opening','الأرصدة الافتتاحية','Opening balances']] as const;
const sourceCheckLabels:Record<FinancialSourceCheckId,[string,string]>={
 'fiscal.calendar':['تقويم السنة محفوظ','Fiscal calendar saved'],
 'fiscal.period':['الفترة المالية محددة','Fiscal period calculated'],
 'fiscal.retained':['حساب الأرباح المحتجزة صالح','Retained earnings account verified'],
 'chart.readable':['تمت قراءة دليل الحسابات','Chart source available'],
 'chart.equity':['الحساب المرجعي 3300 نشط','Reference equity account 3300 active'],
 'posting.approved':['السياسة معتمدة','Posting policy approved'],
 'posting.rules':['قواعد الترحيل موجودة','Posting rules present'],
 'posting.coverage':['قواعد معتمدة وتغطية المصادر صحيحة','Approved rules and source coverage valid'],
 'banking.readable':['تمت قراءة مصدر النقد والبنوك','Cash and bank source available'],
 'banking.active':['حساب نقدي أو بنكي نشط موجود','Active cash or bank account found'],
};
export default function FinancialSettingsWorkspace({locale,preferredOrg='',initialFiscalEditor=false}:{locale:string;preferredOrg?:string;initialFiscalEditor?:boolean}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg);
 const fiscalEdit=useRef({dirty:false,busy:false});
 const onFiscalEdit=useRef((dirty:boolean,busy:boolean)=>{fiscalEdit.current={dirty,busy};}).current;
 function canLeaveFiscal(){return !fiscalEdit.current.busy&&(!fiscalEdit.current.dirty||window.confirm(ar?'تجاهل التغييرات غير المحفوظة؟':'Discard unsaved changes?'));}
 const [tab,setTab]=useState<string>(initialFiscalEditor?'fiscal':'summary'),[readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null),[readinessError,setReadinessError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setReadiness(null);setReadinessError(false);
  const params=new URLSearchParams({organization:ctx.organizationId});
  try{const saved=JSON.parse(localStorage.getItem('yaqeen:financial-setup:v1:'+ctx.organizationId)??'null');if(saved?.mode==='EXISTING'||saved?.mode==='NEW')params.set('mode',saved.mode);}catch{}
  if(ctx.organizationId)fetch('/api/financial-reporting/setup-readiness?'+params,{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(!controller.signal.aborted&&r.organizationId===ctx.organizationId)setReadiness(r);}).catch(()=>{if(!controller.signal.aborted)setReadinessError(true);});
  return()=>controller.abort();
 },[ctx.organizationId,revision]);
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'تعذر الوصول إلى المؤسسة.':'Organization unavailable.'}</p>;
 return <section className="settings-finance-native" data-financial-settings>
  <TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={ctx.organizationId} beforeChange={canLeaveFiscal} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>
  <header className="settings-section-heading"><h2>{ar?'الإعدادات المالية والمحاسبية':'Financial & accounting settings'}</h2><p>{ar?'بناء أساس محاسبي موثوق وربط الحسابات بالعمليات والتقارير.':'Configure fiscal years, accounts and posting for reliable reporting.'}</p></header>
  <nav className="settings-local-tabs settings-finance-journey-tabs" aria-label={ar?'الإعدادات المالية التفصيلية':'Financial settings sections'}>{sections.map(([id,a,e])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{if(id!==tab&&!canLeaveFiscal())return;setTab(id);setRevision(v=>v+1);}}><SettingsIcon name={financeIcons[id]}/><span>{ar?a:e}</span></button>)}</nav>
  <div className="settings-finance-status" aria-label={ar?'حالة التأسيس المالي':'Financial setup readiness'}>{sections.filter(([id])=>['fiscal','chart','posting','banking'].includes(id)).map(([id,a,e])=>{const status=readiness?.statuses[id as 'fiscal'],state=status==='READY'?'complete':status==='IN_PROGRESS'?'pending':status==='NOT_STARTED'?'incomplete':status==='BLOCKED'?'blocked':'unverified';const stateLabel=!status?(readinessError?(ar?'تعذر التحقق':'Unavailable'):(ar?'قيد التحقق':'Checking')):status==='READY'?(ar?'مكتمل':'Complete'):status==='IN_PROGRESS'?(ar?'قيد التنفيذ':'In progress'):status==='BLOCKED'?(ar?'يحتاج استكمال':'Needs attention'):(ar?'لم يبدأ':'Not started');const checks=readiness?.sourceChecks?.[id as FinancialSetupCardKey];return <article key={id} data-financial-section={id} data-source-status={status??'UNVERIFIED'} className={'settings-finance-state-'+state}><SettingsIcon name={financeIcons[id]}/><h3>{ar?a:e}</h3><p>{id==='fiscal'?(ar?'تحديد الفترة المالية وحالتها':'Fiscal period and status'):id==='chart'?(ar?'إعداد هيكل الحسابات وتصنيفاتها':'Set up account structure'):id==='posting'?(ar?'ضبط قواعد الترحيل المحاسبي':'Configure posting rules'):(ar?'إعداد الحسابات البنكية والنقدية':'Configure bank and cash accounts')}</p>
  {checks?.length?<ul className="settings-finance-checks" aria-label={ar?'فحص المتطلبات من مصادر النظام':'Source-backed checks'}>{
   checks.map(check=>{
    const label=sourceCheckLabels[check.id],message=check.status==='MET'?(ar?'متحقق':'Met'):check.status==='MISSING'?(ar?'غير مكتمل':'Incomplete'):(ar?'تعذر التحقق':'Unavailable');
    return <li key={check.id} data-source-check={check.id} data-check-status={check.status} title={message}>
     <span aria-hidden="true" className="settings-finance-check-marker">{check.status==='MET'?'✓':check.status==='MISSING'?'•':'–'}</span>
     <span>{label[ar?0:1]}</span><span className="settings-sr-only">{message}</span>
    </li>;
   })
  }</ul>:null}
  <div className={'settings-progress-track '+state} aria-hidden="true"><span/><span/><span/></div><span className={'settings-finance-progress-label '+state}>{stateLabel}</span></article>;})}</div>
  {readinessError&&<div className="settings-finance-readiness-error" role="alert">
   <span>{ar?'تعذر قراءة حالة التأسيس المالي. لم تُحتسب أي متطلبات على أنها مكتملة.':'Unable to read financial setup readiness. No requirement has been assumed complete.'}</span>
   <button type="button" className="settings-compact-action" onClick={()=>setRevision(v=>v+1)}>{ar?'إعادة التحقق':'Retry checks'}</button>
  </div>}
  {readiness&&<p className="settings-finance-evidence-note">{ar?'هذه مؤشرات مستمدة من مصادر المؤسسة، ولا تُعد اعتمادًا محاسبيًا أو ضريبيًا.':'These indicators come from organization sources; they are not accounting or tax certification.'}</p>}
  <div className="settings-native-content" key={ctx.organizationId+':'+tab}>
   {tab==='summary'&&<FinancialSetupOverview locale={locale} organization={ctx.organizationId} readiness={readiness} onEdit={id=>{setTab(id);}}/>}
   {tab==='fiscal'&&<FiscalYearManagement organization={ctx.organizationId} locale={locale} onEditState={onFiscalEdit} onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='chart'&&<Chart locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='posting'&&<Posting locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onEditState={onFiscalEdit} onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='banking'&&<Cash locale={locale} view="cash" initialScope="ORGANIZATION" preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
   {tab==='opening'&&<Opening locale={locale} preferredOrg={ctx.organizationId} setupEmbedded onSaved={()=>setRevision(v=>v+1)}/>}
  </div>
 </section>;
}
