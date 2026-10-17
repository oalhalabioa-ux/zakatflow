import AssessmentCycleStartTools from '@/components/AssessmentCycleStartTools';
import {DisplayCurrencyProvider} from '@/components/DisplayCurrency';
import CorporateShell from '@/components/CorporateShell';
import ZakatWorkspaceTabs from '@/components/ZakatWorkspaceTabs';
import '../corporate.css';
import '../yaqeen-auth.css';
export default async function LocaleLayout({children,params}:{children:React.ReactNode,params:Promise<{locale:string}>}){const{locale}=await params;return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}><ZakatWorkspaceTabs locale={locale}/><AssessmentCycleStartTools ar={locale==='ar'}/>{children}</CorporateShell></DisplayCurrencyProvider>}
