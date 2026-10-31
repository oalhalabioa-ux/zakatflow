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
    <section
      className="subscription-summary"
      aria-label={ar ? "حالة الاشتراك" : "Subscription status"}
      data-read-only={!data.can_write}
    >
      <header>
        <h2>{data.organization_name}</h2>
        <span className="subscription-state">
          {subscriptionLabel(data.status, ar)}
        </span>
      </header>
      {data.status === "legacy" && (
        <p>
          {ar
            ? "لم تُفعّل باقة تجارية لهذه المؤسسة بعد. بياناتك وصلاحياتك الحالية محفوظة."
            : "No commercial plan is active for this organization yet. Existing data and permissions are preserved."}
        </p>
      )}
      {data.plan && (
        <p>
          {ar ? "الباقة الحالية: " : "Current plan: "}
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
      <dl className="subscription-summary-metrics">
        {data.days_remaining != null && (
          <div>
            <dt>{ar ? "الأيام المتبقية" : "Days remaining"}</dt>
            <dd>{data.days_remaining}</dd>
          </div>
        )}
        {end && (
          <div>
            <dt>{ar ? "تاريخ الانتهاء" : "End date"}</dt>
            <dd>{displaySubscriptionDate(end, locale, data.timezone)}</dd>
          </div>
        )}
        <div>
          <dt>{ar ? "المستخدمون النشطون" : "Active users"}</dt>
          <dd>
            {data.active_users}
            {data.max_users != null ? ` / ${data.max_users}` : ""}
          </dd>
        </div>
      </dl>
      {!data.can_write && (
        <p className="settings-hint">
          {ar
            ? "بيانات المؤسسة محفوظة. يمكنك الاستعراض والتصدير وفق صلاحياتك؛ إنشاء العمليات وتعديلها والاستيراد متوقف."
            : "Organization data is preserved. Read and export within your permissions; creating, editing and importing are paused."}
        </p>
      )}
      {data.status === "trialing" && (
        <p className="settings-hint">
          {ar
            ? "التجربة دون بطاقة بنكية أو خصم أو تجديد تلقائي."
            : "No card, automatic charge or renewal during your trial."}
        </p>
      )}
      <div className="subscription-summary-actions">
        <Link href="#subscription-plans">
          {ar ? "عرض الباقات" : "View plans"}
        </Link>
        <Link
          href={`/${locale}/users?organization=${data.organization_id ?? ""}`}
        >
          {ar ? "إدارة الأعضاء" : "Manage members"}
        </Link>
      </div>
    </section>
  );
}
