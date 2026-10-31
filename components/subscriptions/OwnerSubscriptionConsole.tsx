"use client";
import { useCallback, useEffect, useState } from "react";
import type { Plan } from "@/lib/subscriptions/catalog";
import TrialAdmin from "./TrialAdmin";
import PlanManager from "./PlanManager";
import ActivationRequestsConsole from "./ActivationRequestsConsole";
import "./subscriptions.css";
import "./owner-subscriptions.css";
import { ConsoleIcon, type ConsoleIconName } from "./OwnerSubscriptionVisuals";
export default function OwnerSubscriptionConsole({
  locale,
  plans,
}: {
  locale: string;
  plans: Plan[];
}) {
  const ar = locale === "ar",
    [tab, setTab] = useState("institutions"),
    [revision, setRevision] = useState(0),
    [metrics, setMetrics] = useState<Record<string, number> | null>(null),
    [currentPlans, setPlans] = useState(plans),
    [pendingCount, setPendingCount] = useState(0);
  const reload = useCallback(async () => {
    const [m, p, requests] = await Promise.all([
      fetch("/api/admin/subscriptions/panel", { cache: "no-store" }),
      fetch("/api/admin/trials", { cache: "no-store" }),
      fetch("/api/admin/subscriptions/requests", { cache: "no-store" }),
    ]);
    if (m.ok) setMetrics(await m.json());
    if (p.ok) setPlans((await p.json()).plans);
    if (requests.ok) setPendingCount((await requests.json()).pending_count);
  }, []);
  useEffect(() => {
    void reload().catch(() => setMetrics(null));
  }, [reload, revision]);
  return (
    <section
      className="subscription-panel owner-subscription-console"
      dir={ar ? "rtl" : "ltr"}
      data-view={tab}
    >
      <nav
        className="console-tabs owner-console-tabs"
        aria-label={ar ? "إدارة الاشتراكات" : "Subscription management"}
      >
        {[
          [
            "institutions",
            "building",
            ar ? "اشتراكات المؤسسات" : "Organization subscriptions",
          ],
          [
            "requests",
            "requests",
            ar ? "طلبات التفعيل" : "Activation requests",
          ],
          ["plans", "layers", ar ? "الباقات والمميزات" : "Plan definitions"],
          ["payment", "settings", ar ? "إعدادات الدفع" : "Payment settings"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            aria-label={label}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            <ConsoleIcon name={icon as ConsoleIconName} />
            <span>{label}</span>
            {id === "requests" && pendingCount > 0 && (
              <span className="owner-request-count" aria-hidden="true">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      {metrics && tab === "institutions" && (
        <div className="subscription-metrics">
          {[
            ["total", ar ? "إجمالي المؤسسات" : "Total organizations"],
            ["active", ar ? "الاشتراكات النشطة" : "Active subscriptions"],
            ["trialing", ar ? "التجارب النشطة" : "Active trials"],
            ["expired", ar ? "الاشتراكات المنتهية" : "Expired subscriptions"],
          ].map(([key, label]) => (
            <article key={key} data-metric={key}>
              <span className="owner-metric-icon">
                <ConsoleIcon
                  name={
                    (
                      {
                        total: "building",
                        active: "users",
                        trialing: "trial",
                        expired: "clock",
                      } as const
                    )[key as "total" | "active" | "trialing" | "expired"]
                  }
                />
              </span>
              <div>
                <span>{label}</span>
                <strong>{metrics[key] ?? 0}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "institutions" && (
        <TrialAdmin
          key={revision}
          locale={locale}
          plans={currentPlans}
          onChanged={reload}
        />
      )}
      {tab === "requests" && (
        <ActivationRequestsConsole
          locale={locale}
          onOpenPayment={() => setTab("payment")}
          onChanged={() => setRevision((x) => x + 1)}
        />
      )}
      {tab === "plans" && (
        <PlanManager
          locale={locale}
          plans={currentPlans}
          onSaved={async () => {
            setRevision((x) => x + 1);
          }}
        />
      )}
      {tab === "payment" && (
        <ActivationRequestsConsole
          locale={locale}
          paymentOnly
          onChanged={() => setRevision((x) => x + 1)}
        />
      )}
    </section>
  );
}
