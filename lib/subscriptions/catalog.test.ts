import { describe, it, expect } from "vitest";
import {
  MODULES,
  ALL_CAPABILITIES,
  routeCapability,
  includesCapability,
} from "./catalog";
describe("subscription capabilities", () => {
  it("maps organizational module routes without blocking account and support", () => {
    expect(routeCapability("/ar/budget-planning")).toBe("budgets");
    expect(routeCapability("/en/investments")).toBe("investments");
    expect(routeCapability("/ar/account")).toBeUndefined();
    expect(routeCapability("/ar/guide")).toBeUndefined();
  });
  it("preserves legacy core access and restricts explicit plan snapshots", () => {
    expect(includesCapability(["core"], "module:budgets")).toBe(true);
    expect(includesCapability(["module:assets"], "module:budgets")).toBe(false);
  });
  it("keeps mandatory bookkeeping foundation and unique capability keys", () => {
    expect(MODULES.filter((x) => x.core).map((x) => x.key)).toEqual([
      "assets",
      "liquidity",
    ]);
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });
});
