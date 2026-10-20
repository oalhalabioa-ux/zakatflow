import { describe, expect, it } from "vitest";
import { isAssetPurchaseAllowed } from "./assets-acquisition";

describe("isAssetPurchaseAllowed", () => {
  it.each(["CASH", "BANK", "RECEIVABLE", "DEPOSIT", "PREPAYMENT", "ADVANCE"])("rejects %s as an asset purchase", (code) => {
    expect(isAssetPurchaseAllowed({ code, class_code: code === "DEPOSIT" ? "FINANCIAL" : "OTHER", default_legacy_asset_type: code })).toBe(false);
  });

  it("allows capital asset purchases", () => {
    expect(isAssetPurchaseAllowed({ code: "MACHINERY", class_code: "PPE", default_legacy_asset_type: "OTHER" })).toBe(true);
  });

  it("allows an investment acquisition while excluding financial account and receivable classes", () => {
    expect(isAssetPurchaseAllowed({ code: "EQUITY_INVESTMENT", class_code: "INVESTMENT", default_legacy_asset_type: "STOCK" })).toBe(true);
    expect(isAssetPurchaseAllowed({ code: "OTHER_FINANCIAL", class_code: "FINANCIAL", default_legacy_asset_type: "OTHER" })).toBe(false);
  });

  it("rejects an unselected catalog type", () => {
    expect(isAssetPurchaseAllowed(null)).toBe(false);
  });
});
