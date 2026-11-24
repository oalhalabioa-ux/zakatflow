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

  it("preserves the professional model's default columns", () => {
    const preferences = assetTablePreset("professional");
    expect(visibleAssetColumns(preferences.order, preferences.visible)).toEqual(
      PERSONAL_COLUMN_ORDER.filter(key => key !== "realized"),
    );
  });

  it("defaults corporate tables to valuations without personal Zakat or payment columns", () => {
    const preferences = parseAssetTablePreferences(null, "ORGANIZATION");
    expect(preferences.preset).toBe("corporate");
    expect(visibleAssetColumns(preferences.order, preferences.visible)).toEqual(CORPORATE_COLUMN_ORDER.filter(key => key !== "realized"));
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

  it("opens old saved orders with the same visible columns and persists independent realized-profit settings", () => {
    const old = {order: ["date", "asset", "current"], visible: {date: true, asset: true, current: true}};
    const personal = parseAssetTablePreferences(JSON.stringify(old));
    expect(personal.order.slice(0, 3)).toEqual(old.order);
    expect(personal.visible.realized).toBe(false);
    personal.visible.realized = true;
    personal.order = moveAssetColumn(personal.order, 'realized', 'current');
    const saved = new Map([[assetTableStorageKey('PERSONAL'), JSON.stringify(personal)]]);
    const storage = {getItem: (key: string) => saved.get(key) ?? null};
    expect(readAssetTablePreferences(storage, 'PERSONAL').order.slice(0, 4)).toEqual(['date', 'asset', 'realized', 'current']);
    expect(readAssetTablePreferences(storage, 'ORGANIZATION').visible.realized).toBe(false);
  });

  it("sorts gains and losses within their currency and puts unknown data last in either direction", () => {
    const rows = ['missing', 'profit', 'incomplete', 'loss', 'foreign'].map(id => ({id}));
    const report = {
      profit: {status: 'recorded', amount: '2200', currency: 'SAR'},
      loss: {status: 'recorded', amount: '-800', currency: 'SAR'},
      foreign: {status: 'recorded', amount: '20', currency: 'USD'},
      incomplete: {status: 'incomplete'},
    } as const;
    expect(sortAssetRows(rows, 'realized', 'asc', report).map(row => row.id)).toEqual(['loss', 'profit', 'foreign', 'missing', 'incomplete']);
    expect(sortAssetRows(rows, 'realized', 'desc', report).map(row => row.id)).toEqual(['profit', 'loss', 'foreign', 'missing', 'incomplete']);
  });
});
