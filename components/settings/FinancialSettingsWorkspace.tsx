'use client';
import dynamic from 'next/dynamic';
import {createPortal} from 'react-dom';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
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
 const modalCloseRef=useRef<HTMLButtonElement|null>(null);
 const modalCardRef=useRef<HTMLElement|null>(null);
 const sourceCardRef=useRef<HTMLButtonElement|null>(null);
 const hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const exitTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const collapseTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [cardMotionOpen,setCardMotionOpen]=useState(false);
 const onFiscalEdit=useRef((dirty:boolean,busy:boolean)=>{fiscalEdit.current={dirty,busy};}).current;
 function canLeaveFiscal(){return !fiscalEdit.current.busy&&(!fiscalEdit.current.dirty||window.confirm(ar?'تجاهل التغييرات غير المحفوظة؟':'Discard unsaved changes?'));}
 const [tab,setTab]=useState<string>(initialFiscalEditor?'fiscal':'summary'),[readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null),[readinessError,setReadinessError]=useState(false),[revision,setRevision]=useState(0);
 const [expandedCard,setExpandedCard]=useState<{id:FinancialSetupCardKey;pinned:boolean;origin:{left:number;top:number;width:number;height:number}}|null>(null);

 const clearHover=()=>{if(hoverTimer.current){clearTimeout(hoverTimer.current);hoverTimer.current=null;}};
 const clearExit=()=>{if(exitTimer.current){clearTimeout(exitTimer.current);exitTimer.current=null;}};
 const clearCollapse=()=>{if(collapseTimer.current){clearTimeout(collapseTimer.current);collapseTimer.current=null;}};
 function collapseCard(){
  clearHover();clearExit();clearCollapse();
  const wasPinned=expandedCard?.pinned;
  setCardMotionOpen(false);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  collapseTimer.current=setTimeout(()=>{
   setExpandedCard(null);if(wasPinned)sourceCardRef.current?.focus({preventScroll:true});
  },reduced?0:340);
 }
 function openCard(id:FinancialSetupCardKey,button:HTMLButtonElement,pinned:boolean){
  clearHover();clearExit();clearCollapse();
  if(expandedCard?.id===id){
   if(pinned&&!expandedCard.pinned)setExpandedCard(previous=>previous?{...previous,pinned:true}:null);
   else if(pinned&&expandedCard.pinned)collapseCard();
   return;
  }
  const box=button.getBoundingClientRect();
  sourceCardRef.current=button;
  setCardMotionOpen(false);
  setExpandedCard({id,pinned,origin:{left:box.left,top:box.top,width:box.width,height:box.height}});
 }
 function previewCard(id:FinancialSetupCardKey,button:HTMLButtonElement,pointerType:string){
  if(pointerType!=='mouse'||expandedCard?.pinned)return;
  clearHover();clearExit();
  hoverTimer.current=setTimeout(()=>openCard(id,button,false),180);
 }
 function schedulePreviewClose(){
  if(expandedCard?.pinned||exitTimer.current)return;
  exitTimer.current=setTimeout(()=>{exitTimer.current=null;collapseCard();},400);
 }
 useEffect(()=>()=>{clearHover();clearExit();clearCollapse();},[]);
 useEffect(()=>{setExpandedCard(null);setCardMotionOpen(false);clearHover();clearExit();clearCollapse();},[ctx.organizationId]);
 useLayoutEffect(()=>{
  if(!expandedCard||!modalCardRef.current)return;
  const target=modalCardRef.current.getBoundingClientRect(),origin=expandedCard.origin;
  modalCardRef.current.style.setProperty('--setup-card-translate-x',String(origin.left+origin.width/2-target.left-target.width/2)+'px');
  modalCardRef.current.style.setProperty('--setup-card-translate-y',String(origin.top+origin.height/2-target.top-target.height/2)+'px');
  modalCardRef.current.style.setProperty('--setup-card-scale-x',String(origin.width/target.width));
  modalCardRef.current.style.setProperty('--setup-card-scale-y',String(origin.height/target.height));
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setCardMotionOpen(true));});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[expandedCard?.id]);
 useEffect(()=>{
  if(!expandedCard)return;
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();collapseCard();}};
  document.addEventListener('keydown',keydown);
  const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const bodyOverflow=document.body.style.overflow;
  if(expandedCard.pinned){document.body.style.overflow='hidden';modalCloseRef.current?.focus({preventScroll:true});}
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=bodyOverflow;};
 },[expandedCard?.id,expandedCard?.pinned]);
 useEffect(()=>{
  if(!expandedCard||expandedCard.pinned)return;
  const move=(event:PointerEvent)=>{
   if(event.pointerType!=='mouse')return;
   const within=(rect:DOMRect|undefined)=>Boolean(rect&&event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom);
   const source=sourceCardRef.current?.getBoundingClientRect(),preview=modalCardRef.current?.getBoundingClientRect();
   if(within(source)||within(preview))clearExit();
   else schedulePreviewClose();
  };
  document.addEventListener('pointermove',move);
  return()=>document.removeEventListener('pointermove',move);
 },[expandedCard?.id,expandedCard?.pinned]);
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
  <div className="settings-finance-status" aria-label={ar?'حالة التأسيس المالي':'Financial setup readiness'}>{
   sections.filter(([id])=>id!=='summary').map(([id,a,e])=>{
    const section=id as FinancialSetupCardKey,status=readiness?.statuses[section];
    const checks=readiness?.sourceChecks?.[section],unavailable=Boolean(checks?.length&&checks.every(c=>c.status==='UNAVAILABLE'));
    const state=unavailable?'unverified':status==='READY'?'complete':status==='IN_PROGRESS'?'pending':status==='NOT_STARTED'?'incomplete':status==='BLOCKED'?'blocked':'unverified';
    const stateLabel=unavailable?(ar?'تعذر التحقق':'Unavailable'):!status?(readinessError?(ar?'تعذر التحقق':'Unavailable'):(ar?'قيد التحقق':'Checking')):status==='READY'?(ar?'مكتمل':'Complete'):status==='IN_PROGRESS'?(ar?'قيد التنفيذ':'In progress'):status==='BLOCKED'?(ar?'يحتاج استكمال':'Needs attention'):(ar?'لم يبدأ':'Not started');
    const dots:(FinancialSourceCheckStatus|'UNVERIFIED')[]=status==='NOT_STARTED'?(checks?.map(()=>'UNVERIFIED')??Array<FinancialSourceCheckStatus|'UNVERIFIED'>(3).fill('UNVERIFIED')):(checks?.map(check=>check.status)??Array<FinancialSourceCheckStatus|'UNVERIFIED'>(section==='chart'||section==='banking'?2:3).fill('UNVERIFIED'));
    const expanded=expandedCard?.id===section;
    const summary=section==='fiscal'?(ar?'تحديد السنة وحالتها':'Year and fiscal period'):section==='chart'?(ar?'هيكل الحسابات وتصنيفها':'Account structure'):section==='posting'?(ar?'ربط العمليات بالحسابات':'Posting policy mappings'):section==='banking'?(ar?'الحسابات البنكية والنقدية':'Cash and bank accounts'):(ar?'اعتماد أرصدة بداية السنة':'Verify start-of-year balances');
    return <article key={id} data-financial-section={id} data-source-status={status??'UNVERIFIED'} data-motion-source={expanded?'true':undefined} className={'settings-finance-state-'+state}>
     <button type="button" className="settings-finance-card-trigger" aria-expanded={expanded} aria-haspopup="dialog"
      onPointerEnter={event=>previewCard(section,event.currentTarget,event.pointerType)}
      onPointerLeave={()=>clearHover()} onClick={event=>openCard(section,event.currentTarget,true)}>
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
      <span className="settings-finance-card-more">{expanded?(ar?'إخفاء التفاصيل':'Hide details'):(ar?'عرض التفاصيل':'View details')} <span aria-hidden="true">{expanded?'−':'+'}</span></span>
     </button>
    </article>;
   })
  }</div>

  {expandedCard&&typeof document!=='undefined'&&createPortal((()=>{
   const selected=sections.find(([id])=>id===expandedCard.id);
   if(!selected)return null;
   const [id,a,e]=selected;
   const status=readiness?.statuses[expandedCard.id],checks=readiness?.sourceChecks?.[expandedCard.id];
   const title=ar?a:e;
   const state=status==='READY'?'complete':status==='IN_PROGRESS'?'pending':status==='NOT_STARTED'?'incomplete':status==='BLOCKED'?'blocked':'unverified';
   const stateLabel=status==='READY'?(ar?'مكتمل':'Complete'):status==='IN_PROGRESS'?(ar?'قيد التنفيذ':'In progress'):status==='BLOCKED'?(ar?'يحتاج استكمال':'Needs attention'):status==='NOT_STARTED'?(ar?'لم يبدأ':'Not started'):(ar?'قيد التحقق':'Checking');
   const dots:(FinancialSourceCheckStatus|'UNVERIFIED')[]=status==='NOT_STARTED'?(checks?.map(()=>'UNVERIFIED')??Array(3).fill('UNVERIFIED')):(checks?.map(check=>check.status)??Array(3).fill('UNVERIFIED'));
   const summary=expandedCard.id==='fiscal'?(ar?'تحديد الفترة المالية وحالتها':'Fiscal period and status'):expandedCard.id==='chart'?(ar?'إعداد هيكل الحسابات وتصنيفاتها':'Account structure and classifications'):expandedCard.id==='posting'?(ar?'ضبط قواعد الترحيل المحاسبي':'Configure accounting posting rules'):expandedCard.id==='banking'?(ar?'إعداد الحسابات البنكية والنقدية':'Configure cash and bank accounts'):(ar?'اعتماد أرصدة بداية السنة':'Approve opening balances');
   return <div className="settings-finance-modal-backdrop" data-open={cardMotionOpen?'true':'false'} data-mode={expandedCard.pinned?'pinned':'hover'}
     onMouseDown={event=>{if(event.target===event.currentTarget&&expandedCard.pinned)collapseCard();}}>
    <section ref={modalCardRef} className="settings-finance-modal-card" role="dialog" data-mode={expandedCard.pinned?'pinned':'hover'}
     aria-modal={expandedCard.pinned} aria-label={title} dir={ar?'rtl':'ltr'}
     onPointerEnter={()=>clearExit()} onPointerLeave={()=>{if(!expandedCard.pinned)schedulePreviewClose();}}
     onPointerDown={event=>{if(!expandedCard.pinned&&!(event.target as HTMLElement).closest('button'))setExpandedCard(previous=>previous?{...previous,pinned:true}:null);}}
     onKeyDown={event=>{if(expandedCard.pinned&&event.key==='Tab'){event.preventDefault();modalCloseRef.current?.focus();}}}>
     <button ref={modalCloseRef} type="button" className="settings-finance-modal-close" onClick={collapseCard} aria-label={ar?'إغلاق البطاقة':'Close card'}>×</button>
     <SettingsIcon name={financeIcons[id]}/>
     <h3>{title}</h3>
     <p className="settings-finance-modal-summary">{summary}</p>
     <ul className="settings-finance-modal-checks">{
      checks?.map(check=>{
       const label=check.id==='opening.verified'&&readiness?.mode==='NEW'?['التحقق من عدم وجود أرصدة سابقة','Verified zero opening balances']:sourceCheckLabels[check.id];
       const displayStatus=status==='NOT_STARTED'?'UNVERIFIED':check.status;
       return <li key={check.id} data-source-check={check.id} data-check-status={displayStatus}>
        <span className={'settings-finance-modal-check-icon '+displayStatus.toLowerCase()} aria-hidden="true">{displayStatus==='MET'?'✓':displayStatus==='MISSING'?'•':'–'}</span>
        <span>{label[ar?0:1]}</span>
       </li>;
      })??<li>{ar?'جارٍ التحقق…':'Checking…'}</li>
     }</ul>
     <div className="settings-finance-modal-progress" aria-hidden="true">{
      dots.map((dot,i)=><span key={i} className={'settings-finance-modal-node '+dot.toLowerCase()}>{dot==='MET'?'✓':''}</span>)
     }</div>
     <span className={'settings-finance-progress-label '+state}>{stateLabel}</span>
     <p className="settings-finance-modal-disclaimer">{ar?'هذه مؤشرات مستمدة من مصادر المؤسسة، وليست اعتمادًا محاسبيًا أو ضريبيًا.':'Source-backed checks are not accounting or tax certification.'}</p>
    </section>
   </div>;
  })(),document.body)}
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
