'use client';

import dynamic from 'next/dynamic';
import {useState} from 'react';

const FiscalYearManagement=dynamic(()=>import('./FiscalYearManagement'),{loading:()=>null});
const ChartOfAccountsWorkspace=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'),{loading:()=>null});
const ReportingPolicyWorkspace=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'),{loading:()=>null});
const LiveOpeningBalances=dynamic(()=>import('../financial-reports/LiveOpeningBalances'),{loading:()=>null});

export type NativeSetupStep='fiscal'|'chart'|'posting'|'opening';
export default function SetupNativeWorkspace({
 locale,organizationId,step,industry,fiscalStart,onRefresh,
}:{locale:string;organizationId:string;step:NativeSetupStep;industry:string;fiscalStart?:string|null;onRefresh:()=>void}){
 const ar=locale==='ar';
 const [chartTab,setChartTab]=useState<'structure'|'accounts'|'templates'|'review'>('structure');
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
   {ar?'هذه نافذة المرحلة نفسها، وليست سجلاً محاسبياً مكرراً. الحفظ والاعتماد ضمن الصلاحيات الأصلية ثم تحديث الجاهزية.':
    'This is the original live module inside the setup journey, not a duplicate accounting register. Save and approve using the original permissions, then refresh readiness.'}
  </p>
 </section>
}
