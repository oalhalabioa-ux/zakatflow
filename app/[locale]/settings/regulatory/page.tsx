import SettingsFrame from '@/components/settings/SettingsFrame';
import OrganizationSettings from '@/components/settings/OrganizationSettings';
import SetupReturnLink from '@/components/settings/SetupReturnLink';

export default async function RegulatorySettings({params,searchParams}:{
 params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fromSetup?:string}>;
}){
 const [{locale},{organization,fromSetup}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}>
   <SetupReturnLink locale={locale} organization={organization} visible={fromSetup==='1'}/>
   <OrganizationSettings locale={locale} system/>
 </SettingsFrame>;
}