import { describe, expect, it } from "vitest";
import {
  ASSET_COLUMN_ORDER,
  PERSONAL_COLUMN_ORDER,
  CORPORATE_COLUMN_ORDER,
  assetTableStorageKey,
  readAssetTablePreferences,
  assetCostValue,
  assetCurrentValue,
  assetTablePreset,
  moveAssetColumn,
  normalizeAssetColumnOrder,
  parseAssetTablePreferences,
  sortAssetRows,
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
      PERSONAL_COLUMN_ORDER,
    );
  });

  it("defaults corporate tables to valuations without personal Zakat or payment columns", () => {
    const preferences = parseAssetTablePreferences(null, "ORGANIZATION");
    expect(preferences.preset).toBe("corporate");
    expect(visibleAssetColumns(preferences.order, preferences.visible)).toEqual(CORPORATE_COLUMN_ORDER);
    const restored = parseAssetTablePreferences(JSON.stringify(assetTablePreset("professional")), "ORGANIZATION");
    for (const key of ["due", "paid", "remaining", "hawl", "calculation"] as const) expect(restored.visible[key]).toBe(false);
  });

  it("migrates legacy settings only for personal and preserves separate saved customizations", () => {
    const legacy = assetTablePreset("zakat");
    const values = new Map([["zf_asset_table_v4", JSON.stringify(legacy)]]);
    const storage = {getItem: (key: string) => values.get(key) ?? null};
    expect(readAssetTablePreferences(storage, "PERSONAL")).toEqual(legacy);
    expect(readAssetTablePreferences(storage, "ORGANIZATION").preset).toBe("corporate");
    const corporate = assetTablePreset("corporate");
    corporate.visible.center = false;
    corporate.size = "wide";
    values.set(assetTableStorageKey("ORGANIZATION"), JSON.stringify(corporate));
    expect(readAssetTablePreferences(storage, "ORGANIZATION")).toEqual(corporate);
    expect(readAssetTablePreferences(storage, "PERSONAL")).toEqual(legacy);
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

  it("uses an explicit zero market value instead of falling back to cost", () => {
    const asset = {
      current_market_value: 0,
      metadata: { market_value: 0, purchase_value: 125000 },
    };
    expect(assetCurrentValue(asset)).toBe(0);
    expect(assetCostValue(asset)).toBe(125000);
  });

  it("sorts asset rows numerically without mutating the source rows", () => {
    const rows = [
      { id: "a", current_market_value: 2500 },
      { id: "b", current_market_value: 100 },
      { id: "c", current_market_value: 900 },
    ];
    expect(sortAssetRows(rows, "current", "asc").map((row) => row.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});
