"use client";
import {useId,useState,type FormEvent} from "react";
import {MODULES,FEATURES,money,planCustomerNotice,type Plan} from "@/lib/subscriptions/catalog";
import {OwnerActionIcon} from "./OwnerSubscriptionVisuals";

export default function PlanEditor({plan,locale,busy,error,onSave,onCancel}:{plan:Plan|null;locale:string;busy:boolean;error:string;onSave:(event:FormEvent<HTMLFormElement>)=>void;onCancel:()=>void}) {
 const ar=locale==='ar',id=useId(),t=(a:string,e:string)=>ar?a:e;
 const [draft,setDraft]=useState({name_ar:plan?.name_ar??'',name_en:plan?.name_en??'',price:String(plan?.price_amount??''),currency:plan?.currency??'SAR',interval:plan?.billing_interval??'monthly',max_users:String(plan?.max_users??5),is_active:plan?.is_active??true,is_published:plan?.is_published??false,is_proposed:plan?.is_proposed??true,customer_notice_ar:plan?.customer_notice_ar??'',customer_notice_en:plan?.customer_notice_en??''});
 const set=(key:keyof typeof draft,value:string|boolean)=>setDraft(d=>({...d,[key]:value}));
 function field(key:'name_ar'|'name_en'|'price'|'currency'|'max_users',label:string,props:React.InputHTMLAttributes<HTMLInputElement>={}) {
  return <label>{label}<input name={key} value={draft[key]} onChange={e=>set(key,e.target.value)} required {...props}/></label>;
 }
 const notice=planCustomerNotice(draft,ar);
 return <form onSubmit={onSave} onInvalidCapture={event=>{const detail=(event.target as HTMLElement).closest('details');if(detail)detail.open=true;}}>
  <fieldset disabled={busy} className="plan-editor">
   <legend>{t('تعريف الباقة','Plan definition')}</legend>
   <div className="owner-plan-scroll">
    <p className="owner-plan-subtitle">{t('حدد بيانات الباقة ومميزاتها وإعدادات ظهورها.','Define the plan, its capabilities and how it appears to customers.')}</p>
    <div className="owner-plan-grid">
     <section className="owner-plan-information" aria-labelledby={id+'-information'}>
      <h3 id={id+'-information'}>{t('معلومات الباقة والتسعير','Plan information and pricing')}</h3>
      <div className="owner-plan-fields">
       {field('name_ar',t('الاسم العربي','Arabic name'),{minLength:2,maxLength:120,dir:'rtl'})}
       {field('name_en',t('الاسم الإنجليزي','English name'),{minLength:2,maxLength:120,dir:'ltr'})}
       <div className="plan-price-row">{field('price',draft.interval==='monthly'?t('السعر للشهر كاملًا','Full monthly price'):t('السعر للسنة كاملة','Full yearly price'),{type:'number',min:0,max:100000000,step:'0.01',inputMode:'decimal',dir:'ltr'})}
       {field('currency',t('العملة','Currency'),{pattern:'[A-Z]{3}',maxLength:3,dir:'ltr'})}</div>
       <label>{t('فترة الاشتراك','Billing interval')}<select name="interval" value={draft.interval} onChange={e=>set('interval',e.target.value)}><option value="monthly">{t('شهري','Monthly')}</option><option value="yearly">{t('سنوي','Yearly')}</option></select></label>
       {field('max_users',t('حد المستخدمين النشطين','Active user limit'),{type:'number',min:1,max:100000,inputMode:'numeric',dir:'ltr'})}
       <label className="plan-field-wide">{t('الوصف المختصر','Short description')}<textarea name={ar?'description_ar':'description_en'} maxLength={500} defaultValue={ar?plan?.description_ar:plan?.description_en} dir={ar?'rtl':'ltr'}/></label>
      </div>
      <details className="owner-plan-advanced"><summary>{t('إعدادات إضافية','Additional settings')}</summary><div className="owner-plan-fields">
       <label>{t('رمز الباقة الثابت','Immutable code')}<input name="code" pattern="[a-z0-9_-]{2,40}" defaultValue={plan?.code} readOnly={!!plan} required dir="ltr"/></label>
       <label>{t('مجموعة الباقة (للشهري والسنوي)','Plan family (monthly/yearly)')}<input name="family" pattern="[a-z0-9_-]{2,40}" defaultValue={plan?.family??'custom'} required dir="ltr"/></label>
       <label className="plan-field-wide">{t('الوصف الإنجليزي','Arabic description')}<textarea name={ar?'description_en':'description_ar'} maxLength={500} defaultValue={ar?plan?.description_en:plan?.description_ar} dir={ar?'ltr':'rtl'}/></label>
      </div></details>
     </section>
     <section className="owner-plan-options" aria-labelledby={id+'-options'}>
      <h3 id={id+'-options'}>{t('الموديولات والمميزات','Modules and features')}</h3>
      <p>{t('القراءة والتصدير محفوظان. حدد إمكانات الكتابة التي تشملها الباقة.','Reading and export remain available. Select the writing capabilities included.')}</p>
      <fieldset className="plan-capabilities"><legend>{t('الموديولات والمميزات المتاحة للكتابة','Modules and features available for writing')}</legend>
       {MODULES.map(m=><label className="plan-check" key={m.key}><input type="checkbox" name="features" value={'module:'+m.key} defaultChecked={m.core||!plan||plan.features.includes('core')||plan.features.includes('module:'+m.key)} disabled={m.core}/>{m.core&&<input type="hidden" name="features" value={'module:'+m.key}/>}<span>{ar?m.ar:m.en}</span>{m.core&&<small className="plan-foundation">{t('أساسي','Core')}</small>}</label>)}
       {FEATURES.map(m=><label className="plan-check" key={m.key}><input type="checkbox" name="features" value={'feature:'+m.key} defaultChecked={!!plan&&(plan.features.includes('core')||plan.features.includes('feature:'+m.key))}/><span>{ar?m.ar:m.en}</span></label>)}
      </fieldset>
     </section>
    </div>
    <section className="owner-plan-visibility" aria-labelledby={id+'-visibility'}><h3 id={id+'-visibility'}>{t('الإتاحة والنشر','Availability and publishing')}</h3>
     <div className="owner-plan-publication">
      {([
       ['is_active',t('متاحة للتفعيل اليدوي','Available for manual activation'),t('يمكن للمالك تفعيلها للمؤسسات.','The platform owner can activate it for organizations.')],
       ['is_published',t('منشورة للمستخدمين','Published to users'),t('تظهر ضمن الباقات المتاحة عندما تكون مفعّلة.','Appears in the available catalog when enabled.')],
       ['is_proposed',t('إظهار رسالة للعميل','Show a customer message'),t('تظهر على بطاقة الباقة؛ لا تغيّر السعر أو طريقة التفعيل.','Displayed on the plan card; does not change pricing or activation.')],
      ] as const).map(([key,label,help])=><label className="plan-check plan-toggle" key={key}><span className="plan-toggle-copy"><strong>{label}</strong><small>{help}</small></span><span className="plan-switch"><input type="checkbox" name={key} checked={draft[key]} onChange={e=>set(key,e.target.checked)}/><span aria-hidden="true"/></span></label>)}
     </div>
     <div className="owner-plan-fields plan-notice-fields" hidden={!draft.is_proposed}>
      <label>{t('رسالة العميل بالعربية','Customer message in Arabic')}<input name="customer_notice_ar" maxLength={160} value={draft.customer_notice_ar} onChange={e=>set('customer_notice_ar',e.target.value)} placeholder="سعر إطلاق مقترح" dir="rtl"/><small>{t('اتركها فارغة لاستخدام «سعر إطلاق مقترح».','Leave blank to use the default Arabic message.')}</small></label>
      <label>{t('رسالة العميل بالإنجليزية','Customer message in English')}<input name="customer_notice_en" maxLength={160} value={draft.customer_notice_en} onChange={e=>set('customer_notice_en',e.target.value)} placeholder="Proposed launch price" dir="ltr"/><small>{t('تظهر للعميل عند استخدام الإنجليزية.','Shown to customers using English; blank uses the default.')}</small></label>
     </div>
    </section>
    <section className="owner-plan-preview" aria-labelledby={id+'-preview'}><h3 id={id+'-preview'}>{t('معاينة مختصرة للباقة','Plan preview')}</h3><div><strong>{(ar?draft.name_ar:draft.name_en)||t('اسم الباقة','Plan name')}</strong><span><bdi>{money(Number(draft.price)||0,/^[A-Z]{3}$/.test(draft.currency)?draft.currency:'SAR',locale)}</bdi> / {draft.interval==='monthly'?t('شهر','month'):t('سنة','year')} · <bdi>{draft.max_users}</bdi> {t('مستخدمين','users')}</span>{draft.is_proposed&&<span className="plan-notice-preview">{notice}</span>}</div></section>
    <label className="owner-plan-reason">{t('سبب التغيير','Reason')}<textarea name="reason" minLength={5} maxLength={1000} required placeholder={t('أدخل سبب إضافة هذه الباقة أو تعديلها.','Explain why this plan is being added or changed.')}/></label>
    {error&&<p className="owner-feedback" data-tone="error" role="alert">{error}</p>}
   </div>
   <div className="owner-plan-actions"><button className="primary" type="submit" disabled={busy}><OwnerActionIcon name="save"/>{busy?t('جارٍ الحفظ…','Saving…'):t('حفظ الباقة','Save plan')}</button><button type="button" onClick={onCancel}><OwnerActionIcon name="cancel"/>{t('إلغاء','Cancel')}</button></div>
  </fieldset>
 </form>;
}
