'use client';
import {useEffect,useState} from 'react';
import type {FeasibilityStudy,Sector,StudyStatus,StudyType} from '@/lib/feasibility/engine';
import {studyProfileValues,studyProfilePatch,studyTypeLabels} from '@/lib/feasibility/study-profile';
import {RoyalIcon} from './RoyalIcon';

function ProfileNumber({label,value,min,max,integer=false,optional=false,onChange}:{
 label:string;value:number|undefined;min:number;max:number;integer?:boolean;optional?:boolean;onChange:(value:number|undefined)=>void;
}){
 const [draft,setDraft]=useState(value===undefined?'':String(value));
 useEffect(()=>setDraft(value===undefined?'':String(value)),[value]);
 const numeric=Number(draft),valid=draft===''?optional:Number.isFinite(numeric)&&numeric>=min&&numeric<=max&&(!integer||Number.isInteger(numeric));
 return <label className="fs-field"><span>{label}</span><input type="number" inputMode={integer?'numeric':'decimal'}
  min={min} max={max} step={integer?1:'any'} required={!optional} value={draft} aria-invalid={!valid||undefined}
  onChange={e=>{
   const text=e.currentTarget.value;setDraft(text);
   if(e.currentTarget.validity.valid)onChange(text===''?undefined:Number(text));
  }}/></label>;
}

