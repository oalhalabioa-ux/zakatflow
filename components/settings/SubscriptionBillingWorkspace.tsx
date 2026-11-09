'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import PricingCatalog from '@/components/subscriptions/PricingCatalog';
import {rememberedOrganization} from '@/lib/workspace-organization';
import {requestLabel,type ActivationRequest} from '@/lib/subscriptions/requests';
import {displaySubscriptionDate,subscriptionLabel,type OrganizationSubscription} from '@/lib/subscriptions/model';
import OrganizationSettings from './OrganizationSettings';
import SettingsIcon from './SettingsIcon';
import './subscription-billing.css';
type Area='summary'|'plans'|'records'|'identity';
type RequestData={rows:ActivationRequest[];can_request:boolean};
type Member={name?:string;email?:string;role:string;status:string;custom_role_name?:string};
const roleNames:Record<string,[string,string]>={OWNER:['المالك','Owner'],ADMIN:['المدير','Admin'],ACCOUNTANT:['المحاسب','Accountant'],ADVISOR:['المستشار','Advisor'],VIEWER:['المشاهد','Viewer'],SHARIA_REVIEWER:['المراجع الشرعي','Sharia reviewer']};
export default function SubscriptionBillingWorkspace({locale}:{locale:string}){
 const ar=locale==='ar';const [area,setArea]=useState<Area>('summary'),[organization,setOrganization]=useState('');
 const [subscription,setSubscription]=useState<OrganizationSubscription|null>(null),[requests,setRequests]=useState<RequestData|null>(null);
 const [members,setMembers]=useState<Member[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[recordsError,setRecordsError]=useState(false),[revision,setRevision]=useState(0);
 const version=useRef(0);
 useEffect(()=>{
  const read=()=>{setOrganization(new URLSearchParams(location.search).get('organization')??rememberedOrganization()??'');setRevision(v=>v+1);};
  read();window.addEventListener('zf-organization-selection',read);window.addEventListener('popstate',read);
  return()=>{window.removeEventListener('zf-organization-selection',read);window.removeEventListener('popstate',read);};
 },[]);
 useEffect(()=>{
  const c=new AbortController(),requestVersion=++version.current;
  setRequests(null);setSubscription(null);setMembers([]);setLoading(true);setError(false);setRecordsError(false);
  if(!organization){setLoading(false);return()=>c.abort();}
  const current=()=>!c.signal.aborted&&version.current===requestVersion;
  fetch('/api/subscriptions?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:c.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<OrganizationSubscription>;})
   .then(data=>{if(current()){if(data.organization_id&&data.organization_id!==organization)throw Error();setSubscription(data);}})
   .catch(()=>{if(current())setError(true);}).finally(()=>{if(current())setLoading(false);});
  fetch('/api/subscriptions/requests?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:c.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<RequestData>;})
   .then(data=>{if(current())setRequests(data);}).catch(()=>{if(current())setRecordsError(true);});
  fetch('/api/organizations/users?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:c.signal})
   .then(response=>response.ok?response.json():null)
   .then(data=>{if(current()&&Array.isArray(data?.users))setMembers(data.users);}).catch(()=>{});
  return()=>{c.abort();version.current++;};
 },[organization,revision]);
 const tabs=[{id:'summary',icon:'finance',ar:'ملخص الاشتراك',en:'Subscription overview'},{id:'plans',icon:'chart',ar:'الباقات والترقية',en:'Plans & upgrades'},{id:'records',icon:'regulatory',ar:'الفواتير والمدفوعات',en:'Invoices & payments'},{id:'identity',icon:'billing',ar:'بيانات الفوترة',en:'Billing details'}] as const;
 const plan=subscription?.plan_snapshot??subscription?.plan;
 const end=subscription?.status==='active'?subscription.current_period_end:subscription?.trial_ends_at;
 const usage=subscription?.max_users?Math.min(100,subscription.active_users/subscription.max_users*100):0;
 const days=subscription?.status==='trialing'?subscription.trial_duration_days:undefined;
 const trialProgress=days&&subscription?.days_remaining!=null?Math.max(0,Math.min(100,subscription.days_remaining/days*100)):null;
 const owner=members.find(member=>member.role==='OWNER');
 const roles=new Map<string,number>();
 for(const member of members.filter(member=>member.status==='ACTIVE')){
  const label=member.custom_role_name||roleNames[member.role]?.[ar?0:1]||member.role;
  roles.set(label,(roles.get(label)??0)+1);
 }
 const latest=requests?.rows.find(row=>row.organization_id===organization);
 return <section className="yb-billing" aria-label={ar?'الاشتراك والفوترة':'Subscription and billing'}>
  <header className="yb-billing-header"><p><Link href={`/${locale}/settings?organization=${encodeURIComponent(organization)}`}>{ar?'إعدادات المؤسسة':'Organization settings'}</Link> / {ar?'الاشتراك والفوترة':'Subscription & billing'}</p><h1><SettingsIcon name="billing"/>{ar?'الاشتراك والفوترة':'Subscription & billing'}</h1></header>
  <nav className="yb-billing-tabs" aria-label={ar?'صفحات الاشتراك والفوترة':'Subscription and billing pages'}>{tabs.map(t=><button key={t.id} type="button" aria-pressed={area===t.id} onClick={()=>{setArea(t.id);if(t.id==='records'||t.id==='identity')setRevision(v=>v+1);}}><SettingsIcon name={t.icon}/>{ar?t.ar:t.en}</button>)}</nav>
  {area==='summary'&&<section aria-label={ar?'حالة الاشتراك':'Subscription status'} className="subscription-summary yb-overview">
   {loading?<p role="status">{ar?'جارٍ تحميل الاشتراك…':'Loading subscription…'}</p>:error?<p role="alert">{ar?'تعذر تحميل الاشتراك.':'Unable to load subscription.'}</p>:subscription?<>
    <div className="yb-overview-grid"><article className="yb-plan-card"><h2><SettingsIcon name="calendar"/>{subscription.status==='trialing'?(ar?'الفترة التجريبية':'Trial period'):plan?(ar?plan.name_ar:plan.name_en):subscriptionLabel(subscription.status,ar)}</h2>
     {subscription.status!=='trialing'&&plan&&<small>{subscriptionLabel(subscription.status,ar)}</small>}
     {days&&<strong className="billing-trial-days"><bdi>{days}</bdi> {ar?'يوم':'days'}</strong>}
     {subscription.days_remaining!=null&&<p className="yb-remaining"><bdi>{subscription.days_remaining}</bdi> {ar?'يومًا متبقيًا':'days remaining'}</p>}
     {trialProgress!=null&&<div className="yb-usage" role="progressbar" aria-label={ar?'المدة المتبقية من التجربة':'Trial time remaining'} aria-valuenow={trialProgress}><span style={{width:trialProgress+'%'}}/></div>}
     <div className="yb-billing-quick"><button type="button" onClick={()=>setArea('plans')}>{ar?'طلب التفعيل':'Request activation'}</button><button type="button" onClick={()=>setArea('plans')}>{ar?'عرض الباقات':'View plans'}</button></div>
    </article><article className="yb-billing-panel"><h3><SettingsIcon name="organization"/>{ar?'معلومات المؤسسة':'Organization information'}</h3><dl className="yb-details"><div><dt>{ar?'اسم المؤسسة':'Organization name'}</dt><dd>{subscription.organization_name}</dd></div>{owner&&<div><dt>{ar?'مالك المؤسسة':'Organization owner'}</dt><dd>{owner.name||owner.email}</dd></div>}{subscription.trial_started_at&&<div><dt>{ar?'بداية التجربة':'Trial started'}</dt><dd>{displaySubscriptionDate(subscription.trial_started_at,locale,subscription.timezone)}</dd></div>}{end&&<div><dt>{ar?'تاريخ الانتهاء':'End date'}</dt><dd>{displaySubscriptionDate(end,locale,subscription.timezone)}</dd></div>}<div><dt>{ar?'حالة الوصول':'Access'}</dt><dd>{subscription.can_write?(ar?'قراءة وكتابة حسب الصلاحية':'Read/write within permissions'):(ar?'قراءة وتصدير فقط':'Read & export only')}</dd></div></dl></article></div>
    <article className="yb-billing-panel"><h3><SettingsIcon name="users"/>{ar?'استخدام الباقة':'Plan usage'}</h3><div className="billing-usage-grid">
     <div><div className="yb-usage-label"><span>{ar?'المستخدمون النشطون':'Active users'}</span><strong dir="ltr">{subscription.active_users} / {subscription.max_users??'∞'}</strong></div>{subscription.max_users!=null&&<div className="yb-usage" role="progressbar" aria-label={ar?'استخدام المستخدمين':'User usage'} aria-valuenow={usage}><span style={{width:usage+'%'}}/></div>}</div>
     {roles.size>0&&<div><strong>{ar?'الأدوار':'Roles'}</strong><p>{Array.from(roles,([label,count])=>`${label} (${count})`).join(' · ')}</p><p>{ar?'يشمل المالك.':'Includes the owner.'}</p></div>}
    </div></article>
    {subscription.status==='trialing'&&<p className="yb-notice billing-muted"><SettingsIcon name="info"/>{ar?'بعد انتهاء التجربة تصبح المؤسسة للقراءة والتصدير فقط.':'After trial expiry, the organization becomes read/export only.'}</p>}
    <aside className="billing-upgrade"><strong><SettingsIcon name="chart"/>{ar?'اختر باقتك لتفعيل الاشتراك':'Choose a plan to activate your subscription'}</strong><button className="billing-primary" type="button" onClick={()=>setArea('plans')}>{ar?'مقارنة الباقات':'Compare plans'}</button></aside>
   </>:<p role="status">{ar?'اختر مؤسسة لعرض اشتراكها.':'Select an organization.'}</p>}
  </section>}
  {area==='plans'&&<section id="subscription-plans"><PricingCatalog key={organization} locale={locale} organization={organization}/></section>}
  {area==='records'&&<section className="yb-billing-panel">
   <h2><SettingsIcon name="regulatory"/>{ar?'سجل الفواتير والمدفوعات':'Invoices & payments history'}</h2>
   <div className="yb-table-wrap"><table><thead><tr>{(ar?['رقم الفاتورة','التاريخ','الوصف','المبلغ','الحالة','تحميل']:['Invoice number','Date','Description','Amount','Status','Download']).map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
   <tbody><tr><td colSpan={6}>{ar?'إصدار فواتير الاشتراك والدفع الإلكتروني غير متاح حاليًا.':'Subscription invoices and online payments are currently unavailable.'}</td></tr></tbody></table></div>
  </section>}
  {(area==='records'||area==='identity')&&organization&&<div className="billing-record-details">
   <OrganizationSettings key={organization} locale={locale} preferredOrg={organization} inline billingDetails/>
   <aside className="yb-billing-panel billing-request-status">
    <h2><SettingsIcon name="security"/>{ar?'حالة طلب التفعيل':'Activation request status'}</h2>
    <p role="status" className="yb-notice">{recordsError?(ar?'تعذر عرض الطلبات.':'Requests unavailable.'):latest?requestLabel(latest.status,ar):!requests?(ar?'جارٍ التحميل…':'Loading…'):requests.can_request?(ar?'لا يوجد طلب تفعيل.':'No activation request.'):(ar?'عرض الطلبات متاح للمالك أو المدير.':'Requests are visible to owners and administrators.')}</p>
    {latest&&<><dl className="yb-details">
     <div><dt>{ar?'رقم الطلب':'Request number'}</dt><dd><bdi>#{latest.request_number}</bdi></dd></div>
     <div><dt>{ar?'الباقة':'Plan'}</dt><dd>{ar?latest.quote.name_ar:latest.quote.name_en}</dd></div>
    </dl><button className="billing-primary" type="button" onClick={()=>setArea('plans')}>{ar?'عرض طلبات التفعيل':'View activation requests'}</button></>}
   </aside>
  </div>}
 </section>;
}
