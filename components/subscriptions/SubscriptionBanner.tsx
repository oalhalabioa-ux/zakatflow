"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
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
    [error, setError] = useState(false);
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
  const milestone = data.notifications?.[0]?.milestone;
  return (
    <aside
      className="subscription-banner"
      data-read-only={!data.can_write}
      aria-label={ar ? "حالة الاشتراك" : "Subscription status"}
    >
      <div>
        <strong>
          {data.organization_name} · {subscriptionLabel(data.status, ar)}
        </strong>
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
