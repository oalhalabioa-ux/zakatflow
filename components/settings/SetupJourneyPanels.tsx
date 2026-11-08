'use client';

import {Fragment,useEffect,useState} from 'react';
import type {FinancialSetupMode,FinancialSetupStep} from '@/lib/financial-setup-steps';
import {FINANCIAL_SETUP_STEPS,isSkippedSetupStep} from '@/lib/financial-setup-steps';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import {canDeferSetupStep,FINANCIAL_SETUP_STEP_HELP,financialSetupJourneyCounts,setupJourneyStepState,firstMissingFinancialSetupStep} from '@/lib/financial-setup-journey-policy';
import SubscriptionSetupSummary from './SubscriptionSetupSummary';

export const SETUP_JOURNEY_LABELS:Record<FinancialSetupStep,[string,string]>={
 organization:['بيانات المؤسسة','Organization details'],
 regulatory:['البيانات النظامية والضريبية','Legal & tax settings'],
 structure:['الفروع والهيكل','Branches & structure'],
 chart:['دليل الحسابات','Chart of accounts'],
 fiscal:['السنة المالية','Fiscal year'],
 posting:['قواعد الترحيل','Posting rules'],
 banking:['النقد والبنوك','Cash & banking'],
 opening:['الأرصدة الافتتاحية','Opening balances'],
 users:['المستخدمون والصلاحيات','Users & permissions'],
 review:['المراجعة والاعتماد','Review & verification'],
 finished:['الإنهاء','Finish'],
};
type Context={
 locale:string;
 mode:FinancialSetupMode|null;
 readiness:FinancialSetupReadiness|null;
 completed:readonly FinancialSetupStep[];
 deferred:readonly FinancialSetupStep[];
};
const groupLabels:Partial<Record<FinancialSetupStep,[string,string]>>={
 organization:['أولًا · إعداد المؤسسة','01 · Organization'],
 regulatory:['ثانيًا · البيانات النظامية والضريبية','02 · Legal & tax'],
 chart:['ثالثًا · المالية والمحاسبة','03 · Finance & accounting'],
 users:['رابعًا · إدارة الوصول','04 · Access management'],
 review:['خامسًا · المراجعة','05 · Review'],
};
type LegalTaxSource={
 kind:'LOADING'|'MISSING'|'SAVED'|'ERROR';
 registration:string|null;
 hasInvoiceAddress:boolean;
 hasVatNumber:boolean;
};
const initialLegalTax:LegalTaxSource={kind:'LOADING',registration:null,hasInvoiceAddress:false,hasVatNumber:false};
const states={
 COMPLETE:['مكتمل','Complete'],
 REVIEWED:['تمت المراجعة','Reviewed'],
 DEFERRED:['مؤجل مؤقتًا','Deferred'],
 OPTIONAL:['اختياري','Optional'],
 INCOMPLETE:['غير مكتمل','Incomplete'],
 BLOCKED:['يتطلب معالجة','Needs action'],
 VERIFYING:['قيد التحقق','Checking'],
} as const;

export function SetupJourneySidebar({locale,mode,readiness,completed,deferred,step,onSelect}:Context&{
 step:FinancialSetupStep;onSelect:(step:FinancialSetupStep)=>void;
}){
 const ar=locale==='ar';
 return <aside className="financial-setup-journey-timeline">
  <div className="financial-setup-journey-panel-title">
   <strong>{ar?'مراحل إعداد المؤسسة':'Organization setup steps'}</strong>
   <span>{ar?'اختر أي مرحلة لمراجعتها':'Select any step to review'}</span>
  </div>
  <nav className="financial-setup-stage-timeline financial-setup-steps"
   aria-label={ar?'خطوات إعداد المؤسسة':'Organization setup steps'}>
   {FINANCIAL_SETUP_STEPS.filter(id=>id!=='finished').map((id,index)=>{
    const status=setupJourneyStepState(id,readiness,deferred,completed,mode);
    const active=step===id;
    const disabled=!mode&&id!=='organization';
    const hasSkippedOpening=id==='opening'&&isSkippedSetupStep(id,mode)&&readiness?.statuses.opening==='READY';
    return <Fragment key={id}>{groupLabels[id]&&
     <p className="financial-setup-group-label">{groupLabels[id]?.[ar?0:1]}</p>}
     <button type="button" aria-current={active?'step':undefined}
     aria-disabled={disabled} disabled={disabled} onClick={()=>onSelect(id)}
     className={['financial-setup-timeline-step',active?'current':'',status==='COMPLETE'?'done':'',
      hasSkippedOpening?'skipped':'',status.toLowerCase()].filter(Boolean).join(' ')}>
     <span className="financial-setup-timeline-index" aria-hidden="true">{status==='COMPLETE'?'✓':index+1}</span>
     <span className="financial-setup-timeline-copy">
      <strong>{SETUP_JOURNEY_LABELS[id][ar?0:1]}</strong>
      <small>{FINANCIAL_SETUP_STEP_HELP[id]?.[ar?'ar':'en']}</small>
      <span className={'financial-setup-timeline-state state-'+status.toLowerCase()}>{states[status][ar?0:1]}</span>
     </span>
    </button></Fragment>;
   })}
  </nav>
 </aside>;
}

