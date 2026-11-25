import { expect, it } from "vitest";
import { isSettingsPage, isSettingsSectionActive, settingSections, sidebarSettingSections, isSidebarSettingSectionActive } from "./navigation";
import {
  currentWorkspaceScope,
  searchNavigation,
} from "../../lib/topbar-navigation";
it("keeps account and user management independent of organization settings", () => {
  expect(settingSections.map((s) => s.path)).toEqual([
    "settings/financial/setup",
    "settings",
    "settings/regulatory",
    "settings/financial",
    "settings/team",
    "settings/system",
    "billing",
  ]);
  expect(isSettingsPage("account")).toBe(false);
  expect(isSettingsPage("users")).toBe(false);
  expect(currentWorkspaceScope("settings/system", "", "PERSONAL")).toBe(
    "PERSONAL",
  );
  expect(currentWorkspaceScope("settings/system", "", "ORGANIZATION")).toBe("ORGANIZATION");
  expect(currentWorkspaceScope("settings/system", "scope=PERSONAL", "ORGANIZATION")).toBe("PERSONAL");
});
it("makes subscription settings discoverable independently of My account", () => {
  expect(searchNavigation("اشتراك").some((s) => s[0] === "billing")).toBe(true);
  expect(searchNavigation("حسابي")[0][0]).toBe("account");
});

it("keeps nested financial settings inside organization settings and searchable",()=>{expect(isSettingsPage("settings/financial/fiscal-years")).toBe(true);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings")).toBe(false);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings/financial")).toBe(true);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings/system")).toBe(false);expect(currentWorkspaceScope("settings/financial/fiscal-years","","PERSONAL")).toBe("ORGANIZATION");expect(searchNavigation("السنوات المالية").some(s=>s[0]==="settings/financial/fiscal-years")).toBe(true)});

it("keeps the setup journey separate from financial detail settings",()=>{
  expect(settingSections.filter(s=>s.group==='primary').map(s=>s.path))
   .toEqual(['settings/financial/setup','settings','settings/regulatory','settings/financial','settings/team','settings/system']);
  expect(isSettingsSectionActive('settings/financial/setup','settings/financial')).toBe(false);
  expect(isSettingsSectionActive('settings/financial/setup','settings/financial/setup')).toBe(true);
  expect(isSettingsSectionActive('settings/financial/fiscal-years','settings/financial')).toBe(true);
});

it('keeps six settings areas distinct and treats billing and structure as organization subsections',()=>{
 expect(isSettingsSectionActive('settings/regulatory','settings/regulatory')).toBe(true);
 expect(isSettingsSectionActive('settings/regulatory','settings/system')).toBe(false);
 expect(isSettingsSectionActive('settings/structure','settings')).toBe(true);
 expect(isSettingsSectionActive('billing','settings')).toBe(false);
 expect(isSettingsSectionActive('settings/team','settings/team')).toBe(true);
 expect(isSettingsSectionActive('settings/personal-setup','settings/financial/setup')).toBe(true);
 expect(isSettingsPage('settings/team')).toBe(true);
 expect(currentWorkspaceScope('settings/personal-setup','','ORGANIZATION')).toBe('PERSONAL');
 expect(currentWorkspaceScope('settings/financial/setup','','PERSONAL')).toBe('ORGANIZATION');
});

it('matches the sidebar to all six primary sections and leaves subscription plans last',()=>{
 expect(sidebarSettingSections.map(s=>s.path)).toEqual([
  ...settingSections.filter(s=>s.group==='primary').map(s=>s.path),'billing',
 ]);
 expect(new Set(sidebarSettingSections.map(s=>s.path)).size).toBe(7);
});
it('highlights each sidebar section independently instead of assigning tax/team to organization',()=>{
 for(const section of sidebarSettingSections){
  expect(sidebarSettingSections.filter(s=>isSidebarSettingSectionActive(section.path,s.path)).map(s=>s.path)).toEqual([section.path]);
 }
});
it('retains sidebar aliases for nested fiscal, personal setup and organization structure',()=>{
 const cases=[['settings/financial/fiscal-years','settings/financial'],['settings/personal-setup','settings/financial/setup'],['settings/structure','settings']];
 for(const [path,expected] of cases){
  expect(sidebarSettingSections.filter(s=>isSidebarSettingSectionActive(path,s.path)).map(s=>s.path)).toEqual([expected]);
 }
});
