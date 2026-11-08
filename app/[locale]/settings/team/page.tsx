import SettingsFrame from '@/components/settings/SettingsFrame';
import UserManagement from '../../users/page';

export default async function TeamSettings({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 return <SettingsFrame locale={locale}><UserManagement params={params}/></SettingsFrame>;
}