export function SetupJourneySummary({locale,mode,readiness,completed,deferred,checking,onRefresh,organizationId,organizationLegal,revision,onSelect}:Context&{
 checking:boolean;onRefresh:()=>void;organizationId:string;revision:number;
 organizationLegal?:{country_code?:string|null;commercial_registration_number?:string|null;registered_address?:string|null}|null;
 onSelect:(step:FinancialSetupStep)=>void;
}){
 const ar=locale==='ar';
 const [legalTax,setLegalTax]=useState<LegalTaxSource>(initialLegalTax);
 useEffect(()=>{
   const controller=new AbortController();
   setLegalTax(initialLegalTax);
   if(!organizationId)return ()=>controller.abort();
   fetch('/api/vat/settings?organization_id='+encodeURIComponent(organizationId),{
    cache:'no-store',signal:controller.signal,
   }).then(async response=>{
    if(!response.ok)throw Error('INVOICE_PROFILE_NOT_AVAILABLE');
    return response.json() as Promise<{profile?:Record<string,unknown>|null}>;
   }).then(({profile})=>{
    if(controller.signal.aborted)return;
    setLegalTax(!profile?{kind:'MISSING',registration:null,hasInvoiceAddress:false,hasVatNumber:false}:{
      kind:'SAVED',
      registration:typeof profile.registration_status==='string'?profile.registration_status:null,
      hasInvoiceAddress:['seller_street','seller_city','seller_building_number','seller_postal_code']
       .every(key=>typeof profile[key]==='string'&&Boolean(String(profile[key]).trim())),
      hasVatNumber:typeof profile.tax_registration_number==='string'&&
       Boolean(profile.tax_registration_number.trim()),
    });
   }).catch(()=>{if(!controller.signal.aborted)setLegalTax({kind:'ERROR',registration:null,hasInvoiceAddress:false,hasVatNumber:false})});
   return ()=>controller.abort();
 },[organizationId,revision]);
 const counts=financialSetupJourneyCounts(readiness,deferred);
 const nextRequired=firstMissingFinancialSetupStep(readiness,mode);
 const skipCandidates=FINANCIAL_SETUP_STEPS.filter(step=>
  !['review','finished'].includes(step)&&canDeferSetupStep(step,mode,readiness?.statuses??null));
 return <aside className="financial-setup-journey-summary" aria-label={ar?'ملخص جاهزية المؤسسة':'Organization readiness summary'}>
  <button type="button" className="financial-setup-resume" disabled={checking}
   onClick={()=>onSelect(nextRequired)}>
   <span>{ar?'متابعة الإعداد':'Continue setup'}</span>
   <small>{ar?'الانتقال إلى أول متطلب مالي غير مكتمل: ':'First missing financial requirement: '}
    {SETUP_JOURNEY_LABELS[nextRequired][ar?0:1]}</small>
  </button>
  <section className="financial-setup-summary-card">
   <h3>{ar?'الجاهزية المالية والمحاسبية':'Financial & accounting readiness'}</h3>
   <div className="financial-setup-summary-percent"><bdi>{counts.percent}%</bdi></div>
   <div className="financial-setup-progress-bar" role="progressbar" aria-valuenow={counts.percent}
    aria-valuemin={0} aria-valuemax={100} aria-label={ar?'الجاهزية الفعلية من السجلات':'Verified source readiness'}>
    <span style={{width:counts.percent+'%'}}/>
   </div>
   <p>{ar?'النسبة محسوبة من سبعة متطلبات مالية فعلية. بيانات الدولة والعنوان القانوني والضرائب تُراجع بصورة مستقلة ولا تدخل في هذا المؤشر.':
'This percentage measures seven financial source requirements. Country, legal address and tax review are tracked separately, not counted in this figure.'}</p>
   <dl className="financial-setup-journey-metrics">
    <div><dt>{ar?'خطوات مكتملة':'Verified steps'}</dt><dd><bdi>{counts.complete} / {counts.total}</bdi></dd></div>
    <div><dt>{ar?'خطوات غير مكتملة':'Incomplete steps'}</dt><dd><bdi>{counts.remaining}</bdi></dd></div>
    <div><dt>{ar?'مؤجلة مؤقتًا':'Temporarily deferred'}</dt><dd><bdi>{counts.deferred}</bdi></dd></div>
   </dl>
   <button type="button" onClick={onRefresh} disabled={checking} className="financial-setup-summary-refresh">
    {checking?(ar?'جار التحقق…':'Checking…'):(ar?'تحديث جاهزية المؤسسة':'Refresh readiness')}
   </button>
  </section>
  <section className="financial-setup-summary-card">
   <h3>{ar?'البيانات النظامية والضريبية':'Legal & tax source review'}</h3>
   <p>{ar?'حالة السجلات الفعلية المنفصلة عن مؤشر الجاهزية المالية.':
     'Actual source records, independent of the financial readiness percentage.'}</p>
   <dl className="financial-setup-journey-metrics">
    <div><dt>{ar?'دولة تسجيل المؤسسة':'Country of registration'}</dt><dd>{organizationLegal?.country_code|| (ar?'غير مدخلة':'Missing')}</dd></div>
    <div><dt>{ar?'السجل التجاري أو النظامي':'Commercial/statutory registration'}</dt><dd>{organizationLegal?.commercial_registration_number?(ar?'محفوظ':'Saved'):(ar?'غير مدخل':'Missing')}</dd></div>
    <div><dt>{ar?'العنوان القانوني المسجل':'Registered legal address'}</dt><dd>{organizationLegal?.registered_address?(ar?'محفوظ':'Saved'):(ar?'غير مدخل':'Missing')}</dd></div>
    <div><dt>{ar?'ملف بائع الفاتورة':'Invoice seller profile'}</dt>
      <dd>{legalTax.kind==='SAVED'?ar?'محفوظ':'Saved':
        legalTax.kind==='MISSING'?ar?'غير مدخل':'Missing':
        legalTax.kind==='LOADING'?ar?'جار التحقق':'Checking':ar?'تعذر التحقق':'Unavailable'}</dd></div>
    <div><dt>{ar?'عنوان بائع الفاتورة':'Seller invoice address'}</dt>
      <dd>{legalTax.kind==='SAVED'&&legalTax.hasInvoiceAddress?ar?'مدخل':'Entered':ar?'بحاجة مراجعة':'Review'}</dd></div>
    <div><dt>{ar?'حالة التسجيل':'Tax registration'}</dt><dd>{
      legalTax.registration==='REGISTERED'?ar?'مسجل':'Registered':
      legalTax.registration==='NOT_REGISTERED'?ar?'غير مسجل':'Not registered':
      legalTax.registration==='PENDING'?ar?'قيد التسجيل':'Pending':
      legalTax.registration==='DEREGISTERED'?ar?'ملغى':'Deregistered':ar?'غير محددة':'Not specified'}</dd></div>
   </dl>
   <p>{ar?'تُحفظ بيانات الدولة والسجل والعنوان القانوني في سجل المؤسسة الأصلي، وتبقى بيانات بائع الفاتورة والضريبة منفصلة. لا يُعد الحفظ شهادة امتثال، كما أن ZATCA تخص السعودية.':
      'Country, registration and legal address use the original organization record; invoice seller and VAT settings remain separate. Saving does not certify statutory compliance; ZATCA is Saudi-specific.'}</p>
   <button type="button" className="financial-setup-summary-refresh" disabled={!mode} onClick={()=>onSelect('regulatory')}>
    {ar?'فتح العنوان والضرائب والفوترة':'Open address, tax and invoicing'}
   </button>
  </section>
  <section className="financial-setup-summary-card">
   <h3>{ar?'يمكن إكمالها لاحقًا':'Can be completed later'}</h3>
   <p>{ar?'يمكن تأجيل العمل المستقل دون أن نعتبره معتمدًا أو مكتملًا.':'Independent work can be deferred without being treated as approved or complete.'}</p>
   {skipCandidates.length>0?<ul className="financial-setup-optional-list">
    {skipCandidates.map(id=><li key={id}>
     <span>{SETUP_JOURNEY_LABELS[id][ar?0:1]}</span>
     <small>{deferred.includes(id)?ar?'مؤجل':'Deferred':ar?'قابل للتجاوز':'Skippable'}</small>
    </li>)}
   </ul>:<p>{ar?'لا توجد خطوات مستقلة قابلة للتجاوز حاليًا.':'No independent step can be deferred yet.'}</p>}
  </section>
  <SubscriptionSetupSummary locale={locale} organizationId={organizationId}/>
  <section className="financial-setup-summary-tip">
   <strong>{ar?'معلومة مهمة':'Important'}</strong>
   <p>{ar?'يمكن العودة لأي مرحلة، لكن التجاوز لا ينشئ قيودًا ولا يمنح اعتمادًا محاسبيًا. إكمال الرحلة النهائي يتطلب تحقق جميع المتطلبات الفعلية.':
    'You can revisit any step. Deferral never posts entries or grants accounting approval. Final completion requires all actual source checks.'}</p>
  </section>
 </aside>;
}
