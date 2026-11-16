import { describe, it, expect } from "vitest";
import {
  adminCount,
  adminPercent,
  adminNumber,
  organizationDistribution,
} from "../lib/admin/metrics";
describe("owner analytics aggregates", () => {
  it("keeps missing or malformed aggregates distinct from a known zero", () => {
    for (const value of [
      null,
      undefined,
      "",
      "  ",
      false,
      true,
      {},
      [],
      NaN,
      Infinity,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(adminCount(value)).toBeNull();
    expect(adminCount(0)).toBe(0);
    expect(adminCount("23")).toBe(23);
  });
  it("includes preserved and administrative states without inventing a status", () => {
    expect(
      organizationDistribution({
        total: 10,
        active: 2,
        trialing: 3,
        expired: 1,
      }),
    ).toEqual({ total: 10, active: 2, trialing: 3, expired: 1, other: 4 });
    expect(
      organizationDistribution({ total: 0, active: 0, trialing: 0, expired: 0 })
        ?.other,
    ).toBe(0);
  });
  it("rejects incomplete and inconsistent status snapshots", () => {
    expect(organizationDistribution(null)).toBeNull();
    expect(
      organizationDistribution({
        total: 3,
        active: 2,
        trialing: 2,
        expired: 0,
      }),
    ).toBeNull();
    expect(
      organizationDistribution({ total: 3, active: 2, trialing: 1 }),
    ).toBeNull();
  });
  it("uses the organization denominator and never produces invalid or fabricated rates", () => {
    expect(adminPercent(1, 3)).toBe(33.3);
    expect(adminPercent(0, 3)).toBe(0);
    for (const [part, total] of [
      [0, 0],
      [3, 2],
      [-1, 3],
      [NaN, 3],
      [1, Infinity],
      [null, 3],
      [1, null],
    ])
      expect(adminPercent(part, total)).toBeNull();
  });
  it("keeps English digits in both languages", () => {
    for (const locale of ["ar", "en"])
      expect(adminNumber(1234.5, locale)).not.toMatch(/[٠-٩۰-۹]/);
  });
});
