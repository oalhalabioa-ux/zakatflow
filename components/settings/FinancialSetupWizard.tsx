'use client';

import Link from 'next/link';
import {useEffect, useMemo, useState} from 'react';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {rememberedOrganization} from '@/lib/workspace-organization';
import {FINANCIAL_INDUSTRIES,isFinancialIndustry} from '@/lib/financial-chart-templates';
import {
  FINANCIAL_SETUP_STEPS,
  isFinancialSetupMode,
  isSetupStep,
  isSkippedSetupStep,
  nextSetupStep,
  setupStorageKey,
  type FinancialSetupMode,
  type FinancialSetupStep,
} from '@/lib/financial-setup-steps';
import type {FinancialSetupReadiness,SetupStatus} from '@/lib/financial-setup-readiness';
import './financial-setup.css';

type Org = {id:string;name:string;legal_name?:string|null;base_currency:string;entity_type:string};
type Saved = {mode:FinancialSetupMode|null;industry:string;completed:FinancialSetupStep[];step:FinancialSetupStep};
const labels:Record<FinancialSetupStep,[string,string]> = {
  organization:['بيانات المؤسسة','Organization'],
  chart:['دليل الحسابات','Chart of accounts'],
  fiscal:['السنة المالية','Fiscal year'],
  posting:['قواعد الترحيل','Posting rules'],
  banking:['النقد والبنوك','Cash & banking'],
  opening:['الأرصدة الافتتاحية','Opening balances'],
  users:['المستخدمون','Users'],
  review:['المراجعة','Review'],
  finished:['الإنهاء','Finish'],
};

function readSaved(id:string):Saved {
  const empty:Saved={mode:null,industry:'GENERAL',completed:[],step:'organization'};
  try{
    const raw=window.localStorage.getItem(setupStorageKey(id));
    if(!raw)return empty;
    const value=JSON.parse(raw) as Partial<Saved>;
    return {
      mode:isFinancialSetupMode(value.mode)?value.mode:null,
      industry:isFinancialIndustry(value.industry)?value.industry:'GENERAL',
      completed:Array.isArray(value.completed)?value.completed.filter(isSetupStep):[],
      step:isSetupStep(value.step)?value.step:'organization',
    };
  }catch{return empty}
}

