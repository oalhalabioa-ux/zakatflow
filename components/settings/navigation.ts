export const settingSections = [
  {
    path: "settings",
    ar: "بيانات المؤسسة",
    en: "Organization details",
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
  return settingSections.some((s) => s.path === path);
}
