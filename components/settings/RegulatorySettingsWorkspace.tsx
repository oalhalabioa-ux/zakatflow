'use client';
import {useState} from 'react';
import OrganizationSettings from './OrganizationSettings';
import SystemSettings from './SystemSettings';
import {useSettingsOrganization} from './useSettingsOrganization';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import {countryName} from '@/lib/countries';

export default function RegulatorySettingsWorkspace({locale,preferredOrg='',inline=false,onSaved}:{locale:string;preferredOrg?:string;inline?:boolean;onSaved?:()=>void}){
 const ar=locale==='ar';const ctx=useSettingsOrganization(preferredOrg);
 const [tab,setTab]=useState<'identity'|'tax'>('identity');
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ تحميل بيانات المؤسسة…':'Loading organization…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'تعذر الوصول إلى المؤسسة المحددة.':'Unable to access this organization.'}</p>;
 const org=ctx.organization;
 return <section className="settings-regulatory-native" data-regulatory-workspace>
  {!inline&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={ctx.organizationId} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>}
  <header className="settings-section-heading"><h2>{ar?'الإعدادات النظامية والضريبية':'Legal & tax settings'}</h2><p>{ar?'هوية المؤسسة القانونية وعنوانها والتسجيل الضريبي والفوترة.':'Registered identity, legal address, tax registration and invoicing.'}</p></header>
  <div className="settings-country-strip"><strong>{ar?'الدولة: ':'Country: '}{org.country_code?countryName(org.country_code,locale):ar?'لم تُحدد':'Not selected'}</strong><span>{org.name}</span></div>
  <nav className="settings-local-tabs" aria-label={ar?'الهوية والضرائب':'Identity and tax'}>
   <button type="button" aria-pressed={tab==='identity'} onClick={()=>setTab('identity')}>{ar?'العنوان والهوية النظامية':'Registered identity & address'}</button>
   <button type="button" aria-pressed={tab==='tax'} onClick={()=>setTab('tax')}>{ar?'التسجيل الضريبي والفوترة':'Tax & e-invoicing'}</button>
  </nav>
  <div hidden={tab!=='identity'}><OrganizationSettings key={org.id} locale={locale} preferredOrg={org.id} inline identityOnly onSaved={()=>{ctx.refresh();onSaved?.();}}/></div>
  <div hidden={tab!=='tax'}>
   {org.country_code==='SA'?<SystemSettings key={org.id} id={org.id} name={org.name} currency={org.base_currency} locale={locale} setupEmbedded onSaved={onSaved}/>:
    <section className="settings-card"><h3>{ar?'متطلبات الضريبة حسب الدولة':'Country-specific tax requirements'}</h3><p>{org.country_code?(ar?'إعدادات الفوترة السعودية لا تنطبق على دولة هذه المؤسسة. لا يُعد هذا الجزء مكتملًا قبل تهيئة قواعد الدولة الضريبية.':'Saudi e-invoicing settings do not apply to this country. Country-specific tax rules must be configured before this area is considered complete.'):(ar?'احفظ دولة تسجيل المؤسسة أولًا لإظهار متطلبات الضرائب المناسبة.':'Save the country of registration to determine tax requirements.')}</p></section>}
  </div>
 </section>;
}
