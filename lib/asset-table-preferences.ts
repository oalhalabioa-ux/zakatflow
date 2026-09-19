export const ASSET_COLUMNS = [
  ["asset", "الأصل", "Asset"],
  ["date", "تاريخ الشراء", "Purchase date"],
  ["weight", "الوزن / الكمية", "Weight / Qty"],
  ["hawl", "الحول", "Hawl"],
  ["cost", "التكلفة", "Cost"],
  ["current", "القيمة الحالية", "Current value"],
  ["due", "الزكاة المستحقة", "Zakat due"],
  ["paid", "المدفوعة", "Paid"],
  ["remaining", "المتبقي", "Remaining"],
  ["calculation", "حالة الاستحقاق", "Eligibility status"],
  ["action", "الإجراء", "Action"],
] as const;

export type AssetColumn = (typeof ASSET_COLUMNS)[number][0];
export type AssetSortColumn = Exclude<AssetColumn, "action">;
export type AssetSortDirection = "asc" | "desc";
export type AssetTableSize = "compact" | "normal" | "wide";
export type AssetTablePreset = "professional" | "zakat";

export const ASSET_COLUMN_ORDER = ASSET_COLUMNS.map(
  ([key]) => key,
) as AssetColumn[];

export const ZAKAT_COLUMN_ORDER: AssetColumn[] = [
  "asset",
  "hawl",
  "current",
  "due",
  "paid",
  "remaining",
  "action",
];

export type AssetTablePreferences = {
  version: 4;
  preset: AssetTablePreset;
  size: AssetTableSize;
  visible: Record<AssetColumn, boolean>;
  order: AssetColumn[];
};

const isColumn = (value: unknown): value is AssetColumn =>
  typeof value === "string" &&
  ASSET_COLUMN_ORDER.includes(value as AssetColumn);

export function normalizeAssetColumnOrder(value: unknown): AssetColumn[] {
  const supplied = Array.isArray(value) ? value.filter(isColumn) : [];
  const unique = supplied.filter((key, index) => supplied.indexOf(key) === index);
  return [
    ...unique,
    ...ASSET_COLUMN_ORDER.filter((key) => !unique.includes(key)),
  ];
}

export function moveAssetColumn(
  value: unknown,
  from: AssetColumn,
  to: AssetColumn,
): AssetColumn[] {
  const order = normalizeAssetColumnOrder(value);
  if (from === to) return order;
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return order;
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, from);
  return order;
}

export function visibleAssetColumns(
  order: AssetColumn[],
  visible: Record<string, boolean>,
) {
  return normalizeAssetColumnOrder(order).filter((key) => visible[key] !== false);
}

const finiteNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return 0;
};

export function assetCurrentValue(row: any) {
  const metadata = row?.metadata || {};
  return firstNumber(
    row?.current_market_value,
    metadata.market_value,
    metadata.estimated_value,
    metadata.purchase_value,
    metadata.opening_value,
  );
}

export function assetCostValue(row: any) {
  const metadata = row?.metadata || {};
  return firstNumber(metadata.purchase_value, metadata.opening_value);
}

export function assetHawlDate(row: any) {
  const calculation = row?.zakat_calculation;
  const assessed = (calculation?.lots || [])
    .map((lot: any) => lot.hawl_start_date)
    .filter(Boolean)
    .sort()?.[0];
  const active = (row?.lots || [])
    .map((lot: any) => lot.hawl_start_date)
    .filter(Boolean)
    .sort()?.[0];
  return (
    assessed ||
    active ||
    calculation?.hawl_display_only?.portfolio_nisab_reached_date ||
    ""
  );
}

const assetSortValue = (row: any, column: AssetSortColumn) => {
  const calculation = row?.zakat_calculation || {};
  const due = Number(calculation.zakat_amount || 0);
  const paid = Number(calculation.paid_amount || 0);
  switch (column) {
    case "asset":
      return String(row?.name || "");
    case "date":
      return String(row?.metadata?.purchase_date || "");
    case "weight":
      return Number(row?.metadata?.quantity || 0);
    case "hawl":
      return assetHawlDate(row);
    case "cost":
      return assetCostValue(row);
    case "current":
      return assetCurrentValue(row);
    case "due":
      return due;
    case "paid":
      return paid;
    case "remaining":
      return Math.max(0, due - paid);
    case "calculation":
      return String((calculation.statuses || []).join(" "));
  }
};

export function sortAssetRows(
  rows: any[],
  column: AssetSortColumn,
  direction: AssetSortDirection,
) {
  const collator = new Intl.Collator("ar", {
    numeric: true,
    sensitivity: "base",
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = assetSortValue(left.row, column);
      const b = assetSortValue(right.row, column);
      const compared =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : collator.compare(String(a), String(b));
      const ordered = direction === "asc" ? compared : -compared;
      return ordered || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function assetTablePreset(
  preset: AssetTablePreset,
): AssetTablePreferences {
  const visible = Object.fromEntries(
    ASSET_COLUMN_ORDER.map((key) => [
      key,
      preset === "professional" || ZAKAT_COLUMN_ORDER.includes(key),
    ]),
  ) as Record<AssetColumn, boolean>;

  return {
    version: 4,
    preset,
    size: preset === "professional" ? "normal" : "compact",
    visible,
    order: normalizeAssetColumnOrder(
      preset === "professional" ? ASSET_COLUMN_ORDER : ZAKAT_COLUMN_ORDER,
    ),
  };
}

export function parseAssetTablePreferences(
  raw: string | null,
): AssetTablePreferences {
  const fallback = assetTablePreset("professional");
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const preset: AssetTablePreset =
      parsed?.preset === "zakat" ? "zakat" : "professional";
    const base = assetTablePreset(preset);
    const size: AssetTableSize = ["compact", "normal", "wide"].includes(
      parsed?.size,
    )
      ? parsed.size
      : base.size;
    const visible = Object.fromEntries(
      ASSET_COLUMN_ORDER.map((key) => [
        key,
        typeof parsed?.visible?.[key] === "boolean"
          ? parsed.visible[key]
          : base.visible[key],
      ]),
    ) as Record<AssetColumn, boolean>;

    return {
      version: 4,
      preset,
      size,
      visible,
      order: normalizeAssetColumnOrder(parsed?.order),
    };
  } catch {
    return fallback;
  }
}
