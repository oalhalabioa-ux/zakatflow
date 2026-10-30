"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { capabilityLabel, money, type Plan } from "@/lib/subscriptions/catalog";
export default function PricingCatalog({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const [catalog, setCatalog] = useState<{
      trial_days: number;
      plans: Plan[];
    } | null>(null),
    [error, setError] = useState(false),
    [interval, setInterval] = useState<"monthly" | "yearly">("monthly"),
    [selected, setSelected] = useState<Plan | null>(null);
  const load = useCallback(async () => {
    try {
      setError(false);
      const r = await fetch("/api/subscriptions/plans", { cache: "no-store" });
      if (!r.ok) throw Error();
      setCatalog(await r.json());
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <p role="alert">
        {ar ? "تعذر تحميل الباقات." : "Unable to load plans."}{" "}
        <button onClick={() => void load()}>
          {ar ? "إعادة المحاولة" : "Retry"}
        </button>
      </p>
    );
  if (!catalog)
    return <p role="status">{ar ? "جارٍ تحميل الباقات…" : "Loading plans…"}</p>;
  return (
    <>
      <div
        className="pricing-interval"
        role="group"
        aria-label={ar ? "دورة الاشتراك" : "Billing interval"}
      >
        {(["monthly", "yearly"] as const).map((v) => (
          <button
            key={v}
            aria-pressed={interval === v}
            onClick={() => {
              setInterval(v);
              setSelected(null);
            }}
          >
            {v === "monthly"
              ? ar
                ? "شهري"
                : "Monthly"
              : ar
                ? "سنوي"
                : "Yearly"}
          </button>
        ))}
      </div>
      <div className="pricing-grid">
        <article className="pricing-card">
          <h2>{ar ? "التجربة المجانية" : "Free trial"}</h2>
          <p className="pricing-amount">{ar ? "مجاناً" : "Free"}</p>
          <p>
            {catalog.trial_days} {ar ? "يوماً · 5 مستخدمين" : "days · 5 users"}
          </p>
          <p>
            {ar
              ? "جميع الموديولات الأساسية، دون بطاقة أو تجديد تلقائي. تبدأ مرة واحدة عند إنشاء المؤسسة."
              : "All core modules. No card or automatic renewal. Starts once when the institution is created."}
          </p>
        </article>
        {catalog.plans
          .filter((p) => p.billing_interval === interval)
          .map((p) => (
            <article className="pricing-card" key={p.id} data-plan={p.code}>
              <h2>{ar ? p.name_ar : p.name_en}</h2>
              {p.is_proposed && (
                <span className="plan-badge">
                  {ar ? "سعر إطلاق مقترح" : "Proposed launch price"}
                </span>
              )}
              <p>{ar ? p.description_ar : p.description_en}</p>
              <p className="pricing-amount">
                {money(p.price_amount, p.currency, locale)}{" "}
                <small>
                  {interval === "monthly"
                    ? ar
                      ? "/ شهر"
                      : "/ month"
                    : ar
                      ? "/ سنة"
                      : "/ year"}
                </small>
              </p>
              {interval === "yearly" && (
                <p>
                  {money(Number(p.price_amount) / 12, p.currency, locale)}{" "}
                  {ar
                    ? "شهرياً كمعدل؛ التفعيل لسنة كاملة."
                    : "monthly equivalent; activated for a full year."}
                </p>
              )}
              <p>
                {p.max_users}{" "}
                {ar
                  ? "مستخدمين نشطين لكل مؤسسة"
                  : "active users per institution"}
              </p>
              <ul>
                <li>
                  {ar
                    ? "قراءة البيانات والتقارير والتصدير وفق صلاحيات العضو"
                    : "Read, reports and export within member permissions"}
                </li>
                {p.features.map((f) => (
                  <li key={f}>{capabilityLabel(f, ar)}</li>
                ))}
              </ul>
              <button onClick={() => setSelected(p)}>
                {ar ? "تفاصيل التفعيل" : "Activation details"}
              </button>
            </article>
          ))}
      </div>
      {!catalog.plans.some((p) => p.billing_interval === interval) && (
        <p>
          {ar
            ? "لا توجد باقات منشورة بهذه الدورة حالياً."
            : "No published plans for this interval yet."}
        </p>
      )}
      <p className="pricing-note">
        {ar
          ? "الأسعار لكل مؤسسة، وغير شاملة أي ضرائب واجبة التطبيق. التفعيل يدوي بعد المراجعة؛ لا دفع إلكتروني ولا خصم أو تجديد تلقائي. الباقات المخصصة يحددها مالك المنصة."
          : "Prices are per institution, excluding applicable taxes. Activation is manual after review. No online payment, automatic charge or renewal. Custom plans are configured by the platform owner."}
      </p>
      {selected && (
        <section className="plan-activation" role="status">
          <h3>{ar ? "تفعيل الباقة المختارة" : "Activate selected plan"}</h3>
          <p>
            {ar ? selected.name_ar : selected.name_en} ·{" "}
            {money(selected.price_amount, selected.currency, locale)} ·{" "}
            {selected.billing_interval === "monthly"
              ? ar
                ? "شهري"
                : "Monthly"
              : ar
                ? "سنوي"
                : "Yearly"}
          </p>
          <p>
            {ar
              ? "تواصل مع مسؤول المنصة لتأكيد السعر والضرائب وتاريخ التفعيل. اختيار الباقة هنا لا ينشئ اشتراكاً أو عملية دفع."
              : "Contact the platform administrator to confirm the price, taxes and activation date. Selecting this plan does not create a subscription or payment."}
          </p>
          <Link href={`/${locale}/guide`}>
            {ar ? "المساعدة والتواصل" : "Help and contact"}
          </Link>
          <button onClick={() => setSelected(null)}>
            {ar ? "إغلاق" : "Close"}
          </button>
        </section>
      )}
    </>
  );
}
