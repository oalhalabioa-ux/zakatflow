import {requireUser} from '@/services/auth';
import SettingsFrame from '@/components/settings/SettingsFrame';
import PersonalSetupPanel from '@/components/settings/PersonalSetupPanel';

export const dynamic='force-dynamic';
export default async function PersonalSetup({params}:{params:Promise<{locale:string}>}){
 await requireUser();
 const {locale}=await params;
 return <SettingsFrame locale={locale}><PersonalSetupPanel locale={locale}/></SettingsFrame>;
}
