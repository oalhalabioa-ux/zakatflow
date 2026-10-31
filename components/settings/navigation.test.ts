import { expect, it } from "vitest";
import { isSettingsPage, settingSections } from "./navigation";
import {
  currentWorkspaceScope,
  searchNavigation,
} from "../../lib/topbar-navigation";
it("keeps account and user management independent of organization settings", () => {
  expect(settingSections.map((s) => s.path)).toEqual([
    "settings",
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
