import SettingsFrame from '@/components/settings/SettingsFrame';
import RegulatorySettingsWorkspace from '@/components/settings/RegulatorySettingsWorkspace';
export default async function RegulatorySettings({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}><RegulatorySettingsWorkspace locale={locale} preferredOrg={organization}/></SettingsFrame>;
}
