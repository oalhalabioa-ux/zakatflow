'use client';
import {useState} from 'react';
import OrganizationSettings from './OrganizationSettings';
import SystemSettings from './SystemSettings';
import {useSettingsOrganization} from './useSettingsOrganization';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import SettingsIcon from './SettingsIcon';
import {countryName} from '@/lib/countries';

export default function RegulatorySettingsWorkspace({locale,preferredOrg='',inline=false,onSaved}:{locale:string;preferredOrg?:string;inline?:boolean;onSaved?:()=>void}){
 const ar=locale==='ar';const ctx=useSettingsOrganization(preferredOrg,inline);
 const [tab,setTab]=useState<'identity'|'tax'|'invoicing'>('identity');
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ تحميل بيانات المؤسسة…':'Loading organization…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'تعذر الوصول إلى المؤسسة المحددة.':'Unable to access this organization.'}</p>;
 const org=ctx.organization;
 return <section className="settings-regulatory-native" data-regulatory-workspace>
  {!inline&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={ctx.organizationId} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls>}
  <header className="settings-section-heading"><h2>{ar?'الإعدادات النظامية والضريبية':'Legal & tax settings'}</h2><p>{ar?'هوية المؤسسة القانونية وعنوانها والتسجيل الضريبي والفوترة.':'Registered identity, legal address, tax registration and invoicing.'}</p></header>
  <div className="settings-country-strip"><strong><SettingsIcon name="regulatory"/>{ar?'الدولة: ':'Country: '}{org.country_code?countryName(org.country_code,locale):ar?'لم تُحدد':'Not selected'}</strong><span>{ar?'النشاط: ':'Activity: '}{org.activity||'—'}</span></div>
  <nav className="settings-local-tabs" aria-label={ar?'الهوية والضرائب':'Identity and tax'}>
   <button type="button" aria-pressed={tab==='identity'} onClick={()=>setTab('identity')}><SettingsIcon name="organization"/>{ar?'العنوان والهوية النظامية':'Registered identity & address'}</button>
   <button type="button" aria-pressed={tab==='tax'} onClick={()=>setTab('tax')}><SettingsIcon name="regulatory"/>{ar?'التسجيل الضريبي':'Tax registration'}</button>
   <button type="button" aria-pressed={tab==='invoicing'} onClick={()=>setTab('invoicing')}><SettingsIcon name="billing"/>{ar?'الفوترة الإلكترونية':'E-invoicing'}</button>
  </nav>
  <div className={inline?'settings-regulatory-inline':'settings-regulatory-layout'}><div className="settings-regulatory-editors"><div hidden={tab!=='identity'}><OrganizationSettings key={org.id} locale={locale} preferredOrg={org.id} inline identityOnly onSaved={()=>{ctx.refresh();onSaved?.();}}/></div>
  <div hidden={tab==='identity'}>
   {org.country_code==='SA'?<SystemSettings key={org.id} id={org.id} name={org.name} currency={org.base_currency} locale={locale} setupEmbedded workspaceSection={tab==='invoicing'?'invoicing':'tax'} onEditRegistration={()=>setTab('tax')} onSaved={onSaved}/>:
    <section className="settings-card"><h3>{ar?'متطلبات الضريبة حسب الدولة':'Country-specific tax requirements'}</h3><p>{org.country_code?(ar?'إعدادات الفوترة السعودية لا تنطبق على دولة هذه المؤسسة. لا يُعد هذا الجزء مكتملًا قبل تهيئة قواعد الدولة الضريبية.':'Saudi e-invoicing settings do not apply to this country. Country-specific tax rules must be configured before this area is considered complete.'):(ar?'احفظ دولة تسجيل المؤسسة أولًا لإظهار متطلبات الضرائب المناسبة.':'Save the country of registration to determine tax requirements.')}</p></section>}
  </div></div>{!inline&&<aside className="settings-regulatory-guidance settings-card"><h3>{ar?'المتطلبات حسب الدولة':'Requirements by country'}</h3><p>{ar?'تتحدد الحقول المطلوبة داخل كل نموذج وفق إعداد المؤسسة وحالة التسجيل.':'Required fields are identified in each form according to the organization and registration status.'}</p><div className="settings-requirement-note"><strong>{ar?'مطلوب للحفظ':'Required to save'}</strong><p>{ar?'أكمل الحقول المعلّمة في النموذج، وراجع رسائل التحقق قبل الحفظ.':'Complete marked fields and review validation messages before saving.'}</p></div><div className="settings-requirement-note"><strong>{ar?'بيانات يمكن استكمالها':'Details to complete'}</strong><p>{ar?'يمكن حفظ هوية المؤسسة جزئيًا ثم استكمال بيانات السجل والعنوان.':'Identity can be saved progressively while registration and address details are completed.'}</p></div><div className="settings-requirement-note"><strong>{ar?'غير منطبق':'Not applicable'}</strong><p>{ar?'إعداد الفوترة السعودية لا يُطبق على مؤسسة مسجلة في دولة أخرى.':'Saudi e-invoicing settings do not apply to an organization registered elsewhere.'}</p></div><p className="settings-financial-guidance">{ar?'حفظ بيانات الهوية لا يعني اعتمادًا ضريبيًا أو اكتمال الربط الإلكتروني؛ تُراجع حالة الفوترة من إعداداتها الفعلية.':'Saving identity does not certify tax compliance or electronic integration. Review invoicing status in its actual settings.'}</p></aside>}</div>
 </section>;
}
