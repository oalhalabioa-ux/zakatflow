/** Shared settings navigation. The setup journey is a separate primary tab;
 * accounting pages never accidentally highlight it as Finance & Accounting. */
export const settingSections = [
  {path:'settings',ar:'إعدادات المؤسسة',en:'Organization settings',icon:'organization',group:'primary'},
  {path:'settings/financial',ar:'الإعدادات المالية والمحاسبية',en:'Financial & accounting settings',icon:'finance',group:'primary'},
  {path:'settings/financial/setup',ar:'رحلة الإعداد',en:'Setup journey',icon:'journey',group:'primary'},
  {path:'billing',ar:'الاشتراك والباقات',en:'Subscription & plans',icon:'payments',group:'secondary'},
  {path:'settings/system',ar:'إعدادات النظام',en:'System settings',icon:'settings',group:'secondary'},
] as const;
export function isSettingsPage(path:string){
 return path==='settings'||path.startsWith('settings/')||path==='billing';
}
export function isSettingsSectionActive(path:string,section:string){
 if(section==='settings/financial/setup')return path===section;
 if(section==='settings/financial')return path===section||
   (path.startsWith(section+'/')&&!path.startsWith('settings/financial/setup'));
 return path===section;
}
