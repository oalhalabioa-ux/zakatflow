'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import OrganizationSettings from './OrganizationSettings';
import OrganizationSubnav from './OrganizationSubnav';
import SubscriptionSetupSummary from './SubscriptionSetupSummary';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {useSettingsOrganization} from './useSettingsOrganization';
export default function OrganizationDetailsWorkspace({locale,preferredOrg=''}:{locale:string;preferredOrg?:string}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg);
 const [entities,setEntities]=useState<Array<{id:string;name:string;entity_type:string;active:boolean}>|null>(null);
 useEffect(()=>{
  const c=new AbortController();setEntities(null);
  if(ctx.organizationId)fetch('/api/organizations/entities?organization_id='+encodeURIComponent(ctx.organizationId),{cache:'no-store',signal:c.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(rows=>{if(!c.signal.aborted&&Array.isArray(rows))setEntities(rows);}).catch(()=>{});
  return()=>c.abort();
 },[ctx.organizationId]);
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ تحميل المؤسسة…':'Loading organization…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'المؤسسة غير متاحة لحسابك.':'Organization unavailable.'}</p>;
 const org=ctx.organization;
 const fields=[org.name,org.legal_name,org.country_code,org.activity,org.contact_email,org.contact_phone,org.registered_address,org.commercial_registration_number];
 const count=fields.filter(v=>Boolean(v?.trim())).length;
 return <section className="organization-details-workspace">
  <TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة المختارة':'Selected organization'} organizations={ctx.organizations} value={ctx.organizationId} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>
  <header className="settings-section-heading"><h2>{ar?'إعدادات المؤسسة':'Organization settings'}</h2><p>{ar?'إدارة هوية المؤسسة وهيكلها التنظيمي وبياناتها الأساسية.':'Manage organization identity, structure and contact details.'}</p></header>
  <div className="settings-organization-grid"><div className="settings-organization-editor">
   <OrganizationSubnav locale={locale} organization={org.id} active="details"/>
   <OrganizationSettings key={org.id} locale={locale} preferredOrg={org.id} inline onSaved={ctx.refresh}/>
  </div><aside className="settings-organization-summary">
   <section className="settings-card"><h3>{ar?'جاهزية بيانات المؤسسة':'Organization profile completeness'}</h3><strong className="settings-profile-percent"><bdi>{Math.round(count/fields.length*100)}%</bdi></strong><progress value={count} max={fields.length} aria-label={ar?'اكتمال بيانات المؤسسة':'Profile completeness'}/><p>{ar?'بيانات محفوظة: ':'Saved fields: '}<bdi>{count} / {fields.length}</bdi></p></section>
   <section className="settings-card"><h3>{ar?'الفروع والهيكل التنظيمي':'Branches & structure'}</h3>{entities?entities.filter(e=>e.active).map(e=><div className="settings-entity-row" key={e.id}><span>{e.name}</span><small>{e.entity_type==='BRANCH'?(ar?'فرع':'Branch'):e.entity_type==='COMPANY'?(ar?'المقر':'Head office'):e.entity_type}</small></div>):<p>{ar?'تعذر التحقق من الهيكل حاليًا.':'Structure is currently unavailable.'}</p>}{entities?.length===0&&<p>{ar?'لم تُضف وحدات تنظيمية بعد.':'No organizational units yet.'}</p>}<Link href={`/${locale}/settings/structure?organization=${encodeURIComponent(org.id)}`}>{ar?'إدارة الفروع':'Manage branches'}</Link></section>
   <SubscriptionSetupSummary locale={locale} organizationId={org.id}/>
  </aside></div>
 </section>;
}
