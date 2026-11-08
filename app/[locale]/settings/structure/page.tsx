import SettingsFrame from '@/components/settings/SettingsFrame';
import OrganizationStructureWorkspace from '@/components/settings/OrganizationStructureWorkspace';

export default async function OrganizationStructureSettings({params,searchParams}:{
 params:Promise<{locale:string}>;
 searchParams:Promise<{organization?:string}>;
}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}>
  <OrganizationStructureWorkspace locale={locale} preferredOrg={organization}/>
 </SettingsFrame>;
}
