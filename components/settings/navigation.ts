/** Settings contains six content areas. Subscription billing belongs under
 * the organization, not an accounting setup prerequisite.
 * Keep the existing CorporateShell/sidebar and product navigation untouched.
 */
export const settingSections = [
  {path:'settings/financial/setup',ar:'رحلة الإعداد',en:'Setup journey',icon:'journey',group:'primary'},
  {path:'settings',ar:'إعدادات المؤسسة',en:'Organization settings',icon:'organization',group:'primary'},
  {path:'settings/regulatory',ar:'الإعدادات النظامية والضريبية',en:'Legal & tax settings',icon:'regulatory',group:'primary'},
  {path:'settings/financial',ar:'الإعدادات المالية والمحاسبية',en:'Financial & accounting settings',icon:'finance',group:'primary'},
  {path:'settings/team',ar:'المستخدمون والصلاحيات',en:'Users & permissions',icon:'users',group:'primary'},
  {path:'settings/system',ar:'إعدادات النظام',en:'System settings',icon:'settings',group:'primary'},
  {path:'billing',ar:'الاشتراك والفوترة',en:'Subscription & billing',icon:'payments',group:'secondary'},
] as const;
export function isSettingsPage(path:string){
 return path==='settings'||path.startsWith('settings/')||path==='billing';
}
export function isSettingsSectionActive(path:string,section:string){
 if(section==='settings/financial/setup')return path===section||path==='settings/personal-setup';
 if(section==='settings/financial')return path===section||
   (path.startsWith(section+'/')&&!path.startsWith('settings/financial/setup'));
 if(section==='settings')return path==='settings'||path==='settings/structure'||path==='billing';
 return path===section;
}

/** Preserve the original Yaqeen corporate sidebar exactly as it was before
 * the six-screen settings redesign. Only the CONTENT tabs show all six.
 * Sidebar icons use CorporateShell's existing NavIconName contract.
 */
export const sidebarSettingSections = [
  {path:'settings',ar:'إعدادات المؤسسة',en:'Organization settings',icon:'organization'},
  {path:'settings/financial',ar:'الإعدادات المالية والمحاسبية',en:'Financial & accounting settings',icon:'settings'},
  {path:'settings/financial/setup',ar:'رحلة الإعداد',en:'Setup journey',icon:'organization'},
  {path:'billing',ar:'الاشتراك والباقات',en:'Subscription & plans',icon:'payments'},
  {path:'settings/system',ar:'إعدادات النظام',en:'System settings',icon:'settings'},
] as const;
export function isSidebarSettingSectionActive(path:string,section:string){
 if(path==='billing')return section==='billing';
 if(path==='settings/structure'||path==='settings/regulatory'||path==='settings/team')
   return section==='settings';
 return isSettingsSectionActive(path,section);
}
