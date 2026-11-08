'use client';

import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import SubscriptionBanner from '@/components/subscriptions/SubscriptionBanner';
import PricingCatalog from '@/components/subscriptions/PricingCatalog';
import {rememberedOrganization} from '@/lib/workspace-organization';
import {requestLabel,type ActivationRequest} from '@/lib/subscriptions/requests';
import {displaySubscriptionDate} from '@/lib/subscriptions/model';
import './subscription-billing.css';

type Area='summary'|'plans'|'records';
type RequestData={rows:ActivationRequest[];can_request:boolean};
export default function SubscriptionBillingWorkspace({locale}:{locale:string}){
 const ar=locale==='ar';
 const [area,setArea]=useState<Area>('summary');
 const [organization,setOrganization]=useState('');
 const [requests,setRequests]=useState<RequestData|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState(false);
 const refresh=useCallback(()=>{
  const org=new URLSearchParams(window.location.search).get('organization')??rememberedOrganization()??'';
  setOrganization(org);
  if(!org){setRequests(null);return;}
  const requestVersion=org;
  setLoading(true);setError(false);
  fetch('/api/subscriptions/requests?organization_id='+encodeURIComponent(org),{cache:'no-store'})
   .then(async r=>{if(!r.ok)throw Error('NOT_AVAILABLE');return await r.json() as RequestData;})
   .then(data=>{if((new URLSearchParams(window.location.search).get('organization')??rememberedOrganization())===requestVersion)
     setRequests(data)})
   .catch(()=>{setRequests(null);setError(true)})
   .finally(()=>setLoading(false));
 },[]);
 useEffect(()=>{
  refresh();
  window.addEventListener('zf-organization-selection',refresh);
  window.addEventListener('popstate',refresh);
  return ()=>{window.removeEventListener('zf-organization-selection',refresh);window.removeEventListener('popstate',refresh)};
 },[refresh]);
 const tabs=[
  {id:'summary',ar:'ملخص الاشتراك',en:'Subscription overview'},
  {id:'plans',ar:'الباقات والترقية',en:'Plans & upgrades'},
  {id:'records',ar:'الفواتير والمدفوعات',en:'Invoices & payments'},
 ] as const;
 return <section className="yb-billing" aria-label={ar?'الاشتراك والفوترة':'Subscription and billing'}>
  <header className="yb-billing-header">
   <div><p>{ar?'إعدادات المؤسسة / الاشتراك والفوترة':'Organization settings / Subscription & billing'}</p>
    <h2>{ar?'الاشتراك والفوترة':'Subscription & billing'}</h2>
    <span>{ar?'إدارة الباقة والتجربة وطلبات التفعيل، دون تعطيل رحلة إعداد المؤسسة.':
     'Manage your plan, trial and activation requests independently of the setup journey.'}</span></div>
  </header>
  <nav className="yb-billing-tabs" aria-label={ar?'صفحات الاشتراك والفوترة':'Subscription and billing pages'}>
   {tabs.map(t=><button key={t.id} type="button" aria-pressed={area===t.id}
    onClick={()=>{setArea(t.id);if(t.id==='records')refresh()}}>{ar?t.ar:t.en}</button>)}
  </nav>
  {area==='summary'&&<section className="yb-billing-panel">
   <h3>{ar?'الباقة الحالية وحدود الاستخدام':'Current plan and usage limits'}</h3>
   <SubscriptionBanner locale={locale} always/>
   <div className="yb-billing-quick">
    <button type="button" onClick={()=>setArea('plans')}>{ar?'عرض الباقات وطلب التفعيل':'Compare plans or request activation'}</button>
    <Link href={`/${locale}/settings/team${organization?'?organization='+encodeURIComponent(organization):''}`}>
     {ar?'إدارة المستخدمين والصلاحيات':'Manage users and permissions'}</Link>
   </div>
  </section>}
  {area==='plans'&&<section className="yb-billing-panel">
   <h3>{ar?'الباقات وطلبات التفعيل':'Plans and activation requests'}</h3>
   <p>{ar?'المقارنة وطلب التفعيل يستخدمان نموذج الاشتراك الحالي وصلاحيات المالك أو المفوّض.':
    'Plan comparison and activation requests use the existing subscription flow and server-side role checks.'}</p>
   <div id="subscription-plans"><PricingCatalog locale={locale}/></div>
  </section>}
  {area==='records'&&<section className="yb-billing-panel">
   <h3>{ar?'سجل الفوترة والطلبات':'Billing records and requests'}</h3>
   <p>{ar?'نعرض طلبات التفعيل المسجلة فعليًا. إصدار فواتير الاشتراكات واستلام المدفوعات الإلكترونية لم يُفعّلا بعد في هذه النسخة، لذلك لا نعرض فواتير أو عمليات سداد افتراضية.':
    'Only saved activation requests are shown. Subscription invoices and online payment collection are not active in this version; no fictional invoices or payments are displayed.'}</p>
   {loading?<p role="status">{ar?'جار تحميل الطلبات…':'Loading requests…'}</p>:
    error?<p role="alert">{ar?'تعذر التحقق من سجل الطلبات أو ليس لديك إذن لعرضه.':'Unable to load activation requests, or access is restricted.'}</p>:
    requests?.rows?.length?<div className="yb-billing-requests">{requests.rows.map(row=><article key={row.id}>
      <strong><bdi>#{row.request_number}</bdi> · {ar?row.quote.name_ar:row.quote.name_en}</strong>
      <span>{requestLabel(row.status,ar)}</span>
      <small>{displaySubscriptionDate(row.created_at,locale)}</small>
     </article>)}</div>:
    <p role="status">{ar?'لا توجد طلبات تفعيل محفوظة لهذه المؤسسة.':'No recorded activation requests for this organization.'}</p>}
   <div className="yb-billing-quick">
    <button type="button" onClick={()=>setArea('plans')}>{ar?'إدارة طلبات التفعيل':'Manage activation requests'}</button>
    <button type="button" onClick={refresh}>{ar?'تحديث السجل':'Refresh records'}</button>
   </div>
  </section>}
 </section>;
}