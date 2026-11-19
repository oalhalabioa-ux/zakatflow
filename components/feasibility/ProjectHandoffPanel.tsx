'use client';
import {useEffect,useState} from 'react';
import {handoffReadiness,handoffSetupPath} from '@/lib/feasibility/handoff';
import {RoyalIcon} from './RoyalIcon';
import ReviewSnapshotPanel from './ReviewSnapshotPanel';
import type {FeasibilityStudy,HandoffMode,ProjectHandoff} from '@/lib/feasibility/engine';
type Company={id:string;name:string;entity_type:string;base_currency?:string};
export default function ProjectHandoffPanel({study,locale,onChange,cloudRevision,cloudCurrent=false,cloudEnabled=false,canWrite=true,bannerOrganizationId}:{study:FeasibilityStudy;locale:string;onChange:(next:ProjectHandoff)=>void;cloudRevision?:number;cloudCurrent?:boolean;cloudEnabled?:boolean;canWrite?:boolean;bannerOrganizationId?:string}){
 const ar=locale==='ar', h=study.handoff??{mode:'LATER' as HandoffMode};
 const review=handoffReadiness(study);
 const reviewed=review.ready&&h.reviewedSourceUpdatedAt===study.updatedAt;
 const [organizations,setOrganizations]=useState<Company[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const t=(a:string,b:string)=>ar?a:b;
 const patch=(p:Partial<ProjectHandoff>)=>onChange({...h,...p});
 useEffect(()=>{
  if(!reviewed||h.mode!=='EXISTING')return;
  const controller=new AbortController();setLoading(true);setError('');
  fetch('/api/organizations',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('UNAUTHORIZED_OR_UNAVAILABLE');
   const items=await response.json();
   if(!Array.isArray(items))throw new Error('INVALID_COMPANY_RESPONSE');
   return items as Company[];
  }).then(items=>{if(!controller.signal.aborted)setOrganizations(items.filter(x=>x.entity_type==='COMPANY'&&typeof x.id==='string'))})
   .catch(()=>{if(!controller.signal.aborted)setError(t('تعذر التحقق من الشركات المصرح بها.','Could not verify authorized companies.'))})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[h.mode,reviewed,ar]);
 const chosen=organizations.find(x=>x.id===bannerOrganizationId);
 const setupPath=chosen&&chosen.id===h.organizationId?handoffSetupPath(locale,chosen.id,organizations.map(x=>x.id)):null;
 const sameCurrency=Boolean(chosen&&chosen.base_currency===study.currency);
 const completed=review.checks.filter(item=>item.passed).length;
 const ratio=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(completed/review.checks.length);
 const legalChecks=review.checks.filter(item=>item.key==='legal'||item.key==='blockers');
 const modelChecks=review.checks.filter(item=>item.key==='model'||item.key==='finance');
 const enabled=process.env.NEXT_PUBLIC_FINANCIAL_CORE_V2_HANDOFF==='true';
 return <section className="fs-block fs-handoff" aria-label={t('الاعتماد وتأسيس الشركة','Approval and establishment')}>
  <div className="fs-kpis fs-royal-overview-kpis">{[
   [t('جاهزية الدراسة','Study readiness'),ratio],
   [t('شروط الفحص القانوني','Legal checks'),legalChecks.filter(item=>item.passed).length+' / '+legalChecks.length],
   [t('شروط النموذج والتمويل','Model and funding checks'),modelChecks.filter(item=>item.passed).length+' / '+modelChecks.length],
   [t('المتطلبات المفتوحة','Open checks'),review.checks.length-completed]
  ].map(([label,value])=><div key={label} className="fs-metric"><small>{label}</small><strong><bdi>{value}</bdi></strong></div>)}</div>
  <p className="fs-handoff-intro">{t('مراجعة أولية في نسخة QA فقط؛ ليست اعتمادًا قانونيًا أو محاسبيًا. لا تنقل هذه الصفحة توقعات الدراسة إلى دفاتر الشركة ولا تنشئ شركة تلقائيًا.','QA-only preliminary review, not statutory or accounting approval. Forecasts never become journal entries and no company is created automatically.')}</p>
  <div className="fs-royal-profile-grid">
   <section className="card fs-panel">
  <h3>{t('شروط الانتقال','Readiness checklist')}</h3>
  <div className="fs-handoff-intro">
   <div className="fs-row"><strong>{t('متطلبات الجاهزية المكتملة','Completed readiness requirements')}</strong>
    <strong>{completed} / {review.checks.length}</strong></div>
   <progress value={completed} max={review.checks.length}
    aria-label={t('متطلبات الجاهزية المكتملة','Completed readiness requirements')}/>
  </div>
  <ul className="fs-royal-checks">{review.checks.map(item=><li key={item.key}>
   <span>{ar?item.ar:item.en}</span><strong data-complete={item.passed}>{item.passed?t('مكتمل','Complete'):t('ناقص','Missing')}</strong>
  </li>)}</ul>
  {!reviewed?<button type="button" className="fs-btn" disabled={!review.ready||!canWrite} onClick={()=>patch({reviewedSourceUpdatedAt:study.updatedAt,reviewedAt:new Date().toISOString()})}>{t('تأكيد المراجعة الداخلية لهذه النسخة','Confirm internal review of this revision')}</button>:<p className="fs-handoff-note">{t('تمت المراجعة المبدئية. أي تعديل لاحق في الدراسة يلغي صلاحية هذه المراجعة.','Preliminary review recorded. Editing study inputs invalidates this review.')}</p>}
   </section>
   <section className="card fs-panel">
   <h3>{t('وجهة المرحلة التالية','Next stage')}</h3>
   {!reviewed&&<p className="fs-hint">{t('تتاح خيارات التأسيس بعد تأكيد المراجعة الداخلية للنسخة.','Company setup options become available after internal review of this revision.')}</p>}
   {reviewed&&<>
   {([['LATER','الاحتفاظ بالدراسة دون تأسيس','Keep study without incorporation'],['NEW','تأسيس شركة جديدة','Create a new company'],['EXISTING','ربط شركة قائمة','Link an existing company']] as const).map(([mode,a,b])=>
    <label className="fs-handoff-choice" key={mode}><input type="radio" name={'handoff-'+study.id} checked={h.mode===mode} onChange={()=>patch({mode,organizationId:undefined})}/>{t(a,b)}</label>)}
   {h.mode==='NEW'&&<>
    <p className="fs-handoff-note">{t('استخدم شاشة إنشاء المؤسسات الرسمية، ثم ارجع واختر «ربط شركة قائمة» لتحديد الشركة الجديدة وتفعيل إعداد V2 عند اعتماده.','Use the authorized organization creation flow; return here and select Link existing company to bind the new company once V2 setup is approved.')}</p>
    {canWrite&&<a className="fs-handoff-link" href={'/'+locale+'/organizations'}>{t('فتح إدارة المؤسسات','Open organization directory')}</a>}
   </>}
   {h.mode==='EXISTING'&&<>
    <div className="fs-handoff-intro">
     <div className="fs-row"><strong><RoyalIcon name="building"/> {t('المؤسسة من البنر الرئيسي','Organization from the main banner')}</strong>
      <span>{loading?t('جارٍ التحقق…','Verifying…'):chosen?.name??t('اختر المؤسسة من البنر الرئيسي.','Select the organization in the main banner.')}</span></div>
     {chosen&&chosen.id!==h.organizationId&&<button type="button" className="fs-btn fs-btn--secondary"
      disabled={!canWrite||!sameCurrency||loading} onClick={()=>patch({organizationId:chosen.id})}>
      {t('ربط المؤسسة المحددة','Link selected organization')}</button>}
    </div>
    {error&&<p role="alert" className="fs-handoff-note">{error}</p>}
    {chosen&&!sameCurrency&&<p role="alert" className="fs-handoff-note">{t('عملة الدراسة لا توافق العملة الأساسية للشركة؛ تتطلب مراجعة تحويل العملات قبل الانتقال.','Study currency differs from company base currency; a documented FX review is required before transition.')}</p>}
    {setupPath&&sameCurrency&&enabled&&canWrite?<a className="fs-handoff-link" href={setupPath}>{t('الانتقال إلى إعداد الشركة — Financial Core V2','Continue to company setup — Financial Core V2')}</a>:<p className="fs-handoff-note">{t('ربط V2 المحاسبي معطّل حتى اعتماد عقد التكامل واختبارات صلاحيات QA V2.','Accounting integration remains disabled until the versioned V2 contract and QA permission tests pass.')}</p>}
   </>}
  </>}
   </section>
  </div>
  <section className="card fs-panel">
   <h3>{t('مسار تأسيس المشروع','Project establishment path')}</h3>
  <div className="fs-handoff-steps">
   <div className="fs-handoff-step" data-ready={review.ready}><strong>{t('1. جاهزية الدراسة','1. Study readiness')}</strong>{t('تحقق الافتراضات والتمويل والتراخيص','Review assumptions, funding and licences')}</div>
   <div className="fs-handoff-step" data-ready={reviewed}><strong>{t('2. مراجعة داخلية','2. Internal review')}</strong>{t('تأكيد نسخة الدراسة الحالية','Confirm the current study revision')}</div>
   <div className="fs-handoff-step" data-ready={Boolean(setupPath&&reviewed&&sameCurrency)}><strong>{t('3. اختيار الشركة','3. Choose company')}</strong>{t('إنشاء أو ربط جهة مخوّلة في V2','Create or link an authorized V2 company')}</div>
  </div>
  </section>
  <ReviewSnapshotPanel study={study} locale={locale} cloudRevision={cloudRevision} cloudCurrent={cloudCurrent} enabled={cloudEnabled} canWrite={canWrite}/>
  <p className="fs-handoff-note">{t('الاعتماد القانوني أو المحاسبي يتطلب توقيعات وصلاحيات رسمية مستقلة.','Legal and accounting approvals require separate formal permissions and signatures.')}</p>
 </section>;
}
