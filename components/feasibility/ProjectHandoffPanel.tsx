'use client';
import {useEffect,useState} from 'react';
import {handoffReadiness,handoffSetupPath} from '@/lib/feasibility/handoff';
import type {FeasibilityStudy,HandoffMode,ProjectHandoff} from '@/lib/feasibility/engine';
type Company={id:string;name:string;entity_type:string;base_currency?:string};
export default function ProjectHandoffPanel({study,locale,onChange}:{study:FeasibilityStudy;locale:string;onChange:(next:ProjectHandoff)=>void}){
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
 const chosen=organizations.find(x=>x.id===h.organizationId);
 const setupPath=chosen?handoffSetupPath(locale,chosen.id,organizations.map(x=>x.id)):null;
 const sameCurrency=Boolean(chosen&&chosen.base_currency===study.currency);
 const enabled=process.env.NEXT_PUBLIC_FINANCIAL_CORE_V2_HANDOFF==='true';
 return <section className="card fs-panel fs-handoff" aria-label={t('الاعتماد وتأسيس الشركة','Approval and establishment')}>
  <h3>{t('من الدراسة إلى شركة تشغيل','From study to operating company')}</h3>
  <p className="fs-handoff-intro">{t('مراجعة أولية في نسخة QA فقط؛ ليست اعتمادًا قانونيًا أو محاسبيًا. لا تنقل هذه الصفحة توقعات الدراسة إلى دفاتر الشركة ولا تنشئ شركة تلقائيًا.','QA-only preliminary review, not statutory or accounting approval. Forecasts never become journal entries and no company is created automatically.')}</p>
  <div className="fs-handoff-steps">
   <div className="fs-handoff-step" data-ready={review.ready}><strong>{t('1. جاهزية الدراسة','1. Study readiness')}</strong>{t('تحقق الافتراضات والتمويل والتراخيص','Review assumptions, funding and licences')}</div>
   <div className="fs-handoff-step" data-ready={reviewed}><strong>{t('2. مراجعة داخلية','2. Internal review')}</strong>{t('تأكيد نسخة الدراسة الحالية','Confirm the current study revision')}</div>
   <div className="fs-handoff-step" data-ready={Boolean(setupPath&&reviewed&&sameCurrency)}><strong>{t('3. اختيار الشركة','3. Choose company')}</strong>{t('إنشاء أو ربط جهة مخوّلة في V2','Create or link an authorized V2 company')}</div>
  </div>
  <h3>{t('شروط الانتقال','Readiness checklist')}</h3>
  {review.checks.map(item=><div className="fs-row" key={item.key}><span>{ar?item.ar:item.en}</span><strong>{item.passed?'✓':t('ناقص','Missing')}</strong></div>)}
  {!reviewed?<button type="button" className="fs-btn" disabled={!review.ready} onClick={()=>patch({reviewedSourceUpdatedAt:study.updatedAt,reviewedAt:new Date().toISOString()})}>{t('تأكيد المراجعة الداخلية لهذه النسخة','Confirm internal review of this revision')}</button>:<p className="fs-handoff-note">{t('تمت المراجعة المبدئية. أي تعديل لاحق في الدراسة يلغي صلاحية هذه المراجعة.','Preliminary review recorded. Editing study inputs invalidates this review.')}</p>}
  {reviewed&&<>
   <h3>{t('ما الخطوة التالية؟','Choose the next step')}</h3>
   {([['LATER','الاحتفاظ بالدراسة دون تأسيس','Keep study without incorporation'],['NEW','تأسيس شركة جديدة','Create a new company'],['EXISTING','ربط شركة قائمة','Link an existing company']] as const).map(([mode,a,b])=>
    <label className="fs-handoff-choice" key={mode}><input type="radio" name={'handoff-'+study.id} checked={h.mode===mode} onChange={()=>patch({mode,organizationId:undefined})}/>{t(a,b)}</label>)}
   {h.mode==='NEW'&&<>
    <p className="fs-handoff-note">{t('استخدم شاشة إنشاء المؤسسات الرسمية، ثم ارجع واختر «ربط شركة قائمة» لتحديد الشركة الجديدة وتفعيل إعداد V2 عند اعتماده.','Use the authorized organization creation flow; return here and select Link existing company to bind the new company once V2 setup is approved.')}</p>
    <a className="fs-handoff-link" href={'/'+locale+'/organizations'}>{t('فتح إدارة المؤسسات','Open organization directory')}</a>
   </>}
   {h.mode==='EXISTING'&&<>
    <label className="fs-field"><span>{t('شركة مخوّل لك الوصول إليها','Authorized company')}</span><select disabled={loading||!!error} value={h.organizationId??''} onChange={e=>patch({organizationId:e.currentTarget.value||undefined})}>
     <option value="">{loading?t('جارٍ التحقق…','Loading…'):t('اختر شركة','Choose company')}</option>
     {organizations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.base_currency??'—'}</option>)}
    </select></label>
    {error&&<p role="alert" className="fs-handoff-note">{error}</p>}
    {chosen&&!sameCurrency&&<p role="alert" className="fs-handoff-note">{t('عملة الدراسة لا توافق العملة الأساسية للشركة؛ تتطلب مراجعة تحويل العملات قبل الانتقال.','Study currency differs from company base currency; a documented FX review is required before transition.')}</p>}
    {setupPath&&sameCurrency&&enabled?<a className="fs-handoff-link" href={setupPath}>{t('الانتقال إلى إعداد الشركة — Financial Core V2','Continue to company setup — Financial Core V2')}</a>:<p className="fs-handoff-note">{t('ربط V2 المحاسبي معطّل حتى اعتماد عقد التكامل واختبارات صلاحيات QA V2.','Accounting integration remains disabled until the versioned V2 contract and QA permission tests pass.')}</p>}
   </>}
  </>}
  <p className="fs-handoff-note">{t('بيانات هذه المراجعة محفوظة حاليًا في المتصفح فقط؛ الاعتماد الرسمي يتطلب سجلًا مؤمّنًا على الخادم، وصلاحيات واعتمادات نهائية.','This review is browser-local only. Formal approval needs server-side immutable records and verified permissions.')}</p>
 </section>;
}
