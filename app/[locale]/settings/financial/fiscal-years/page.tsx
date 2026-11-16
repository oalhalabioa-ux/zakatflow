import SettingsFrame from '@/components/settings/SettingsFrame';
import FinancialSettingsWorkspace from '@/components/settings/FinancialSettingsWorkspace';
export default async function FiscalYearsSettings({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}><FinancialSettingsWorkspace locale={locale} preferredOrg={organization} initialFiscalEditor/></SettingsFrame>;
}
