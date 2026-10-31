export type SubscriptionStatus =
  | "legacy"
  | "unconfigured"
  | "trialing"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled"
  | "past_due";
export type OrganizationSubscription = {
  id?: string;
  started_at?: string;
  plan_id?: string;
  organization_id?: string;
  organization_name: string;
  status: SubscriptionStatus;
  can_write: boolean;
  trial_started_at?: string;
  trial_ends_at?: string;
  current_period_end?: string;
  trial_duration_days?: number;
  max_users: number | null;
  active_users: number;
  revision?: number;
  days_remaining?: number;
  server_now: string;
  timezone?: string;
  capabilities?: string[];
  plan_snapshot?: {
    id: string;
    name_ar: string;
    name_en: string;
    price_amount: number | string;
    currency: string;
    billing_interval: string;
  };
  plan?: {
    name_ar: string;
    name_en: string;
    features: string[];
    price_amount?: number | string;
    currency?: string;
    billing_interval?: string;
  };
  notifications?: { milestone: number; due_at: string }[];
};
export function subscriptionLabel(status: SubscriptionStatus, ar: boolean) {
  const names: Record<SubscriptionStatus, [string, string]> = {
    legacy: ["الوصول الحالي محفوظ", "Existing access preserved"],
    unconfigured: ["الاشتراك بحاجة إلى إعداد", "Subscription needs setup"],
    trialing: ["التجربة المجانية", "Free trial"],
    active: ["اشتراك نشط", "Active subscription"],
    expired: [
      "انتهت الفترة — قراءة وتصدير فقط",
      "Expired — read and export only",
    ],
    suspended: [
      "الاشتراك معلق — قراءة وتصدير فقط",
      "Suspended — read and export only",
    ],
    cancelled: [
      "الاشتراك ملغى — قراءة وتصدير فقط",
      "Cancelled — read and export only",
    ],
    past_due: ["قراءة وتصدير فقط", "Read and export only"],
  };
  return names[status]?.[ar ? 0 : 1] ?? status;
}
export function subscriptionError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "REQUEST_FAILED";
  return {
    error: message,
    status:
      message === "UNAUTHORIZED"
        ? 401
        : /REQUIRED|READ_ONLY|IMMUTABLE/.test(message)
          ? 403
          : /CONFLICT|USER_LIMIT/.test(message)
            ? 409
            : 400,
  };
}
export function displaySubscriptionDate(
  value: string | undefined,
  locale: string,
  timeZone = "UTC",
) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(
      locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { dateStyle: "medium", timeStyle: "short", timeZone },
    ).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  }
}
