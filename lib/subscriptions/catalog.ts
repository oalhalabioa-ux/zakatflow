export const MODULES = [
  {
    key: "assets",
    ar: "الأصول والعمليات",
    en: "Assets and transactions",
    routes: ["assets", "transactions", "lots"],
    core: true,
  },
  {
    key: "liquidity",
    ar: "النقد والبنوك والسندات",
    en: "Cash, banks and vouchers",
    routes: [
      "liquidity",
      "cash-and-banks",
      "financial-events",
      "financial-register",
    ],
    core: true,
  },
  {
    key: "zakat",
    ar: "الزكاة والتقييمات",
    en: "Zakat and assessments",
    routes: ["assessments", "payments"],
    core: false,
  },
  {
    key: "vat",
    ar: "الفواتير والضريبة",
    en: "Invoices and VAT",
    routes: ["vat", "invoice-register"],
    core: false,
  },
  {
    key: "debts",
    ar: "الديون والعقود والتمويل",
    en: "Debts, contracts and financing",
    routes: [
      "debts",
      "debt-openings",
      "debt-advances",
      "debt-collection",
      "debt-report",
      "loans",
      "payables",
      "receivables",
      "qard-loans",
      "employee-advances",
    ],
    core: false,
  },
  {
    key: "budgets",
    ar: "الموازنات والتخطيط",
    en: "Budgets and planning",
    routes: ["budget-planning"],
    core: false,
  },
  {
    key: "investments",
    ar: "الاستثمارات والمشاركات",
    en: "Investments and participations",
    routes: ["investments"],
    core: false,
  },
] as const;
export const FEATURES = [
  {
    key: "custom_roles",
    ar: "إنشاء وتخصيص الأدوار",
    en: "Create and customize roles",
  },
] as const;
export const ALL_CAPABILITIES = [
  ...MODULES.map((x) => "module:" + x.key),
  ...FEATURES.map((x) => "feature:" + x.key),
];
export type Plan = {
  id: string;
  code: string;
  family: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  price_amount: number | string;
  currency: string;
  billing_interval: "monthly" | "yearly";
  max_users: number | null;
  features: string[];
  is_active: boolean;
  is_published: boolean;
  is_proposed: boolean;
  revision: number;
  sort_order: number;
};
export function capabilityLabel(key: string, ar: boolean) {
  if (key === "core")
    return ar
      ? "جميع الموديولات (صلاحية قائمة)"
      : "All modules (existing access)";
  const [kind, id] = key.split(":");
  const x =
    kind === "module"
      ? MODULES.find((x) => x.key === id)
      : FEATURES.find((x) => x.key === id);
  return x ? (ar ? x.ar : x.en) : key;
}
export function routeCapability(path: string) {
  const segment = path.split("/")[2];
  return MODULES.find((x) => (x.routes as readonly string[]).includes(segment))
    ?.key;
}
export function includesCapability(caps: string[] | undefined, key: string) {
  return !caps || caps.includes("core") || caps.includes(key);
}
export function money(
  amount: number | string,
  currency: string,
  locale: string,
) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}
