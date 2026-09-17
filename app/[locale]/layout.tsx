import AssetTableTools from '@/components/AssetTableTools';
import CorporateShell from '@/components/CorporateShell';
import '../corporate.css';
export default async function LocaleLayout({children,params}:{children:React.ReactNode,params:Promise<{locale:string}>}){const{locale}=await params;return <CorporateShell locale={locale}><AssetTableTools ar={locale==='ar'}/>{children}</CorporateShell>}
