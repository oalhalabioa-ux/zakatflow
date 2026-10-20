export type AssetAcquisitionType = { code?: string | null; class_code?: string | null; default_legacy_asset_type?: string | null } | null | undefined;

const NON_PURCHASABLE_TYPES = new Set(["CASH", "BANK", "RECEIVABLE", "DEPOSIT", "PREPAYMENT", "ADVANCE"]);

export function isAssetPurchaseAllowed(type: AssetAcquisitionType): boolean {
  if (!type || !type.code || !type.class_code) return false;
  if (type.class_code === "FINANCIAL") return false;
  if (NON_PURCHASABLE_TYPES.has(type.code)) return false;
  return !NON_PURCHASABLE_TYPES.has(type.default_legacy_asset_type ?? "");
}
