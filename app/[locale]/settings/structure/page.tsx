import SettingsFrame from '@/components/settings/SettingsFrame';
import OrganizationSubnav from '@/components/settings/OrganizationSubnav';
import Organizations from '../../organizations/page';

export default async function OrganizationStructureSettings({params,searchParams}:{
 params:Promise<{locale:string}>;
 searchParams:Promise<{organization?:string}>;
}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}>
  <OrganizationSubnav locale={locale} organization={organization} active="structure"/>
  <Organizations params={params}/>
 </SettingsFrame>;
}
