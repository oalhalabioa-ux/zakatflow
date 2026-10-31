"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  routeCapability,
  includesCapability,
  money,
} from "@/lib/subscriptions/catalog";
import {
  rememberedOrganization,
  preferredOrganization,
} from "@/lib/workspace-organization";
import { useWorkspaceScope } from "@/hooks/useWorkspaceScope";
import {
  displaySubscriptionDate,
  subscriptionLabel,
  type OrganizationSubscription,
} from "@/lib/subscriptions/model";
import "./subscriptions.css";
export default function SubscriptionBanner({
  locale,
  always = false,
}: {
  locale: string;
  always?: boolean;
}) {
  const ar = locale === "ar",
    pathname = usePathname(),
    [scope] = useWorkspaceScope();
  const [data, setData] = useState<OrganizationSubscription | null>(null),
    [error, setError] = useState(false),
    [dismissed, setDismissed] = useState("");
  useEffect(() => {
    if (
      !always &&
      (scope !== "ORGANIZATION" ||
        /\/(login|onboarding|billing)$/.test(pathname))
    ) {
      setData(null);
      return;
    }
    let generation = 0,
      live = true;
    async function read() {
      const version = ++generation;
      try {
        const q = new URLSearchParams(location.search);
        let id =
          q.get("organization") ??
          q.get("organization_id") ??
          rememberedOrganization();
        if (!id) {
          const r = await fetch("/api/organizations", { cache: "no-store" });
          if (!r.ok) throw new Error();
          id = preferredOrganization(await r.json())?.id ?? null;
        }
        if (!id) {
          if (live && version === generation) {
            setData(null);
            setError(false);
          }
          return;
        }
        const r = await fetch(
          "/api/subscriptions?organization_id=" + encodeURIComponent(id),
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error();
        const value = await r.json();
        if (live && version === generation) {
          setData(value);
          setError(false);
        }
      } catch {
        if (live && version === generation) {
          setData(null);
          setError(true);
        }
      }
    }
    void read();
    const interval = setInterval(read, 60000);
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      generation++;
      clearInterval(interval);
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [scope, pathname, always]);
  if (error && !always) return null;
  if (error)
    return (
      <aside className="subscription-banner" role="status">
        {ar
          ? "تعذر تحديث حالة الاشتراك. أعد المحاولة."
          : "Unable to refresh subscription status. Please retry."}
      </aside>
    );
  if (!data) return null;
  const end =
    data.status === "active" ? data.current_period_end : data.trial_ends_at;
  const module = routeCapability(pathname),
    moduleLocked =
      !!module && !includesCapability(data.capabilities, "module:" + module);
  const milestone = data.notifications?.length
    ? Math.min(...data.notifications.map((n) => n.milestone))
    : undefined;
  if (!always) {
    const days = data.status === "trialing" ? data.days_remaining : undefined;
    const nearing = days != null && days <= 7;
    if (data.can_write && !moduleLocked && !nearing) return null;
    const threshold = days != null ? (days <= 1 ? 1 : days <= 3 ? 3 : 7) : 0;
    const noticeKey = [data.organization_id, end, threshold].join(":");
    if (data.can_write && !moduleLocked && dismissed === noticeKey) return null;
    return (
      <aside
        className="subscription-notice"
        data-read-only={!data.can_write}
        aria-label={ar ? "حالة الاشتراك" : "Subscription status"}
        role="status"
      >
        <span>
          {!data.can_write
            ? ar
              ? "وضع القراءة والتصدير فقط. بيانات المؤسسة محفوظة."
              : "Read and export only. Organization data is preserved."
            : moduleLocked
              ? ar
                ? "هذا الموديول متاح للقراءة والتصدير؛ الكتابة تتطلب ترقية الباقة."
                : "This module is available to read and export; writing requires a plan upgrade."
              : ar
                ? `تنتهي التجربة خلال ${days} أيام.`
                : `Your trial ends in ${days} days.`}
        </span>
        <Link
          href={`/${locale}/billing?organization=${data.organization_id ?? ""}`}
        >
          {ar ? "تفاصيل الاشتراك" : "Subscription details"}
        </Link>
        {data.can_write && !moduleLocked && (
          <button
            type="button"
            aria-label={ar ? "إخفاء التنبيه" : "Dismiss reminder"}
            onClick={() => setDismissed(noticeKey)}
          >
            ×
          </button>
        )}
      </aside>
    );
  }
  return (
    <aside
      className="subscription-banner"
      data-read-only={!data.can_write}
      aria-label={ar ? "حالة الاشتراك" : "Subscription status"}
    >
      <div>
        {moduleLocked && (
          <p role="status">
            {ar
              ? "هذا الموديول غير مشمول للكتابة في باقتك. يمكنك قراءة البيانات السابقة وتصديرها، أو طلب ترقية الباقة."
              : "This module is not included for writing. Existing data remains readable and exportable; request a plan upgrade to write."}
          </p>
        )}
        <strong>
          {data.organization_name} · {subscriptionLabel(data.status, ar)}
        </strong>
        {data.plan && (
          <p>
            {ar ? "الباقة: " : "Plan: "}
            {ar ? data.plan.name_ar : data.plan.name_en}
            {data.plan.price_amount != null && data.plan.currency && (
              <>
                {" "}
                · {money(
                  data.plan.price_amount,
                  data.plan.currency,
                  locale,
                )} /{" "}
                {data.plan.billing_interval === "yearly"
                  ? ar
                    ? "سنة"
                    : "year"
                  : ar
                    ? "شهر"
                    : "month"}
              </>
            )}
          </p>
        )}
        <p>
          {data.days_remaining != null && (
            <span>
              {ar ? "الأيام المتبقية: " : "Days remaining: "}
              {data.days_remaining} ·{" "}
            </span>
          )}
          {end && (
            <span>
              {ar ? "تنتهي في: " : "Ends: "}
              {displaySubscriptionDate(end, locale, data.timezone)} ·{" "}
            </span>
          )}
          {ar ? "المستخدمون النشطون: " : "Active users: "}
          {data.active_users}
          {data.max_users != null ? ` / ${data.max_users}` : ""}
        </p>
        {milestone != null && (
          <p role="status">
            {milestone === 0
              ? ar
                ? "انتهت التجربة. بياناتك محفوظة ويمكنك استعراضها وتصديرها."
                : "Your trial ended. Your data remains available to view and export."
              : ar
                ? `تنبيه: تنتهي تجربتك خلال ${milestone} أيام.`
                : `Reminder: your trial ends within ${milestone} days.`}
          </p>
        )}
        {!data.can_write && (
          <p>
            {ar
              ? "إنشاء العمليات وتعديلها وحذفها والاستيراد متوقف. القراءة والتصدير متاحان وفق صلاحياتك."
              : "Creating, editing, deleting and importing are paused. Reading and exporting remain available within your permissions."}
          </p>
        )}
      </div>
      <Link
        href={`/${locale}/billing?organization=${data.organization_id ?? ""}`}
      >
        {ar ? "عرض خطط الاشتراك" : "View subscription plans"}
      </Link>
    </aside>
  );
}
