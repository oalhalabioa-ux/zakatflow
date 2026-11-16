import SettingsFrame from '@/components/settings/SettingsFrame';
import TeamAccessWorkspace from '@/components/settings/TeamAccessWorkspace';
export default async function TeamSettings({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}><TeamAccessWorkspace locale={locale} preferredOrg={organization} inline/></SettingsFrame>;
}
