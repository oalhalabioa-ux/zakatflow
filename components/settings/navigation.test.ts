import { expect, it } from "vitest";
import { isSettingsPage, isSettingsSectionActive, settingSections } from "./navigation";
import {
  currentWorkspaceScope,
  searchNavigation,
} from "../../lib/topbar-navigation";
it("keeps account and user management independent of organization settings", () => {
  expect(settingSections.map((s) => s.path)).toEqual([
    "settings",
    "settings/financial",
    "settings/financial/setup",
    "billing",
    "settings/system",
  ]);
  expect(isSettingsPage("account")).toBe(false);
  expect(isSettingsPage("users")).toBe(false);
  expect(currentWorkspaceScope("settings/system", "", "PERSONAL")).toBe(
    "ORGANIZATION",
  );
});
it("makes subscription settings discoverable independently of My account", () => {
  expect(searchNavigation("اشتراك").some((s) => s[0] === "billing")).toBe(true);
  expect(searchNavigation("حسابي")[0][0]).toBe("account");
});

it("keeps nested financial settings inside organization settings and searchable",()=>{expect(isSettingsPage("settings/financial/fiscal-years")).toBe(true);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings")).toBe(false);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings/financial")).toBe(true);expect(isSettingsSectionActive("settings/financial/fiscal-years","settings/system")).toBe(false);expect(currentWorkspaceScope("settings/financial/fiscal-years","","PERSONAL")).toBe("ORGANIZATION");expect(searchNavigation("السنوات المالية").some(s=>s[0]==="settings/financial/fiscal-years")).toBe(true)});

it("keeps the setup journey separate from financial detail settings",()=>{
  expect(settingSections.filter(s=>s.group==='primary').map(s=>s.path))
   .toEqual(['settings','settings/financial','settings/financial/setup']);
  expect(isSettingsSectionActive('settings/financial/setup','settings/financial')).toBe(false);
  expect(isSettingsSectionActive('settings/financial/setup','settings/financial/setup')).toBe(true);
  expect(isSettingsSectionActive('settings/financial/fiscal-years','settings/financial')).toBe(true);
});
