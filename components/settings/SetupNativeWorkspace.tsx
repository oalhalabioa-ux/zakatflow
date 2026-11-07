'use client';

import dynamic from 'next/dynamic';

const FiscalYearManagement=dynamic(()=>import('./FiscalYearManagement'),{loading:()=>null});
const ChartOfAccountsWorkspace=dynamic(()=>import('../financial-reports/ChartOfAccountsWorkspace'),{loading:()=>null});
const ReportingPolicyWorkspace=dynamic(()=>import('../financial-reports/ReportingPolicyWorkspace'),{loading:()=>null});
const LiveOpeningBalances=dynamic(()=>import('../financial-reports/LiveOpeningBalances'),{loading:()=>null});

export type NativeSetupStep='fiscal'|'chart'|'posting'|'opening';
export default function SetupNativeWorkspace({
 locale,organizationId,step,industry,fiscalStart,onRefresh,
}:{locale:string;organizationId:string;step:NativeSetupStep;industry:string;fiscalStart?:string|null;onRefresh:()=>void}){
 const ar=locale==='ar';
 const label=ar?'التغييرات تحفظ في السجل الأصلي وتظهر في القوائم وفق الصلاحيات':'Changes are saved in the original source with normal accounting permissions';
 return <section className="financial-setup-native" data-setup-native-workspace={step}>
  <header className="financial-setup-native-heading">
   <span>{label}</span>
   <button type="button" onClick={onRefresh}>{ar?'تحديث جاهزية المرحلة':'Refresh step readiness'}</button>
  </header>
  <div className="financial-setup-native-content">
   {step==='fiscal'&&<FiscalYearManagement key={organizationId} organization={organizationId} locale={locale}/>}
   {step==='chart'&&<ChartOfAccountsWorkspace key={organizationId+':'+industry}
      locale={locale} preferredOrg={organizationId} preferredTemplate={industry} setupEmbedded/>}
   {step==='posting'&&<ReportingPolicyWorkspace key={organizationId}
      locale={locale} preferredOrg={organizationId} setupEmbedded/>}
   {step==='opening'&&<LiveOpeningBalances key={organizationId+':'+(fiscalStart??'')}
      locale={locale} preferredOrg={organizationId} preferredFiscalStart={fiscalStart??''} setupEmbedded/>}
  </div>
  <p className="financial-setup-native-note">
   {ar?'هذه نافذة المرحلة نفسها، وليست سجلاً محاسبياً مكرراً. الحفظ والاعتماد ضمن الصلاحيات الأصلية ثم تحديث الجاهزية.':
    'This is the original live module inside the setup journey, not a duplicate accounting register. Save and approve using the original permissions, then refresh readiness.'}
  </p>
 </section>
}
