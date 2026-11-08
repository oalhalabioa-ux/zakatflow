'use client';

import Link from 'next/link';
import SettingsIcon from './SettingsIcon';
import {useEffect,useState} from 'react';
import {subscriptionLabel,type OrganizationSubscription} from '@/lib/subscriptions/model';

export default function SubscriptionSetupSummary({locale,organizationId}:{locale:string;organizationId:string}){
 const ar=locale==='ar';
 const [data,setData]=useState<OrganizationSubscription|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  setData(null);setError(false);
  if(!organizationId)return;
  fetch('/api/subscriptions?organization_id='+encodeURIComponent(organizationId),{
   cache:'no-store',signal:controller.signal,
  }).then(async response=>{if(!response.ok)throw Error('SUBSCRIPTION_NOT_AVAILABLE');return response.json() as Promise<OrganizationSubscription>})
   .then(value=>{if(!controller.signal.aborted)setData(value)})
   .catch(()=>{if(!controller.signal.aborted)setError(true)});
  return ()=>controller.abort();
 },[organizationId]);
 return <section className="financial-setup-summary-card financial-setup-subscription-card" aria-label={ar?'ملخص الاشتراك':'Subscription summary'}>
  <h3><SettingsIcon name="billing"/>{ar?'ملخص الاشتراك':'Subscription overview'}</h3>
  <p>{ar?'للمتابعة والإدارة فقط؛ لا يُحتسب ضمن اكتمال الإعداد.':
   'For administration only; it is never a mandatory setup requirement.'}</p>
  {error?<p role="status">{ar?'حالة الاشتراك غير متاحة حاليًا.':'Subscription status unavailable.'}</p>:
   !data?<p role="status">{ar?'جار التحقق من الباقة…':'Checking plan…'}</p>:<>
   <dl className="financial-setup-journey-metrics">
    <div><dt>{ar?'الباقة':'Plan'}</dt><dd>{data.plan?(ar?data.plan.name_ar:data.plan.name_en):(data.status==='trialing'?(ar?'التجربة المجانية':'Free trial'):(ar?'دون باقة فعالة':'No active plan'))}</dd></div>
    {data.status!=='trialing'&&<div><dt>{ar?'الحالة':'Status'}</dt><dd>{subscriptionLabel(data.status,ar)}</dd></div>}
    {data.status==='trialing'&&<div><dt>{ar?'المتبقي من التجربة':'Trial days remaining'}</dt>
     <dd><bdi>{data.days_remaining??'—'}</bdi></dd></div>}
    <div><dt>{ar?'المستخدمون النشطون':'Active users'}</dt>
     <dd><bdi>{data.active_users} / {data.max_users??'—'}</bdi></dd></div>
   </dl>
   </>}
  <Link className="financial-setup-subscription-link"
   href={`/${locale}/billing?organization=${encodeURIComponent(organizationId)}`}>
   {ar?'إدارة الاشتراك والفوترة':'Manage subscription & billing'}
  </Link>
 </section>;
}
