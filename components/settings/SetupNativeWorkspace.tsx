'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useState} from 'react';
import SetupEmbeddedWorkspace from './SetupEmbeddedWorkspace';

const SystemSettings=dynamic(()=>import('./SystemSettings'),{loading:()=>null});
const FiscalYearManagement=dynamic(()=>import('./FiscalYearManagement'),{loading:()=>null});
const ChartOfAccountsWorkspace=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'),{loading:()=>null});
const ReportingPolicyWorkspace=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'),{loading:()=>null});
const LiveOpeningBalances=dynamic(()=>import('../financial-reports/LiveOpeningBalances'),{loading:()=>null});

export type NativeSetupStep='regulatory'|'fiscal'|'chart'|'posting'|'opening';
export default function SetupNativeWorkspace({
 locale,organizationId,organizationName,baseCurrency,step,industry,fiscalStart,onRefresh,
}:{locale:string;organizationId:string;organizationName?:string;baseCurrency?:string;step:NativeSetupStep;industry:string;fiscalStart?:string|null;onRefresh:()=>void}){
 const ar=locale==='ar';
 const [chartTab,setChartTab]=useState<'structure'|'accounts'|'templates'|'review'>('structure');
 const [legalEditorOpen,setLegalEditorOpen]=useState(false);
 const chartTabs=[
  {id:'structure',ar:'الهيكل الأساسي',en:'Basic structure'},
  {id:'accounts',ar:'الحسابات الفرعية',en:'Subaccounts'},
  {id:'templates',ar:'القوالب القطاعية',en:'Industry templates'},
  {id:'review',ar:'التحقق والاعتماد',en:'Validation & approval'},
 ] as const;
 const label=ar?'التغييرات تحفظ في السجل الأصلي وتظهر في القوائم وفق الصلاحيات':'Changes are saved in the original source with normal accounting permissions';
 return <section className="financial-setup-native" data-setup-native-workspace={step}>
  <header className="financial-setup-native-heading">
   <span>{label}</span>
   <button type="button" onClick={onRefresh}>{ar?'تحديث جاهزية المرحلة':'Refresh step readiness'}</button>
  </header>
  {step==='chart'&&<nav className="financial-setup-chart-tabs" aria-label={ar?'أقسام دليل الحسابات':'Chart of accounts sections'}>
   {chartTabs.map(tab=><button key={tab.id} type="button" aria-pressed={chartTab===tab.id}
    onClick={()=>setChartTab(tab.id)}>{ar?tab.ar:tab.en}</button>)}
  </nav>}
  <div className="financial-setup-native-content" data-chart-section={step==='chart'?chartTab:undefined}>
   {step==='regulatory'&&<>
    <div className="financial-setup-regulatory-notice">
     <strong>{ar?'ملف العنوان والضرائب والفوترة الحالي':'Existing address, tax and invoicing sources'}</strong>
     <p>{ar?
      'تحفظ بيانات عنوان البائع والرقم الضريبي في ملف الفوترة الأصلي. هذا العنوان ليس سجلًا مستقلاً للعنوان القانوني للمؤسسة. إعدادات ZATCA مخصصة للسعودية ولا تُطبّق تلقائيًا على الدول الأخرى.':
      'The seller address and tax number use the existing invoice profile. This is not an independent legal-address register. ZATCA configuration is Saudi-specific and does not automatically apply to other countries.'}</p>
     <p>{ar?
      'تُحفظ دولة التسجيل والسجل التجاري والعنوان القانوني في بيانات المؤسسة الأصلية بصلاحيات المالك. افتح بيانات المؤسسة لمراجعتها، ثم عد إلى إعدادات الضرائب والفوترة هنا.':
      'Country of registration, registration number and registered legal address are saved in the original organization settings under owner permissions. Review them in organization details, then return here for invoicing and VAT.'}</p>
     <Link className="financial-setup-structure-link" href={`/${locale}/settings?organization=${encodeURIComponent(organizationId)}&fromSetup=1`}>
      {ar?'فتح بيانات المؤسسة القانونية':'Open registered organization details'}
     </Link>
    </div>
    <button type="button" className="financial-setup-summary-refresh" aria-expanded={legalEditorOpen}
      onClick={()=>setLegalEditorOpen(value=>!value)}>
      {legalEditorOpen?(ar?'إخفاء نموذج الهوية القانونية':'Hide legal identity editor'):
        (ar?'تعديل الهوية القانونية هنا دون مغادرة الرحلة':'Edit registered identity here without leaving setup')}
    </button>
    {legalEditorOpen&&<SetupEmbeddedWorkspace locale={locale} organizationId={organizationId}
      stage={ar?'بيانات المؤسسة القانونية':'Registered organization identity'}
      href={`/${locale}/settings?organization=${encodeURIComponent(organizationId)}`}
      onRefresh={onRefresh}/>}
    <SystemSettings key={organizationId} id={organizationId}
      name={organizationName??''} currency={baseCurrency??'SAR'} locale={locale}
      setupEmbedded onSaved={onRefresh}/>
   </>}
   {step==='fiscal'&&<FiscalYearManagement key={organizationId} organization={organizationId} locale={locale}/>}
   {step==='chart'&&<ChartOfAccountsWorkspace key={organizationId+':'+industry}
      locale={locale} preferredOrg={organizationId} preferredTemplate={industry}
       setupEmbedded setupSection={chartTab}/>}
   {step==='posting'&&<ReportingPolicyWorkspace key={organizationId}
      locale={locale} preferredOrg={organizationId} setupEmbedded/>}
   {step==='opening'&&<LiveOpeningBalances key={organizationId+':'+(fiscalStart??'')}
      locale={locale} preferredOrg={organizationId} preferredFiscalStart={fiscalStart??''} setupEmbedded/>}
  </div>
  {step==='chart'&&chartTab==='review'&&<div className="financial-setup-native-validation-note">
   {ar?'راجع الحسابات النشطة والمستويات التجميعية، ثم انتقل لقواعد الترحيل لاعتماد ربط أطراف القيود. عرض هذه الصفحة لا ينشئ اعتمادًا محاسبيًا.':
    'Review active accounts and rollups. Posting accounts are formally mapped and approved in Posting Rules. Viewing this page does not grant accounting approval.'}
  </div>}
  <p className="financial-setup-native-note">
   {step==='regulatory'?
    (ar?'التحقق هنا إداري فقط: لا تُعتبر البيانات اعتمادًا قانونيًا أو ضريبيًا، ولا تتحول تلقائيًا إلى شرط لترحيل القيود المالية.':
       'This step is administrative review, not legal/tax certification or an automatic accounting posting prerequisite.'):
    (ar?'هذه نافذة المرحلة نفسها، وليست سجلاً محاسبياً مكرراً. الحفظ والاعتماد ضمن الصلاحيات الأصلية ثم تحديث الجاهزية.':
       'This is the original live module inside the setup journey, not a duplicate accounting register. Save and approve using the original permissions, then refresh readiness.')}
  </p>
 </section>
}
