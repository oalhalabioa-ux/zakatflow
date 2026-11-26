import SettingsFrame from '@/components/settings/SettingsFrame';
import GeneralSystemPreferences from '@/components/settings/GeneralSystemPreferences';
import {currentWorkspaceScope} from '@/lib/topbar-navigation';

export default async function GeneralSystemSettings({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const [{locale},query]=await Promise.all([params,searchParams]);
 const requestedScope=typeof query.scope==='string'?query.scope:'';
 const initialScope=currentWorkspaceScope('settings/system',new URLSearchParams({scope:requestedScope}).toString());
 return <SettingsFrame locale={locale} initialScope={initialScope}><GeneralSystemPreferences locale={locale}/></SettingsFrame>;
}
