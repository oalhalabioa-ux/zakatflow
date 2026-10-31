/** Namespaced register state survives tabs, language changes and browser navigation. */
export function ownerRegisterQuery(params: URLSearchParams, prefix: string) {
  const offset = Number(params.get(prefix + "_offset") || 0);
  return {
    search: (params.get(prefix + "_search") || "").slice(0, 120),
    status: params.get(prefix + "_status") || "",
    offset:
      Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000
        ? offset
        : 0,
  };
}
export function updateOwnerQuery(
  changes: Record<string, string | number>,
  push = false,
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === "" || value === 0) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  // Next integrates the native history API with useSearchParams, without a server fetch.
  window.history[push ? "pushState" : "replaceState"](
    null,
    "",
    url.pathname + url.search + url.hash,
  );
}
export const ownerSubscriptionSections = [
  {
    id: "institutions",
    ar: "اشتراكات المؤسسات",
    en: "Organization subscriptions",
    icon: "building",
  },
  {
    id: "requests",
    ar: "طلبات التفعيل",
    en: "Activation requests",
    icon: "requests",
  },
  {
    id: "plans",
    ar: "الباقات والمميزات",
    en: "Plan definitions",
    icon: "layers",
  },
  {
    id: "payment",
    ar: "إعدادات الدفع",
    en: "Payment settings",
    icon: "settings",
  },
] as const;