export default function StudyProfilePanel({study,locale,personalScope,shared,readOnly,organizationName,revision,
 savedToCloud,saveBusy,onChange,onSave,onCopy,sectorOptions,statusOptions}:{
 study:FeasibilityStudy;locale:string;personalScope:boolean;shared:boolean;readOnly:boolean;organizationName?:string;revision?:number;
 savedToCloud:boolean;saveBusy:boolean;onChange:(patch:Partial<FeasibilityStudy>)=>void;onSave?:()=>void;onCopy?:()=>void;
 sectorOptions:readonly {value:Sector;label:string}[];statusOptions:readonly {value:StudyStatus;label:string}[];
}){
 const ar=locale==='ar',l=(a:string,e:string)=>ar?a:e,profile=studyProfileValues(study);
 const change=(patch:Parameters<typeof studyProfilePatch>[1])=>{
  const next=studyProfilePatch(study,patch);if(next)onChange(next);
 };
 return <form className="fs-block fs-royal-profile" aria-label={l('نموذج بيانات المشروع','Project profile form')}
  onSubmit={e=>{e.preventDefault();if(!readOnly&&!saveBusy)onSave?.()}}>
  <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('الهوية والوصف','Identity and description')}</h3>
   <div className="fs-form-grid fs-royal-profile-identity">
    <label className="fs-field"><span>{l('اسم المشروع','Project title')}</span><input required maxLength={300} value={study.title} onChange={e=>onChange({title:e.currentTarget.value})}/></label>
    <label className="fs-field"><span>{l('نوع النشاط','Sector')}</span><select disabled={!!study.water||!!study.rawLand} value={study.sector}
     onChange={e=>onChange({sector:e.currentTarget.value as Sector})}>{sectorOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
    <label className="fs-field"><span>{l('نوع الدراسة','Study type')}</span><select value={study.studyType??''}
     onChange={e=>onChange({studyType:(e.currentTarget.value||undefined) as StudyType|undefined})}>
     <option value="">{l('اختر نوع الدراسة','Select study type')}</option>
     {Object.entries(studyTypeLabels).map(([value,labels])=><option key={value} value={value}>{ar?labels.ar:labels.en}</option>)}
    </select></label>
    <label className="fs-field"><span>{l('الدولة','Country')}</span><input maxLength={120} value={study.country} onChange={e=>onChange({country:e.currentTarget.value})}/></label>
    <label className="fs-field"><span>{l('المدينة أو المنطقة','City / region')}</span><input maxLength={150} value={study.region} onChange={e=>onChange({region:e.currentTarget.value})}/></label>
    <label className="fs-field"><span>{l('عملة الدراسة الواحدة','Study currency')}</span><select value={study.currency} onChange={e=>onChange({currency:e.currentTarget.value})}>
     <option value="">{l('اختر العملة','Select currency')}</option>{['USD','SYP','SAR','EUR',...(!['','USD','SYP','SAR','EUR'].includes(study.currency)?[study.currency]:[])].map(x=><option key={x}>{x}</option>)}
    </select></label>
    <label className="fs-field fs-royal-profile-notes"><span>{l('وصف المشروع وهدف الدراسة','Project description and study objective')}</span><textarea maxLength={5000} value={study.notes??''} onChange={e=>onChange({notes:e.currentTarget.value})}/></label>
   </div>
   <p className="fs-hint">{l('تغيير رمز العملة لا يقوم بتحويل القيم؛ يجب تحديث الأرقام يدويًا قبل اعتماد النتائج.','Changing the currency code does not convert amounts; update all figures before using the results.')}</p>
  </section>
  <div className="fs-royal-profile-grid">
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="building"/>{l('الموقع والجدوى المبدئية','Location and preliminary feasibility')}</h3>
    <div className="fs-form-grid fs-royal-profile-location">
     <ProfileNumber label={l(study.rawLand?'المساحة قبل الاستبعادات (م²)':'مساحة الأرض (م²)',study.rawLand?'Area before exclusions (m²)':'Land area (m²)')}
      value={profile.area} min={0} max={1e12} onChange={area=>{if(area!==undefined)change({area})}}/>
     <label className="fs-field"><span>{l('موقع المشروع التفصيلي','Detailed project location')}</span><input maxLength={500} value={study.siteDescription??''} onChange={e=>onChange({siteDescription:e.currentTarget.value})}/></label>
     <ProfileNumber label={l('سنة بدء الدراسة','Study start year')} value={profile.startYear} min={1900} max={2200} integer optional={!study.rawLand}
      onChange={year=>change({startYear:year??null})}/>
     <ProfileNumber label={l('مدة الدراسة المتوقعة (سنوات)','Expected study duration (years)')} value={profile.years} min={profile.minYears} max={profile.maxYears} integer
      onChange={years=>{if(years!==undefined)change({years})}}/>
    </div>
    <p className="fs-hint">{l('بيانات الموقع والحقوق النظامية مبدئية ولا تعني اعتماد ترخيص تشغيل.','Location and legal rights are preliminary and do not imply an approved operating licence.')}</p>
    <p className="fs-hint">{study.rawLand?l('تعديل المساحة أو المدة هنا يغيّر مدخلات نموذج الأراضي نفسه. تبقى الاستبعادات ونسب توزيع التدفقات محفوظة.','Area and duration edit the land model itself; exclusions and cash-flow phasing are retained.'):
     l('ترتبط المدة بمحرك الدراسة نفسه. سنة البدء وصف زمني؛ لا تؤخر التدفقات أو تنشئ فترات محاسبية.','Duration uses the study engine. Start year is descriptive; it does not defer cash flows or create accounting periods.')}</p>
   </section>
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="users"/>{l('بيانات المالك وسياق الدراسة','Owner and study context')}</h3>
    <label className="fs-field"><span>{l('المالك القانوني وفق المستندات','Legal owner as documented')}</span><input maxLength={300} value={study.legalOwner??''} onChange={e=>onChange({legalOwner:e.currentTarget.value})}/></label>
    <p className="fs-hint">{l('الاسم المصرّح به لا يغيّر ملكية الدراسة أو صلاحياتها، ولا يغني عن التحقق من المستندات.','This declared name does not change study ownership or access and does not replace document verification.')}</p>
    <dl className="fs-royal-checks">
     <div><dt>{l('نطاق المشروع','Project scope')}</dt><dd><span className="fs-royal-tag">{shared?l('مشتركة','Shared'):personalScope?l('شخصي','Personal'):l('مؤسسي','Organization')}</span></dd></div>
     {!personalScope&&<div><dt>{l('المؤسسة المختارة من البنر','Organization selected in the header')}</dt><dd>{organizationName||'—'}</dd></div>}
     <div><dt>{l('حالة الحفظ السحابي','Cloud save state')}</dt><dd>{savedToCloud?l('الإصدار الحالي محفوظ','Current version saved'):l('الإصدار الحالي غير مؤكد سحابيًا','Current version not confirmed in cloud')}</dd></div>
     <div><dt>{l('الإصدار السحابي','Cloud revision')}</dt><dd><bdi>{revision??'—'}</bdi></dd></div>
     <div><dt>{l('صلاحية الدراسة','Study access')}</dt><dd><span className="fs-royal-tag">{readOnly?l('قراءة فقط','Read only'):l('تحرير','Editing')}</span></dd></div>
    </dl>
    <div className="fs-form-grid fs-royal-profile-context">
     <label className="fs-field"><span>{l('مرحلة المشروع','Stage')}</span><select value={study.status} onChange={e=>onChange({status:e.currentTarget.value as StudyStatus})}>
      {statusOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
     <label className="fs-field"><span>{l('معد الدراسة','Prepared by')}</span><input maxLength={5000} value={study.preparedBy??''} onChange={e=>onChange({preparedBy:e.currentTarget.value})}/></label>
     <label className="fs-field"><span>{l('تاريخ الدراسة','Study date')}</span><input type="date" value={study.studyDate??''} onChange={e=>onChange({studyDate:e.currentTarget.value})}/></label>
    </div>
   </section>
  </div>
  {(onSave||onCopy)&&<div className="fs-actions fs-royal-profile-actions" aria-label={l('إجراءات بيانات المشروع','Project profile actions')}>
   {onSave&&<button type="submit" className="fs-btn" disabled={readOnly||saveBusy}><RoyalIcon name="save"/>{l('حفظ التعديلات','Save changes')}</button>}
   {onCopy&&<button type="button" className="fs-btn fs-btn--secondary" onClick={onCopy} disabled={readOnly||saveBusy}><RoyalIcon name="copy"/>{l('نسخ إلى مؤسسة','Copy to organization')}</button>}
  </div>}
 </form>;
}
