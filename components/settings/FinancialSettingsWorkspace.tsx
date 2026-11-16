'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useSettingsOrganization} from './useSettingsOrganization';
import FiscalYearManagement from './FiscalYearManagement';
import SettingsIcon,{type SettingsIconName} from './SettingsIcon';
import FinancialSetupOverview from './FinancialSetupOverview';
import type {FinancialSetupReadiness,FinancialSetupCardKey,FinancialSourceCheckId,FinancialSourceCheckStatus} from '@/lib/financial-setup-readiness';
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
 'opening.mode':['نوع البداية محدد','Starting mode selected'],
 'opening.source':['مصدر الأرصدة الافتتاحية متاح','Opening balance source available'],
 'opening.verified':['الافتتاحي معتمد أو صفر موثّق','Opening approved or verified zero'],
};
export default function FinancialSettingsWorkspace({locale,preferredOrg='',initialFiscalEditor=false}:{locale:string;preferredOrg?:string;initialFiscalEditor?:boolean}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg);
 const fiscalEdit=useRef({dirty:false,busy:false});
 const onFiscalEdit=useRef((dirty:boolean,busy:boolean)=>{fiscalEdit.current={dirty,busy};}).current;
 function canLeaveFiscal(){return !fiscalEdit.current.busy&&(!fiscalEdit.current.dirty||window.confirm(ar?'تجاهل التغييرات غير المحفوظة؟':'Discard unsaved changes?'));}

 const [tab,setTab]=useState<string>(initialFiscalEditor?'fiscal':'summary'),[readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null),[readinessError,setReadinessError]=useState(false),[revision,setRevision]=useState(0);
 const [selectedCard,setSelectedCard]=useState<FinancialSetupCardKey|null>(null);
 useEffect(()=>{setSelectedCard(null);},[ctx.organizationId]);
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

  <div className="settings-finance-status"
   aria-label={ar?'حالة التأسيس المالي':'Financial setup readiness'}>{
   sections.filter(([id])=>id!=='summary').map(([id,a,e])=>{
    const section=id as FinancialSetupCardKey,status=readiness?.statuses[section];
    const checks=readiness?.sourceChecks?.[section],unavailable=Boolean(checks?.length&&checks.every(c=>c.status==='UNAVAILABLE'));
    const state=unavailable?'unverified':status==='READY'?'complete':status==='IN_PROGRESS'?'pending':status==='NOT_STARTED'?'incomplete':status==='BLOCKED'?'blocked':'unverified';
    const stateLabel=unavailable?(ar?'تعذر التحقق':'Unavailable'):!status?(readinessError?(ar?'تعذر التحقق':'Unavailable'):(ar?'قيد التحقق':'Checking')):status==='READY'?(ar?'مكتمل':'Complete'):status==='IN_PROGRESS'?(ar?'قيد التنفيذ':'In progress'):status==='BLOCKED'?(ar?'يحتاج استكمال':'Needs attention'):(ar?'لم يبدأ':'Not started');
    const dots:(FinancialSourceCheckStatus|'UNVERIFIED')[]=status==='NOT_STARTED'?(checks?.map(()=>'UNVERIFIED')??Array<FinancialSourceCheckStatus|'UNVERIFIED'>(3).fill('UNVERIFIED')):(checks?.map(check=>check.status)??Array<FinancialSourceCheckStatus|'UNVERIFIED'>(section==='chart'||section==='banking'?2:3).fill('UNVERIFIED'));
    const selected=selectedCard===section;
    const summary=section==='fiscal'?(ar?'تحديد السنة وحالتها':'Year and fiscal period'):section==='chart'?(ar?'هيكل الحسابات وتصنيفها':'Account structure'):section==='posting'?(ar?'ربط العمليات بالحسابات':'Posting policy mappings'):section==='banking'?(ar?'الحسابات البنكية والنقدية':'Cash and bank accounts'):(ar?'اعتماد أرصدة بداية السنة':'Verify start-of-year balances');
    return <article key={id} data-financial-section={id} data-source-status={status??'UNVERIFIED'}>
     <button type="button" className="settings-finance-card-trigger" aria-expanded={selected} aria-controls="settings-finance-source-timeline"
      onClick={()=>setSelectedCard(previous=>previous===section?null:section)} aria-label={ar?a:e}>
      <SettingsIcon name={financeIcons[id]}/>
      <strong className="settings-finance-card-name">{ar?a:e}</strong>
      <span className="settings-finance-card-summary">{summary}</span>
      <span className="settings-progress-track" aria-hidden="true">{
       dots.map((dot,index)=><span key={index} className="settings-progress-unit">
        {index>0&&<span className={'settings-progress-link '+(dots[index-1]==='MET'&&dot==='MET'?'complete':dots[index-1]==='MET'?'pending':'neutral')}/>}
        <span className={'settings-progress-node '+dot.toLowerCase()}>{dot==='MET'?'✓':dot==='UNAVAILABLE'?'–':''}</span>
       </span>)
      }</span>
      <span className={'settings-finance-progress-label '+state}>{stateLabel}</span>
     </button>
    </article>;
   })
  }</div>
  {selectedCard&&<section id="settings-finance-source-timeline" className="settings-finance-compact-timeline"
   aria-label={ar?'تفاصيل متطلبات الجاهزية':'Readiness requirement details'}>
   <strong className="settings-finance-timeline-heading">{ar?'تفاصيل ':'Details: '}{ar?sections.find(([id])=>id===selectedCard)?.[1]:sections.find(([id])=>id===selectedCard)?.[2]}</strong>
   <div className="settings-finance-timeline-steps" role="list">
    {(readiness?.sourceChecks?.[selectedCard]??[]).map((check,index)=>{
     const sourceStatus=readiness?.statuses[selectedCard]==='NOT_STARTED'?'UNVERIFIED':check.status;
     const title=check.id==='opening.verified'&&readiness?.mode==='NEW'?['التحقق من عدم وجود أرصدة سابقة','Verified zero opening balances']:sourceCheckLabels[check.id];
     const explanation=sourceStatus==='MET'?(ar?'متحقق':'Verified'):sourceStatus==='MISSING'?(ar?'يحتاج استكمال':'Needs completion'):sourceStatus==='UNAVAILABLE'?(ar?'تعذر التحقق من المصدر':'Source unavailable'):(ar?'لم يبدأ':'Not started');
     return <div className="settings-finance-timeline-step" role="listitem" data-source-check={check.id} data-check-status={sourceStatus} key={check.id}>
      <span className={'settings-finance-timeline-node '+sourceStatus.toLowerCase()} aria-hidden="true">{sourceStatus==='MET'?'✓':index+1}</span>
      <span className="settings-finance-timeline-name">{title[ar?0:1]}</span>
      <span className="settings-finance-timeline-explanation">{explanation}</span>
     </div>;
    })}
    {!readiness?.sourceChecks?.[selectedCard]?.length&&<p role="status">{readinessError?(ar?'تعذر التحقق من المتطلبات':'Could not verify requirements'):(ar?'جارٍ قراءة المتطلبات…':'Loading requirements…')}</p>}
   </div>
  </section>}
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