export default function FinancialSetupWizard({locale,preferredOrg=''}:{locale:string;preferredOrg?:string}){
  const ar=locale==='ar', t=(arabic:string,english:string)=>ar?arabic:english;
  const [orgs,setOrgs]=useState<Org[]>([]),[orgId,setOrgId]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [mode,setMode]=useState<FinancialSetupMode|null>(null),[industry,setIndustry]=useState('GENERAL');
  const [step,setStep]=useState<FinancialSetupStep>('organization'),[completed,setCompleted]=useState<FinancialSetupStep[]>([]);
  const [hydrated,setHydrated]=useState(false),[reviewed,setReviewed]=useState(false),[notice,setNotice]=useState('');
  const [readiness,setReadiness]=useState<FinancialSetupReadiness|null>(null);
  const [checkingReadiness,setCheckingReadiness]=useState(false),[readinessError,setReadinessError]=useState('');
  const [readinessRevision,setReadinessRevision]=useState(0);

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/organizations',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const value=await response.json();
      if(!response.ok||!Array.isArray(value))throw Error('ORGANIZATIONS_UNAVAILABLE');
      return value as Org[];
    }).then(items=>{
      if(controller.signal.aborted)return;
      setOrgs(items);
      const requested=preferredOrg||rememberedOrganization()||'';
      if(preferredOrg&&!items.some(item=>item.id===preferredOrg))setError(t('هذه المؤسسة غير متاحة لحسابك.','This organization is not available to your account.'));
      else setOrgId(items.find(item=>item.id===requested)?.id??items[0]?.id??'');
    }).catch(()=>{if(!controller.signal.aborted)setError(t('تعذر تحميل المؤسسات.','Unable to load organizations.'))})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[preferredOrg,ar]);

  useEffect(()=>{
    setHydrated(false);
    if(!orgId)return;
    const saved=readSaved(orgId);
    setMode(saved.mode);
    setIndustry(saved.industry);
    setCompleted(saved.completed);
    setStep(saved.step);
    setReviewed(false);
    setNotice('');
    setHydrated(true);
  },[orgId]);
  useEffect(()=>{
    if(!hydrated||!orgId)return;
    const value:Saved={mode,industry,completed,step};
    try{window.localStorage.setItem(setupStorageKey(orgId),JSON.stringify(value))}catch{
      // The setup remains navigable when browser storage is unavailable.
    }
  },[hydrated,orgId,mode,industry,completed,step]);
  useEffect(()=>setReviewed(false),[step,orgId]);
  // Human review can be stored locally, but accounting readiness NEVER is.
  useEffect(()=>{
    if(!hydrated||!orgId)return;
    const controller=new AbortController();
    setReadiness(null);setReadinessError('');setCheckingReadiness(true);
    const params=new URLSearchParams({organization:orgId});
    if(mode)params.set('mode',mode);
    fetch('/api/financial-reporting/setup-readiness?'+params,{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const value=await response.json();
        if(!response.ok)throw Error(value.error??'SETUP_UNAVAILABLE');
        return value as FinancialSetupReadiness;
      }).then(value=>{
        if(controller.signal.aborted)return;
        if(value.organizationId!==orgId||value.mode!==mode)throw Error('SETUP_CONTEXT_CHANGED');
        setReadiness(value);
      }).catch(()=>{if(!controller.signal.aborted)setReadinessError(t(
        'تعذّر التحقق من جاهزية المؤسسة. لن يُعتمد الإعداد دون التحقق.',
        'Readiness could not be checked. Setup cannot finish before verification.'))})
      .finally(()=>{if(!controller.signal.aborted)setCheckingReadiness(false)});
    return()=>controller.abort();
  },[hydrated,orgId,mode,readinessRevision]);
  useEffect(()=>{
    const refresh=()=>setReadinessRevision(value=>value+1);
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[]);
  useEffect(()=>{
    if(step==='finished'&&(!readiness||!readiness.ready))setStep('review');
  },[step,readiness]);


  const organization=orgs.find(item=>item.id===orgId);
  const position=FINANCIAL_SETUP_STEPS.indexOf(step)+1;
  const measured=FINANCIAL_SETUP_STEPS.filter(id=>id!=='finished');
  const progress=readiness?Math.round(100*measured.filter(id=>readiness.statuses[id]==='READY').length/measured.length):0;
  const setupReady=readiness?.ready===true;
  const statusLabel=(value:SetupStatus|undefined)=>value==='READY'?t('جاهز','Ready'):
    value==='IN_PROGRESS'?t('غير مكتمل','Incomplete'):
    value==='BLOCKED'?t('يتطلب معالجة','Action required'):
    value==='NOT_STARTED'?t('لم يبدأ','Not started'):t('قيد التحقق','Checking');
  const isComplete=completed.includes(step)||isSkippedSetupStep(step,mode);
  const allReviewed=FINANCIAL_SETUP_STEPS.filter(id=>id!=='review'&&id!=='finished'&&!isSkippedSetupStep(id,mode)).every(id=>completed.includes(id));
  const details=useMemo(()=>{
    if(!orgId)return null;
    const base=`/${locale}`;
    const query=(extra?:Record<string,string>)=>new URLSearchParams({organization:orgId,fromSetup:'1',...extra}).toString();
    return {
      organization:`${base}/settings?${query()}`,
      fiscal:`${base}/settings/financial/fiscal-years?${query()}`,
      chart:`${base}/chart-of-accounts?${query()}`,
      posting:`${base}/financial-reporting-policy?${query()}`,
      banking:`${base}/cash-and-banks?${query({scope:'ORGANIZATION'})}`,
      opening:`${base}/opening-balances?${query()}`,
      users:`${base}/users?${query()}`,
    };
  },[locale,orgId]);

  function selectOrganization(next:string){setHydrated(false);setOrgId(next)}
  function selectStep(next:FinancialSetupStep){
    if(next==='finished'&&(!completed.includes('review')||!setupReady))return;
    if(isSkippedSetupStep(next,mode))return;
    const target=FINANCIAL_SETUP_STEPS.indexOf(next);
    const firstMissing=FINANCIAL_SETUP_STEPS.findIndex(id=>!completed.includes(id)&&!isSkippedSetupStep(id,mode));
    if(target>firstMissing&&firstMissing!==-1)return;
    setStep(next);
    setNotice('');
  }
  function advance(){
    if(step==='finished')return;
    if(step==='organization'&&!mode)return;
    if(step==='review'&&(!allReviewed||!setupReady))return;
    if(step!=='organization'&&!isComplete&&!reviewed)return;
    setCompleted(previous=>{
      const next=previous.includes(step)?previous:[...previous,step];
      return step==='review'&&!next.includes('finished')?[...next,'finished']:next;
    });
    setStep(nextSetupStep(step,mode));
    setNotice('');
  }
  function previous(){
    const index=FINANCIAL_SETUP_STEPS.indexOf(step);
    const candidate=FINANCIAL_SETUP_STEPS.slice(0,index).reverse().find(id=>!isSkippedSetupStep(id,mode));
    if(candidate)setStep(candidate);
  }
  const moduleLink=(href:string|undefined,label:string,description:string)=><div className="financial-setup-module-link"><div><strong>{label}</strong><p>{description}</p></div>{href&&<Link href={href}>{t('فتح الصفحة الحالية','Open existing page')} <span aria-hidden="true">↗</span></Link>}</div>;
  const note=t('علامات الإنجاز هنا لتتبّع مراجعتك، ولا تُعد اعتمادًا محاسبيًا. الحفظ والترحيل والاعتماد تتم فقط في صفحاتها الأصلية.','Journey checkmarks track your review, not accounting approval. Saving, posting and approvals remain in their existing pages.');

  return <div className="financial-setup" dir={ar?'rtl':'ltr'} data-financial-setup>
    <TopbarOrganizationControls>
      <WorkspaceOrganizationPicker ar={ar} label={t('المؤسسة','Organization')} organizations={orgs} value={orgId} restore={false} disabled={loading} onChange={selectOrganization}/>
    </TopbarOrganizationControls>
    <header className="financial-setup-header"><div><p className="financial-setup-breadcrumb">{t('إعدادات المؤسسة / التهيئة المالية','Organization settings / Financial setup')}</p><h2>{t('إعداد المؤسسة','Set up your organization')}</h2><p>{t('رحلة واضحة من بيانات المؤسسة إلى المراجعة النهائية، باستخدام صفحات النظام المالية الحالية.','A guided journey from organization details to final review, using the existing financial pages.')}</p></div><span className="financial-setup-tag">{t('الخطوة','Step')} <bdi>{position} / 9</bdi></span></header>
    {error&&<p role="alert" className="financial-setup-notice error">{error}</p>}
    {loading&&<p role="status">{t('جار تحميل المؤسسات…','Loading organizations…')}</p>}
    {!loading&&!error&&!organization&&<p role="status">{t('لا توجد مؤسسة متاحة. أنشئ مؤسسة للبدء.','No organization available. Create one to get started.')} <Link href={`/${locale}/organizations`}>{t('المؤسسات','Organizations')}</Link></p>}
    {organization&&hydrated&&<>
      <div className="financial-setup-readiness-head"><strong>{t('جاهزية النظام المالية','Financial system readiness')}</strong><button type="button" disabled={checkingReadiness} onClick={()=>setReadinessRevision(v=>v+1)}>{checkingReadiness?t('جار التحقق…','Checking…'):t('تحديث الحالة','Refresh status')}</button></div>
      <div className="financial-setup-progress"><div className="financial-setup-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('الجاهزية الفعلية من البيانات المالية','Financial evidence-based readiness')}><span style={{width:`${progress}%`}}/></div><bdi>{progress}%</bdi></div>
      {readinessError&&<p role="alert" className="financial-setup-notice error">{readinessError}</p>}
      {!readinessError&&!setupReady&&<p className="financial-setup-system-hint">{t('العلامات الإرشادية لا تعني الاعتماد المحاسبي؛ الحالة التالية مأخوذة من البيانات والصلاحيات الفعلية.','Review checkmarks are not accounting approvals. The statuses below come from actual data and permissions.')}</p>}
      <nav className="financial-setup-steps" aria-label={t('خطوات إعداد المؤسسة','Organization setup steps')}>
        {FINANCIAL_SETUP_STEPS.map((id,index)=>{
          const done=readiness?.statuses[id]==='READY',skipped=isSkippedSetupStep(id,mode),active=step===id;
          const firstMissing=FINANCIAL_SETUP_STEPS.findIndex(item=>!completed.includes(item)&&!isSkippedSetupStep(item,mode));
          const available=!skipped&&(index<=firstMissing||firstMissing===-1);
          return <button type="button" key={id} className={active?'current':done?'done':skipped?'skipped':''} aria-current={active?'step':undefined} disabled={!available} onClick={()=>selectStep(id)} title={skipped?t('لا تنطبق على المؤسسة الجديدة','Not required for new organizations'):undefined}><span className="financial-setup-number">{done?'✓':skipped?'–':index+1}</span><span>{ar?labels[id][0]:labels[id][1]}</span><small className="financial-setup-step-status">{statusLabel(readiness?.statuses[id])}</small></button>;
        })}
      </nav>
      {step==='finished'?<section className="financial-setup-card financial-setup-success"><div className="financial-setup-success-mark" aria-hidden="true">✓</div><h3>{t('تهانينا! أنهيت رحلة إعداد المؤسسة','Congratulations! You completed the setup journey')}</h3><p>{t('يمكنك الآن متابعة العمليات من اللوحة الرئيسية. هذه الرسالة تؤكد انتهاء المراجعة الإرشادية؛ وتبقى الاعتمادات المحاسبية خاضعة لصلاحيات وقواعد النظام.','You can now continue from the dashboard. This confirms the guided review, while accounting approvals remain governed by the system.')}</p><Link className="financial-setup-primary" href={`/${locale}/dashboard?organization=${encodeURIComponent(orgId)}&scope=ORGANIZATION`}>{t('الانتقال إلى اللوحة الرئيسية','Go to dashboard')}</Link></section>:<section className="financial-setup-card">
        <div className="financial-setup-card-head"><div><h3>{ar?labels[step][0]:labels[step][1]}</h3><p>{step==='organization'?t('تحديد وضع المؤسسة دون تغيير أرصدتها القائمة.','Select the organization mode without altering existing balances.'):step==='opening'?t('مصدر افتتاحي واحد مرتبط بالسندات والتقارير.','One opening source linked to vouchers and statements.'):t('تابع الإعداد في الصفحة الأصلية، ثم عُد لإكمال الرحلة.','Continue in the existing page, then return to this journey.')}</p></div><span className="financial-setup-card-badge">{t('المرحلة','Stage')} {position}</span></div>
        {step==='organization'&&<><div className="financial-setup-mode-grid"><button type="button" className={mode==='NEW'?'chosen':''} aria-pressed={mode==='NEW'} onClick={()=>{setMode('NEW');setCompleted(previous=>previous.filter(id=>id!=='opening'))}}><span aria-hidden="true">＋</span><strong>{t('مؤسسة جديدة','New organization')}</strong><small>{t('تبدأ دون أرصدة افتتاحية؛ تُسجَّل حركة رأس المال عند حدوثها.','Starts without opening balances; capital is recorded when received.')}</small></button><button type="button" className={mode==='EXISTING'?'chosen':''} aria-pressed={mode==='EXISTING'} onClick={()=>setMode('EXISTING')}><span aria-hidden="true">▤</span><strong>{t('مؤسسة قائمة','Existing organization')}</strong><small>{t('لديها أرصدة سابقة تُدخل في صفحة الافتتاحي الحالية.','Prior balances are entered in the existing opening workspace.')}</small></button></div><dl className="financial-setup-facts"><div><dt>{t('اسم المؤسسة','Organization name')}</dt><dd>{organization.name}</dd></div><div><dt>{t('العملة الأساسية','Base currency')}</dt><dd dir="ltr">{organization.base_currency}</dd></div><div><dt>{t('النوع','Type')}</dt><dd>{organization.entity_type}</dd></div></dl>{details&&<Link className="financial-setup-link" href={details.organization}>{t('عرض بيانات المؤسسة الحالية','View existing organization details')}</Link>}</>}
        {step==='fiscal'&&moduleLink(details?.fiscal,t('إدارة السنوات المالية','Fiscal years'),t('حدد بداية السنة ونهايتها، وحساب الأرباح المحتجزة، مع حماية السنوات المقفلة.','Configure year boundaries and retained earnings while preserving closed periods.'))}
        {step==='chart'&&<><p className="financial-setup-intro">{t('الدليل الرئيسي موحد لكل المنشآت. اختر نشاطك لمعاينة حساباته الفرعية ذات الأرقام التابعة للحسابات الرئيسية، ثم أضف الحسابات المطلوبة داخل الدليل دون تغيير الحسابات القائمة.','The main chart is shared by all organizations. Select your activity to preview numbered child accounts, then add the required ones in the existing chart without modifying prior accounts.')}</p><div className="financial-setup-industries">{FINANCIAL_INDUSTRIES.map(item=><button type="button" key={item.id} aria-pressed={industry===item.id} className={industry===item.id?'chosen':''} onClick={()=>setIndustry(item.id)}>{t(item.ar,item.en)}</button>)}</div>{moduleLink(details?.chart?`${details.chart}&template=${industry}`:undefined,t('دليل الحسابات الحالي','Existing chart of accounts'),t('استعراض القالب وتفعيل الحسابات الفرعية مع كشف أي تعارض في الأرقام.','Preview the template and add child accounts with account-number conflict checks.'))}</>}
        {step==='posting'&&<><div className="financial-setup-roles"><div><span>{t('اقتناء أصل','Asset purchase')}</span><strong>{t('الأصول الثابتة','Fixed assets')}</strong></div><div><span>{t('تحصيل عميل','Customer receipt')}</span><strong>{t('النقد والبنوك','Cash and banks')}</strong></div><div><span>{t('إيراد فاتورة','Invoice revenue')}</span><strong>{t('إيرادات المبيعات','Sales revenue')}</strong></div></div><p className="financial-setup-notice">{t('هذه أمثلة لأدوار الحساب الواحد وليست قواعد محفوظة. سياسة الترحيل الحالية ذات الطرفين تبقى كما هي حتى يُعتمد تحويلها تقنيًا دون المساس بالقيود السابقة.','These are one-account role examples, not saved rules. The existing two-sided posting policy remains unchanged until a safe engine migration is approved.')}</p>{moduleLink(details?.posting,t('قواعد الترحيل الحالية','Existing posting rules'),t('افحص التغطية واعتماد القواعد وفق صلاحيات المؤسسة.','Review coverage and policy approval under organization permissions.'))}</>}
        {step==='banking'&&moduleLink(details?.banking,t('النقد والبنوك','Cash and banks'),t('راجع الحسابات البنكية وحركة السيولة، مع الحفاظ على كل حساب وربطه الأصلي.','Review bank accounts and liquidity without rewriting their source linkages.'))}
        {step==='opening'&&<>{mode==='NEW'?<p className="financial-setup-notice">{t('لا تتطلب المؤسسة الجديدة أرصدة افتتاحية.','A new organization does not require opening balances.')}</p>:<><p className="financial-setup-notice">{t('لا تُنشأ هنا صفحة أو أرصدة إضافية. افتح سجل الأرصدة الموجود وأدخل أو راجع أرصدة المؤسسة في السنة الصحيحة.','This step creates no duplicate page or balances. Review the existing opening workspace for the correct fiscal year.')}</p>{moduleLink(details?.opening,t('الأرصدة الافتتاحية الحالية','Existing opening balances'),t('يمكن حفظ المسودة ومراجعتها؛ الاعتماد النهائي إجراء مستقل داخل الصفحة الأصلية.','Save and preview drafts; formal approval remains an independent action in the existing page.'))}</>}</>}
        {step==='users'&&moduleLink(details?.users,t('المستخدمون والصلاحيات','Users & permissions'),t('تحقق من المالك والأدوار والدعوات وحدود الوصول لكل مؤسسة.','Review owner, roles, invitations and organization-scoped permissions.'))}
        {step==='review'&&<><p className="financial-setup-intro">{t('راجع البيانات والخطوات التي أكملتها قبل إنهاء الرحلة.','Review your organization details and completed steps before finishing.')}</p><dl className="financial-setup-facts"><div><dt>{t('المؤسسة','Organization')}</dt><dd>{organization.name}</dd></div><div><dt>{t('الوضع','Mode')}</dt><dd>{mode==='EXISTING'?t('قائمة','Existing'):t('جديدة','New')}</dd></div><div><dt>{t('النشاط المقترح','Suggested activity')}</dt><dd>{ar?FINANCIAL_INDUSTRIES.find(item=>item.id===industry)?.ar:FINANCIAL_INDUSTRIES.find(item=>item.id===industry)?.en}</dd></div><div><dt>{t('العملة','Currency')}</dt><dd>{organization.base_currency}</dd></div></dl><ul className="financial-setup-review-list">{FINANCIAL_SETUP_STEPS.filter(id=>id!=='review'&&id!=='finished').map(id=><li key={id}><span>{ar?labels[id][0]:labels[id][1]}</span><strong>{statusLabel(readiness?.statuses[id])+' · '+(completed.includes(id)?t('تمت المراجعة','Reviewed'):t('لم تُراجع','Not reviewed'))}</strong></li>)}</ul>{!setupReady&&<p role="alert" className="financial-setup-notice error">{t('التهيئة لم تجتز فحص الجاهزية الفعلي. أكمل النواقص ثم حدّث الحالة.','Live setup readiness is not verified. Resolve missing requirements, then refresh.')}</p>}{!allReviewed&&<p role="alert" className="financial-setup-notice error">{t('هناك خطوات لم تُراجع بعد؛ عد إليها قبل الإنهاء.','Some steps still need review before finishing.')}</p>}</>}
        {step!=='organization'&&step!=='review'&&!isComplete&&<label className="financial-setup-confirm"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>{t('راجعت هذه الخطوة وأريد المتابعة','I reviewed this step and want to continue')}</span></label>}
        {step==='review'&&!isComplete&&<label className="financial-setup-confirm"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>{t('أؤكد مراجعة بيانات الإعداد، مع بقاء الاعتمادات المحاسبية مستقلة','I confirm this setup review; accounting approvals remain separate')}</span></label>}
        <p className="financial-setup-hint">{note}</p>
        <footer className="financial-setup-footer"><button type="button" className="financial-setup-primary" disabled={(step==='organization'&&!mode)||(step!=='organization'&&!isComplete&&!reviewed)||(step==='review'&&(!allReviewed||!setupReady))} onClick={advance}>{step==='review'?t('إنهاء الإعداد','Finish setup'):t('التالي','Next')} <span aria-hidden="true">{ar?'←':'→'}</span></button><button type="button" className="financial-setup-secondary" onClick={()=>{setNotice(t('تم حفظ تقدمك على هذا الجهاز.','Progress saved on this device.'));}}>{t('حفظ ومتابعة لاحقًا','Save for later')}</button><button type="button" className="financial-setup-back" disabled={step==='organization'} onClick={previous}>{t('السابق','Back')}</button></footer>
        {notice&&<p role="status" className="financial-setup-notice">{notice}</p>}
      </section>}
    </>}
  </div>;
}
