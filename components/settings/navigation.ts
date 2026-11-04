export const settingSections = [
  {
    path: "settings",
    ar: "إعدادات المؤسسة",
    en: "Organization settings",
    icon: "organization",
  },
  {
    path: "billing",
    ar: "الاشتراك والباقات",
    en: "Subscription & plans",
    icon: "payments",
  },
  {
    path: "settings/system",
    ar: "إعدادات النظام",
    en: "System settings",
    icon: "settings",
  },
] as const;
export function isSettingsPage(path: string) {
  return path==='settings'||path.startsWith('settings/')||path==='billing';
}
export function isSettingsSectionActive(path:string,section:string){
 return section==='settings'?(path==='settings'||path.startsWith('settings/financial')):path===section;
}
