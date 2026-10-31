"use client";
import { useCallback, useEffect, useState } from "react";
import type { Plan } from "@/lib/subscriptions/catalog";
import TrialAdmin from "./TrialAdmin";
import PlanManager from "./PlanManager";
import ActivationRequestsConsole from "./ActivationRequestsConsole";
import "./subscriptions.css";
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
    [currentPlans, setPlans] = useState(plans);
  const reload = useCallback(async () => {
    const [m, p] = await Promise.all([
      fetch("/api/admin/subscriptions/panel", { cache: "no-store" }),
      fetch("/api/admin/trials", { cache: "no-store" }),
    ]);
    if (m.ok) setMetrics(await m.json());
    if (p.ok) setPlans((await p.json()).plans);
  }, []);
  useEffect(() => {
    void reload().catch(() => setMetrics(null));
  }, [reload, revision]);
  return (
    <section
      className="subscription-panel owner-subscription-console"
      dir={ar ? "rtl" : "ltr"}
    >
      <nav
        className="console-tabs"
        aria-label={ar ? "إدارة الاشتراكات" : "Subscription management"}
      >
        {[
          [
            "institutions",
            "▦",
            ar ? "اشتراكات المؤسسات" : "Organization subscriptions",
          ],
          ["requests", "✉", ar ? "طلبات التفعيل" : "Activation requests"],
          ["plans", "◈", ar ? "تعريف الباقات" : "Plan definitions"],
          ["payment", "▣", ar ? "إعدادات الدفع" : "Payment settings"],
        ].map(([id, icon, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      {metrics && (
        <div className="subscription-metrics">
          {[
            ["total", ar ? "إجمالي المؤسسات" : "Total organizations"],
            ["active", ar ? "الاشتراكات النشطة" : "Active subscriptions"],
            ["trialing", ar ? "التجارب النشطة" : "Active trials"],
            ["expired", ar ? "الاشتراكات المنتهية" : "Expired subscriptions"],
          ].map(([key, label]) => (
            <article key={key}>
              <span>{label}</span>
              <strong>{metrics[key] ?? 0}</strong>
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
