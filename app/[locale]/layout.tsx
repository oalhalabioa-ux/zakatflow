import AssetTableTools from '@/components/AssetTableTools';
import AssessmentCycleStartTools from '@/components/AssessmentCycleStartTools';
import CorporateShell from '@/components/CorporateShell';
import ZakatWorkspaceTabs from '@/components/ZakatWorkspaceTabs';
import '../corporate.css';
export default async function LocaleLayout({children,params}:{children:React.ReactNode,params:Promise<{locale:string}>}){const{locale}=await params;return <CorporateShell locale={locale}><ZakatWorkspaceTabs locale={locale}/><AssetTableTools ar={locale==='ar'}/><AssessmentCycleStartTools ar={locale==='ar'}/>{children}</CorporateShell>}
