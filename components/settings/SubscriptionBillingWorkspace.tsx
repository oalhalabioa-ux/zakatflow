'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import PricingCatalog from '@/components/subscriptions/PricingCatalog';
import {rememberedOrganization} from '@/lib/workspace-organization';
import {requestLabel,type ActivationRequest} from '@/lib/subscriptions/requests';
import {displaySubscriptionDate,subscriptionLabel,type OrganizationSubscription} from '@/lib/subscriptions/model';
import OrganizationSettings from './OrganizationSettings';
import './subscription-billing.css';
type Area='summary'|'plans'|'records'|'identity';
type RequestData={rows:ActivationRequest[];can_request:boolean};
export default function SubscriptionBillingWorkspace({locale}:{locale:string}){
 const ar=locale==='ar';const [area,setArea]=useState<Area>('summary'),[organization,setOrganization]=useState('');
 const [subscription,setSubscription]=useState<OrganizationSubscription|null>(null),[requests,setRequests]=useState<RequestData|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[recordsError,setRecordsError]=useState(false),[revision,setRevision]=useState(0);
 const version=useRef(0);
 useEffect(()=>{
  const read=()=>{setOrganization(new URLSearchParams(location.search).get('organization')??rememberedOrganization()??'');setRevision(v=>v+1);};
  read();window.addEventListener('zf-organization-selection',read);window.addEventListener('popstate',read);
  return()=>{window.removeEventListener('zf-organization-selection',read);window.removeEventListener('popstate',read);};
 },[]);
 useEffect(()=>{
  const c=new AbortController(),requestVersion=++version.current;
  setRequests(null);setSubscription(null);setLoading(true);setError(false);setRecordsError(false);
  if(!organization){setLoading(false);return()=>c.abort();}
  const current=()=>!c.signal.aborted&&version.current===requestVersion;
  fetch('/api/subscriptions?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:c.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<OrganizationSubscription>;})
   .then(data=>{if(current()){if(data.organization_id&&data.organization_id!==organization)throw Error();setSubscription(data);}})
   .catch(()=>{if(current())setError(true);}).finally(()=>{if(current())setLoading(false);});
  fetch('/api/subscriptions/requests?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:c.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<RequestData>;})
   .then(data=>{if(current())setRequests(data);}).catch(()=>{if(current())setRecordsError(true);});
  return()=>{c.abort();version.current++;};
 },[organization,revision]);
 const tabs=[{id:'summary',ar:'ملخص الاشتراك',en:'Subscription overview'},{id:'plans',ar:'الباقات والترقية',en:'Plans & upgrades'},{id:'records',ar:'الفواتير والمدفوعات',en:'Invoices & payments'},{id:'identity',ar:'بيانات الفوترة',en:'Billing details'}] as const;
 const plan=subscription?.plan_snapshot??subscription?.plan;
 const end=subscription?.status==='active'?subscription.current_period_end:subscription?.trial_ends_at;
 const usage=subscription?.max_users?Math.min(100,subscription.active_users/subscription.max_users*100):0;
 return <section className="yb-billing" aria-label={ar?'الاشتراك والفوترة':'Subscription and billing'}>
  <header className="yb-billing-header"><div><p>{ar?'المؤسسة / الاشتراك والفوترة':'Organization / Subscription & billing'}</p><h1>{ar?'الاشتراك والفوترة':'Subscription & billing'}</h1><span>{ar?'إدارة باقتك وحدود الاستخدام وطلبات التفعيل.':'Manage your plan, usage and activation requests.'}</span></div><Link href={`/${locale}/settings?organization=${encodeURIComponent(organization)}`}>{ar?'إعدادات المؤسسة':'Organization settings'}</Link></header>
  <nav className="yb-billing-tabs" aria-label={ar?'صفحات الاشتراك والفوترة':'Subscription and billing pages'}>{tabs.map(t=><button key={t.id} type="button" aria-pressed={area===t.id} onClick={()=>{setArea(t.id);if(t.id==='records')setRevision(v=>v+1);}}>{ar?t.ar:t.en}</button>)}</nav>
  {area==='summary'&&<section aria-label={ar?'حالة الاشتراك':'Subscription status'} className="subscription-summary yb-overview">
   {loading?<p role="status">{ar?'جارٍ تحميل الاشتراك…':'Loading subscription…'}</p>:error?<p role="alert">{ar?'تعذر تحميل الاشتراك.':'Unable to load subscription.'}</p>:subscription?<>
    <div className="yb-overview-grid"><article className="yb-plan-card"><small>{subscriptionLabel(subscription.status,ar)}</small><h2>{plan?(ar?plan.name_ar:plan.name_en):subscription.status==='trialing'?(ar?'الفترة التجريبية':'Trial period'):(ar?'لا توجد باقة مفعلة':'No active plan')}</h2>
     {subscription.days_remaining!=null&&<p className="yb-remaining"><bdi>{subscription.days_remaining}</bdi> {ar?'يومًا متبقيًا':'days remaining'}</p>}
     <div className="yb-billing-quick"><button type="button" onClick={()=>setArea('plans')}>{ar?'طلب التفعيل':'Request activation'}</button><button type="button" onClick={()=>setArea('plans')}>{ar?'عرض الباقات':'View plans'}</button></div>
    </article><article className="yb-billing-panel"><h3>{ar?'معلومات المؤسسة والاشتراك':'Organization & subscription'}</h3><dl className="yb-details"><div><dt>{ar?'المؤسسة':'Organization'}</dt><dd>{subscription.organization_name}</dd></div><div><dt>{ar?'بداية التجربة':'Trial started'}</dt><dd>{displaySubscriptionDate(subscription.trial_started_at,locale)}</dd></div><div><dt>{ar?'تاريخ الانتهاء':'End date'}</dt><dd>{displaySubscriptionDate(end,locale)}</dd></div><div><dt>{ar?'حالة الوصول':'Access'}</dt><dd>{subscription.can_write?(ar?'قراءة وكتابة حسب الصلاحية':'Read/write within permissions'):(ar?'قراءة وتصدير فقط':'Read & export only')}</dd></div></dl></article></div>
    <article className="yb-billing-panel"><h3>{ar?'استخدام الباقة':'Plan usage'}</h3><div className="yb-usage-label"><span>{ar?'المستخدمون النشطون':'Active users'}</span><strong dir="ltr">{subscription.active_users} / {subscription.max_users??'∞'}</strong></div><div className="yb-usage" role="progressbar" aria-label={ar?'استخدام المستخدمين':'User usage'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage}><span style={{width:usage+'%'}}/></div><p>{ar?'يشمل المالك. تخضع إضافة المستخدمين لحدود الباقة وصلاحيات المؤسسة.':'Includes the owner. User additions follow plan limits and organization permissions.'}</p><Link href={`/${locale}/settings/team?organization=${encodeURIComponent(organization)}`}>{ar?'إدارة المستخدمين والصلاحيات':'Manage users & permissions'}</Link></article>
    <p className="yb-notice">{ar?'بعد انتهاء التجربة تصبح المؤسسة للقراءة والتصدير فقط. لا يُطلب إدخال بطاقة لطلب التفعيل.':'After trial expiry, the organization becomes read/export only. Activation requests do not require a card.'}</p>
   </>:<p role="status">{ar?'اختر مؤسسة لعرض اشتراكها.':'Select an organization.'}</p>}
  </section>}
  {area==='plans'&&<section className="yb-billing-panel"><h2>{ar?'الباقات وطلبات التفعيل':'Plans & activation requests'}</h2><div id="subscription-plans"><PricingCatalog key={organization} locale={locale}/></div></section>}
  {area==='records'&&<section className="yb-billing-panel"><h2>{ar?'الفواتير والمدفوعات':'Invoices & payments'}</h2><p className="yb-notice">{ar?'إصدار فواتير الاشتراك والتحصيل الإلكتروني لم يُفعّلا بعد. السجل أدناه لطلبات التفعيل الفعلية.':'Subscription invoicing and online collection are not enabled yet. Actual activation requests appear below.'}</p><h3>{ar?'طلبات التفعيل':'Activation requests'}</h3>
   {recordsError?<p role="alert">{ar?'تعذر عرض الطلبات أو لا تملك الصلاحية.':'Requests unavailable or access restricted.'}</p>:!requests?<p role="status">{ar?'جارٍ تحميل الطلبات…':'Loading requests…'}</p>:requests.rows.length?<div className="yb-table-wrap"><table><thead><tr>{(ar?['رقم الطلب','الباقة','التاريخ','الحالة']:['Request','Plan','Date','Status']).map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{requests.rows.map(row=><tr key={row.id}><td><bdi>#{row.request_number}</bdi></td><td>{ar?row.quote.name_ar:row.quote.name_en}</td><td>{displaySubscriptionDate(row.created_at,locale)}</td><td><span className="settings-state pending">{requestLabel(row.status,ar)}</span></td></tr>)}</tbody></table></div>:<p role="status">{ar?'لا توجد طلبات محفوظة.':'No recorded requests.'}</p>}
   <button type="button" onClick={()=>setRevision(v=>v+1)}>{ar?'تحديث السجل':'Refresh records'}</button>
  </section>}
  {area==='identity'&&<section className="yb-billing-panel"><h2>{ar?'بيانات الفوترة':'Billing details'}</h2><p>{ar?'تُستخدم هوية المؤسسة القانونية نفسها، لتجنب تكرار بيانات الاسم والعنوان. بيانات البائع الضريبية مستقلة في الإعدادات النظامية والضريبية.':'Uses the same registered organization identity, without duplicating names and addresses. Seller tax identity is managed separately in Legal & tax.'}</p>{organization&&<OrganizationSettings key={organization} locale={locale} preferredOrg={organization} inline identityOnly onSaved={()=>setRevision(v=>v+1)}/>}</section>}
 </section>;
}
