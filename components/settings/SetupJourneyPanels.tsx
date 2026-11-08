'use client';

import {Fragment} from 'react';
import type {FinancialSetupMode,FinancialSetupStep} from '@/lib/financial-setup-steps';
import {FINANCIAL_SETUP_STEPS,isSkippedSetupStep} from '@/lib/financial-setup-steps';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import {canDeferSetupStep,FINANCIAL_SETUP_STEP_HELP,financialSetupJourneyCounts,setupJourneyStepState} from '@/lib/financial-setup-journey-policy';

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

export function SetupJourneySummary({locale,mode,readiness,completed,deferred,checking,onRefresh}:Context&{
 checking:boolean;onRefresh:()=>void;
}){
 const ar=locale==='ar';
 const counts=financialSetupJourneyCounts(readiness,deferred);
 const skipCandidates=FINANCIAL_SETUP_STEPS.filter(step=>
  !['review','finished'].includes(step)&&canDeferSetupStep(step,mode,readiness?.statuses??null));
 return <aside className="financial-setup-journey-summary" aria-label={ar?'ملخص جاهزية المؤسسة':'Organization readiness summary'}>
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
   <h3>{ar?'يمكن إكمالها لاحقًا':'Can be completed later'}</h3>
   <p>{ar?'يمكن تأجيل العمل المستقل دون أن نعتبره معتمدًا أو مكتملًا.':'Independent work can be deferred without being treated as approved or complete.'}</p>
   {skipCandidates.length>0?<ul className="financial-setup-optional-list">
    {skipCandidates.map(id=><li key={id}>
     <span>{SETUP_JOURNEY_LABELS[id][ar?0:1]}</span>
     <small>{deferred.includes(id)?ar?'مؤجل':'Deferred':ar?'قابل للتجاوز':'Skippable'}</small>
    </li>)}
   </ul>:<p>{ar?'لا توجد خطوات مستقلة قابلة للتجاوز حاليًا.':'No independent step can be deferred yet.'}</p>}
  </section>
  <section className="financial-setup-summary-tip">
   <strong>{ar?'معلومة مهمة':'Important'}</strong>
   <p>{ar?'يمكن العودة لأي مرحلة، لكن التجاوز لا ينشئ قيودًا ولا يمنح اعتمادًا محاسبيًا. إكمال الرحلة النهائي يتطلب تحقق جميع المتطلبات الفعلية.':
    'You can revisit any step. Deferral never posts entries or grants accounting approval. Final completion requires all actual source checks.'}</p>
  </section>
 </aside>;
}
