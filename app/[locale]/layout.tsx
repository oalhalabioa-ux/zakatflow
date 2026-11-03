import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import AssessmentCycleStartTools from '@/components/AssessmentCycleStartTools';
import {DisplayCurrencyProvider} from '@/components/DisplayCurrency';
import CorporateShell from '@/components/CorporateShell';
import FinancialReportingNavigation from '@/components/FinancialReportingNavigation';
import ZakatWorkspaceTabs from '@/components/ZakatWorkspaceTabs';
import '../corporate.css';
import '../yaqeen-theme.css';
import '../yaqeen-dashboard.css';
import '../yaqeen-auth.css';
import '../yaqeen-assets.css';
import '../yaqeen-controls.css';
import '../yaqeen-content-icons.css';
import '../sidebar-brand.css';
export default async function LocaleLayout({children,params}:{children:React.ReactNode,params:Promise<{locale:string}>}){const{locale}=await params;if(locale!=='ar'&&locale!=='en')notFound();return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale} navigationExtension={process.env.FINANCIAL_OPENING_WORKSPACE==='true'?<Suspense fallback={null}><FinancialReportingNavigation locale={locale} statements={process.env.FINANCIAL_STATEMENTS_LIVE==='true'}/></Suspense>:undefined}><ZakatWorkspaceTabs locale={locale}/><AssessmentCycleStartTools ar={locale==='ar'}/>{children}</CorporateShell></DisplayCurrencyProvider>}
