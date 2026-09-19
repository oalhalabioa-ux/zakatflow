import { describe, expect, it } from "vitest";
import {
  ASSET_COLUMN_ORDER,
  assetTablePreset,
  moveAssetColumn,
  normalizeAssetColumnOrder,
  parseAssetTablePreferences,
  visibleAssetColumns,
} from "./asset-table-preferences";

describe("asset table preferences", () => {
  it("keeps every column once when a saved order is incomplete", () => {
    const order = normalizeAssetColumnOrder(["due", "asset", "due", "unknown"]);
    expect(order.slice(0, 2)).toEqual(["due", "asset"]);
    expect(new Set(order).size).toBe(ASSET_COLUMN_ORDER.length);
  });

  it("provides a professional model with every column", () => {
    const preferences = assetTablePreset("professional");
    expect(visibleAssetColumns(preferences.order, preferences.visible)).toEqual(
      ASSET_COLUMN_ORDER,
    );
  });

  it("provides a concise model focused on zakat and payment", () => {
    const preferences = assetTablePreset("zakat");
    expect(visibleAssetColumns(preferences.order, preferences.visible)).toEqual([
      "asset",
      "hawl",
      "current",
      "due",
      "paid",
      "remaining",
      "action",
    ]);
  });

  it("moves a dragged column to the selected position without losing columns", () => {
    const order = moveAssetColumn(ASSET_COLUMN_ORDER, "remaining", "asset");
    expect(order[0]).toBe("remaining");
    expect(new Set(order).size).toBe(ASSET_COLUMN_ORDER.length);
    expect(order).toContain("asset");
  });

  it("falls back safely when stored preferences are invalid", () => {
    expect(parseAssetTablePreferences("not-json")).toEqual(
      assetTablePreset("professional"),
    );
  });
});
