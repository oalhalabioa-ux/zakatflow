/** Administrative aggregates only. Missing/invalid values are never displayed as zero. */
export function adminCount(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  )
    return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}
export function organizationDistribution(
  panel: Record<string, unknown> | null,
) {
  if (!panel) return null;
  const total = adminCount(panel.total),
    active = adminCount(panel.active),
    trialing = adminCount(panel.trialing),
    expired = adminCount(panel.expired);
  if (
    total === null ||
    active === null ||
    trialing === null ||
    expired === null ||
    active + trialing + expired > total
  )
    return null;
  return {
    total,
    active,
    trialing,
    expired,
    other: total - active - trialing - expired,
  };
}
export function adminPercent(part: number | null, total: number | null) {
  return part === null ||
    total === null ||
    !Number.isFinite(part) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    part < 0 ||
    part > total
    ? null
    : Math.round((part / total) * 1000) / 10;
}
export const adminNumber = (value: number, locale: string) =>
  new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    maximumFractionDigits: 1,
  }).format(value);
