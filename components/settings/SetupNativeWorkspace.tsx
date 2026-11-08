'use client';

import dynamic from 'next/dynamic';
import {useState} from 'react';
import OrganizationSettings from './OrganizationSettings';
import RegulatorySettingsWorkspace from './RegulatorySettingsWorkspace';
import TeamAccessWorkspace from './TeamAccessWorkspace';
const Cash=dynamic(()=>import('../FinancialRegisterWorkspace'));

const FiscalYearManagement=dynamic(()=>import('./FiscalYearManagement'),{loading:()=>null});
const ChartOfAccountsWorkspace=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'),{loading:()=>null});
const ReportingPolicyWorkspace=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'),{loading:()=>null});
const LiveOpeningBalances=dynamic(()=>import('../financial-reports/LiveOpeningBalances'),{loading:()=>null});

export type NativeSetupStep='organization'|'regulatory'|'fiscal'|'chart'|'posting'|'opening'|'banking'|'users';
export default function SetupNativeWorkspace({
 locale,organizationId,organizationName,baseCurrency,step,industry,fiscalStart,onRefresh,
}:{locale:string;organizationId:string;organizationName?:string;baseCurrency?:string;step:NativeSetupStep;industry:string;fiscalStart?:string|null;onRefresh:()=>void}){
 const ar=locale==='ar';
 const [chartTab,setChartTab]=useState<'structure'|'accounts'|'templates'|'review'>('structure');

 const chartTabs=[
  {id:'structure',ar:'الهيكل الأساسي',en:'Basic structure'},
  {id:'accounts',ar:'الحسابات الفرعية',en:'Subaccounts'},
  {id:'templates',ar:'القوالب القطاعية',en:'Industry templates'},
  {id:'review',ar:'التحقق والاعتماد',en:'Validation & approval'},
 ] as const;
 const label=({organization:['بيانات المؤسسة','Organization details'],regulatory:['البيانات النظامية والضريبية','Legal & tax'],fiscal:['السنة المالية','Fiscal year'],chart:['دليل الحسابات','Chart of accounts'],posting:['قواعد الترحيل','Posting rules'],opening:['الأرصدة الافتتاحية','Opening balances'],banking:['النقد والبنوك','Cash & banks'],users:['المستخدمون والصلاحيات','Users & permissions']} as const)[step][ar?0:1];
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
   {step==='organization'&&<OrganizationSettings locale={locale} preferredOrg={organizationId} inline onSaved={onRefresh}/>}
   {step==='regulatory'&&<RegulatorySettingsWorkspace locale={locale} preferredOrg={organizationId} inline onSaved={onRefresh}/>}
   {step==='users'&&<TeamAccessWorkspace locale={locale} preferredOrg={organizationId} inline organizationPicker={false} onSaved={onRefresh}/>}
   {step==='banking'&&<Cash locale={locale} view="cash" initialScope="ORGANIZATION" preferredOrg={organizationId} setupEmbedded onSaved={onRefresh}/>}
   {step==='fiscal'&&<FiscalYearManagement key={organizationId} organization={organizationId} locale={locale} onSaved={onRefresh}/>}
   {step==='chart'&&<ChartOfAccountsWorkspace key={organizationId+':'+industry}
      locale={locale} preferredOrg={organizationId} preferredTemplate={industry}
       setupEmbedded setupSection={chartTab} onSaved={onRefresh}/>}
   {step==='posting'&&<ReportingPolicyWorkspace key={organizationId}
      locale={locale} preferredOrg={organizationId} setupEmbedded onSaved={onRefresh}/>}
   {step==='opening'&&<LiveOpeningBalances key={organizationId+':'+(fiscalStart??'')}
      locale={locale} preferredOrg={organizationId} preferredFiscalStart={fiscalStart??''} setupEmbedded onSaved={onRefresh}/>}
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
