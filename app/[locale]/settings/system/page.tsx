import SettingsFrame from '@/components/settings/SettingsFrame';
import GeneralSystemPreferences from '@/components/settings/GeneralSystemPreferences';

export default async function GeneralSystemSettings({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 return <SettingsFrame locale={locale}><GeneralSystemPreferences locale={locale}/></SettingsFrame>;
}
