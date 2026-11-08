'use client';
import type {FinancialSetupMode,FinancialSetupStep} from '@/lib/financial-setup-steps';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import {financialSetupJourneyCounts,setupJourneyStepState,firstMissingFinancialSetupStep} from '@/lib/financial-setup-journey-policy';
import {SETUP_GROUPS,setupGroupState,type SetupGroupState} from '@/lib/financial-setup-presentation';
import SubscriptionSetupSummary from './SubscriptionSetupSummary';
export const SETUP_JOURNEY_LABELS:Record<FinancialSetupStep,[string,string]>={
 organization:['بيانات المؤسسة','Organization details'],regulatory:['البيانات النظامية والضريبية','Legal & tax settings'],structure:['الفروع والهيكل','Branches & structure'],chart:['دليل الحسابات','Chart of accounts'],fiscal:['السنة المالية','Fiscal year'],posting:['قواعد الترحيل','Posting rules'],banking:['النقد والبنوك','Cash & banking'],opening:['الأرصدة الافتتاحية','Opening balances'],users:['المستخدمون والصلاحيات','Users & permissions'],review:['المراجعة والاعتماد','Review & verification'],finished:['الإنهاء','Finish'],
};
type Context={locale:string;mode:FinancialSetupMode|null;readiness:FinancialSetupReadiness|null;completed:readonly FinancialSetupStep[];deferred:readonly FinancialSetupStep[];};
const stepLabels={COMPLETE:['مكتمل','Complete'],REVIEWED:['تمت المراجعة','Reviewed'],DEFERRED:['مؤجل مؤقتًا','Deferred'],OPTIONAL:['اختياري','Optional'],INCOMPLETE:['ناقص','Incomplete'],BLOCKED:['يتطلب معالجة','Needs action'],VERIFYING:['قيد التحقق','Checking']} as const;
const groupLabels:Record<SetupGroupState,[string,string]>={COMPLETE:['مكتمل','Complete'],REVIEWED:['تمت المراجعة','Reviewed'],IN_PROGRESS:['قيد التنفيذ','In progress'],MISSING:['ناقص','Incomplete'],CHECKING:['قيد التحقق','Checking']};
export function SetupJourneySidebar({locale,mode,readiness,completed,deferred,step,onSelect,organizationLegal,editing=true}:Context&{step:FinancialSetupStep;onSelect:(step:FinancialSetupStep)=>void;organizationLegal?:{country_code?:string|null}|null;editing?:boolean;}){
 const ar=locale==='ar';
 return <aside className="financial-setup-journey-timeline"><div className="financial-setup-journey-panel-title"><strong>{ar?'مجموعات الإعداد':'Setup groups'}</strong><span>{ar?'اختر مجموعة لاستكمال بياناتها':'Choose a group to continue'}</span></div>
  <nav className="financial-setup-stage-timeline financial-setup-steps" aria-label={ar?'خطوات إعداد المؤسسة':'Organization setup steps'}>
   {SETUP_GROUPS.map((group,index)=>{const active=group.steps.some(id=>id===step),state=setupGroupState(group,readiness,mode,completed,organizationLegal?.country_code);return <details key={group.id} className={'financial-setup-stage-group group-'+state.toLowerCase()} open={editing&&active}>
    <summary onClick={event=>{event.preventDefault();if(mode||group.id==='organization')onSelect(group.id);}} aria-disabled={!mode&&group.id!=='organization'}>
     <span className="financial-setup-group-number" aria-hidden="true">{state==='COMPLETE'?'✓':index+1}</span><span className="financial-setup-group-title"><strong>{ar?group.ar:group.en}</strong><small>{ar?group.helpAr:group.helpEn}</small></span><span className={'financial-setup-group-state state-'+state.toLowerCase()}>{groupLabels[state][ar?0:1]}</span>
    </summary>
    {group.steps.map(id=>{const state=id==='organization'&&mode&&!organizationLegal?.country_code?'INCOMPLETE':setupJourneyStepState(id,readiness,deferred,completed,mode);return <button type="button" key={id} aria-current={editing&&step===id?'step':undefined} disabled={!mode&&id!=='organization'} onClick={()=>onSelect(id)} className={['financial-setup-timeline-step',step===id?'current':'',state==='COMPLETE'?'done':'',state.toLowerCase()].filter(Boolean).join(' ')}><span className="financial-setup-timeline-copy"><strong>{SETUP_JOURNEY_LABELS[id][ar?0:1]}</strong><span className={'financial-setup-timeline-state state-'+state.toLowerCase()}>{stepLabels[state][ar?0:1]}</span></span></button>;})}
   </details>;})}
  </nav>
 </aside>;
}
export function SetupJourneySummary({locale,readiness,deferred,checking,onRefresh,organizationId}:Context&{checking:boolean;onRefresh:()=>void;organizationId:string;revision:number;organizationLegal?:{country_code?:string|null;commercial_registration_number?:string|null;registered_address?:string|null}|null;onSelect:(step:FinancialSetupStep)=>void;}){
 const ar=locale==='ar',counts=financialSetupJourneyCounts(readiness,deferred),known=Boolean(readiness)&&!checking;
 const inProgress=readiness?['organization','chart','fiscal','posting','banking','opening','users'].filter(id=>readiness.statuses[id as FinancialSetupStep]==='IN_PROGRESS').length:0;
 return <aside className="financial-setup-journey-summary" aria-label={ar?'ملخص جاهزية المؤسسة':'Organization readiness summary'}>
  <section className="financial-setup-summary-card financial-setup-readiness-card" aria-busy={checking}>
   <h3>{ar?'جاهزية التأسيس المالي':'Financial setup readiness'}</h3><div className="financial-setup-progress-heading"><div className="financial-setup-summary-percent"><bdi>{known?counts.percent+'%':'—'}</bdi></div><div className="financial-setup-progress-bar" role="progressbar" aria-valuenow={known?counts.percent:undefined} aria-valuetext={!known?(ar?'جارٍ التحقق من البيانات':'Checking saved records'):undefined} aria-valuemin={0} aria-valuemax={100} aria-label={ar?'الجاهزية الفعلية من السجلات':'Verified source readiness'}><span style={{width:(known?counts.percent:0)+'%'}}/></div></div>
   <p>{ar?'تُحسب من متطلبات التأسيس المالي المتحقق منها. تُراجع بيانات الهوية والضرائب بصورة مستقلة.':'Based on verified financial requirements. Identity and tax records are reviewed separately.'}</p>
   <dl className="financial-setup-journey-metrics"><div><dd><bdi>{known?counts.complete:'—'}</bdi></dd><dt>{ar?'مكتمل':'Complete'}</dt></div><div><dd><bdi>{known?inProgress:'—'}</bdi></dd><dt>{ar?'قيد التنفيذ':'In progress'}</dt></div><div><dd><bdi>{known?counts.remaining-inProgress:'—'}</bdi></dd><dt>{ar?'ناقص':'Incomplete'}</dt></div></dl>
   <button type="button" onClick={onRefresh} disabled={checking} className="financial-setup-summary-refresh">{checking?(ar?'جار التحقق…':'Checking…'):(ar?'تحديث الحالة':'Refresh readiness')}</button>
  </section><SubscriptionSetupSummary locale={locale} organizationId={organizationId}/>
 </aside>;
}
export function SetupMissingRequirements({locale,readiness,organizationLegal,onSelect,mode,checking=false}: {locale:string;readiness:FinancialSetupReadiness|null;organizationLegal:{country_code?:string|null;registered_address?:string|null;commercial_registration_number?:string|null};onSelect:(step:FinancialSetupStep)=>void;mode?:FinancialSetupMode|null;checking?:boolean;}){
 const ar=locale==='ar',missing:FinancialSetupStep[]=[];
 if(!mode||!organizationLegal.country_code)missing.push('organization');
 if(!organizationLegal.registered_address||!organizationLegal.commercial_registration_number)missing.push('regulatory');
 if(readiness)for(const id of ['chart','fiscal','posting','banking','opening','users'] as const){if(readiness.statuses[id]!=='READY')missing.push(id);}
 const next=!organizationLegal.country_code?'organization':firstMissingFinancialSetupStep(readiness,mode??null);
 return <><section className="financial-setup-dashboard-resume"><div><h3>{!mode?(ar?'ابدأ إعداد المؤسسة':'Start your organization setup'):readiness?.ready?(ar?'تابع المراجعة النهائية':'Continue your final review'):(ar?'لديك متطلبات تحتاج إلى استكمال':'You have outstanding requirements')}</h3><p>{ar?'متابعة الإعداد تعيدك إلى أول متطلب أساسي غير مكتمل.':'Continue setup returns to your first incomplete requirement.'}</p></div><button type="button" className="financial-setup-resume" disabled={checking&&Boolean(mode)} onClick={()=>onSelect(next)}><span>{ar?'متابعة الإعداد':'Continue setup'}</span><small className="financial-setup-sr-only">{ar?'أول متطلب أساسي غير مكتمل: ':'First incomplete setup requirement: '}{SETUP_JOURNEY_LABELS[next][ar?0:1]}</small></button></section>
  <section className="financial-setup-missing"><h3>{ar?'أحدث المتطلبات الناقصة':'Outstanding setup requirements'}</h3><p className="financial-setup-missing-intro">{ar?'استكمل البيانات من النماذج المرتبطة بهذه المؤسسة.':'Complete details in this organization’s settings forms.'}</p>
   {checking&&<p role="status">{ar?'جارٍ التحقق من المتطلبات المالية…':'Checking financial requirements…'}</p>}
   {missing.slice(0,4).map(id=><div key={id}><span>{SETUP_JOURNEY_LABELS[id][ar?0:1]}</span><small>{id==='regulatory'?(ar?'مراجعة البيانات':'Review details'):(ar?'مطلوب':'Required')}</small><button type="button" disabled={!mode&&id!=='organization'} onClick={()=>onSelect(id)}>{ar?'استكمال الآن':'Complete now'} <span aria-hidden="true">←</span></button></div>)}
   {readiness&&!checking&&missing.length===0&&<p>{ar?'لا توجد متطلبات ناقصة في الفحص الحالي. تابع المراجعة النهائية.':'No missing requirements in the current check. Continue to final review.'}</p>}
  </section><div className="financial-setup-dashboard-legend"><span><b>{ar?'مطلوب':'Required'}</b> {ar?'أساسي للجاهزية المالية':'Required for financial readiness'}</span><span><b>{ar?'اختياري':'Optional'}</b> {ar?'يمكن استكماله لاحقًا':'Can be completed later'}</span><span><b>{ar?'غير منطبق':'Not applicable'}</b> {ar?'بحسب بداية المؤسسة ونشاطها':'Depends on starting mode and activity'}</span></div>
 </>;
}
