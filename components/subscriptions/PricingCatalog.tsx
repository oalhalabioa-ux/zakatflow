"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import ActivationRequestForm from "./ActivationRequestForm";
import {
  rememberedOrganization,
  preferredOrganization,
} from "@/lib/workspace-organization";
import {
  openRequest,
  requestLabel,
  type ActivationRequest,
} from "@/lib/subscriptions/requests";
import type { OrganizationSubscription } from "@/lib/subscriptions/model";
import { capabilityLabel, money, planCustomerNotice, type Plan } from "@/lib/subscriptions/catalog";
export default function PricingCatalog({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const [catalog, setCatalog] = useState<{
      trial_days: number;
      plans: Plan[];
    } | null>(null),
    [error, setError] = useState(false),
    [interval, setInterval] = useState<"monthly" | "yearly">("monthly"),
    [selected, setSelected] = useState<Plan | null>(null);
  const [context, setContext] = useState<{
    id: string;
    name: string;
    email: string;
    applicant: string;
    can_request: boolean;
    rows: ActivationRequest[];
    entitlement: OrganizationSubscription;
  } | null>(null);
  const [amendment, setAmendment] = useState<ActivationRequest | null>(null);
  const [notice, setNotice] = useState("");
  const contextVersion = useRef(0);
  const readContext = useCallback(async () => {
    const version = ++contextVersion.current;
    try {
      let id =
        new URLSearchParams(location.search).get("organization") ??
        rememberedOrganization();
      if (!id) {
        const r = await fetch("/api/organizations", { cache: "no-store" });
        if (!r.ok) throw Error();
        id = preferredOrganization(await r.json())?.id ?? null;
      }
      if (!id) {
        if (version === contextVersion.current) setContext(null);
        return;
      }
      const [rr, er] = await Promise.all([
        fetch("/api/subscriptions/requests?organization_id=" + id, {
          cache: "no-store",
        }),
        fetch("/api/subscriptions?organization_id=" + id, {
          cache: "no-store",
        }),
      ]);
      if (!rr.ok || !er.ok) throw Error();
      const [r, e] = await Promise.all([rr.json(), er.json()]);
      if (version !== contextVersion.current) return;
      setContext({
        id,
        name: e.organization_name,
        email: r.email,
        applicant: r.name,
        can_request: r.can_request,
        rows: r.rows,
        entitlement: e,
      });
    } catch {
      if (version === contextVersion.current) setContext(null);
    }
  }, []);
  useEffect(() => {
    void readContext();
    const read = () => {
      setSelected(null);
      setAmendment(null);
      setNotice("");
      void readContext();
    };
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    return () => {
      contextVersion.current++;
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [readContext]);
  async function cancel(r: ActivationRequest) {
    if (!context) return;
    try {
      const response = await fetch("/api/subscriptions/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          organization_id: context.id,
          request_id: r.id,
          revision: r.revision,
        }),
      });
      if (!response.ok) throw Error();
      await readContext();
    } catch {
      setNotice(
        ar
          ? "تعذر إلغاء الطلب. حدّث الصفحة."
          : "Unable to cancel request. Refresh and retry.",
      );
    }
  }
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
        {catalog.plans
          .filter((p) => p.billing_interval === interval)
          .map((p) => (
            <article className="pricing-card" key={p.id} data-plan={p.code}>
              <h2>{ar ? p.name_ar : p.name_en}</h2>
              {p.is_proposed && (
                <span className="plan-badge">
                  {planCustomerNotice(p, ar)}
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
              {context?.entitlement.status === "active" &&
              context.entitlement.plan_id === p.id ? (
                <span className="plan-badge current-plan">
                  {ar ? "الباقة الحالية المفعلة" : "Current active plan"}
                </span>
              ) : (
                <button
                  className="primary"
                  disabled={
                    !context?.can_request || context.rows.some(openRequest)
                  }
                  onClick={() => setSelected(p)}
                >
                  {ar ? "طلب تفعيل الباقة" : "Request activation"}
                </button>
              )}
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
      {notice && <p role="status">{notice}</p>}
      {context && !context.can_request && (
        <p>
          {ar
            ? "طلب التفعيل متاح لمالك المؤسسة أو مسؤولها."
            : "Only organization owners and administrators can request activation."}
        </p>
      )}
      {!!context?.rows.length && (
        <section className="request-history">
          <h3>
            {ar ? "طلبات تفعيل المؤسسة" : "Organization activation requests"}
          </h3>
          {context.rows.map((r) => (
            <article key={r.id} className="request-history-row">
              <div>
                <strong>
                  #{r.request_number} · {ar ? r.quote.name_ar : r.quote.name_en}
                </strong>
                <p>
                  {requestLabel(r.status, ar)} ·{" "}
                  {money(r.quote.price_amount, r.quote.currency, locale)}
                </p>
                {r.reason && <p>{r.reason}</p>}
              </div>
              {r.status === "needs_info" && (
                <button onClick={() => setAmendment(r)}>
                  {ar
                    ? "استكمال معلومات الطلب"
                    : "Complete request information"}
                </button>
              )}
              {openRequest(r) && (
                <button onClick={() => void cancel(r)}>
                  {ar ? "إلغاء الطلب" : "Cancel request"}
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      {amendment && context && (
        <ActivationRequestForm
          key={amendment.id}
          request={amendment}
          plan={amendment.quote}
          organizationId={context.id}
          organizationName={context.name}
          locale={locale}
          name={context.applicant}
          email={context.email}
          onClose={() => setAmendment(null)}
          onSaved={() => {
            setAmendment(null);
            setNotice(
              ar
                ? "تم تحديث الطلب وإعادته للمراجعة."
                : "Request updated and resubmitted for review.",
            );
            void readContext();
          }}
        />
      )}
      {selected && context && (
        <ActivationRequestForm
          key={context.id + selected.id}
          plan={selected}
          organizationId={context.id}
          organizationName={context.name}
          locale={locale}
          name={context.applicant}
          email={context.email}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setNotice(
              ar
                ? "تم إرسال طلب التفعيل بنجاح. يمكنك متابعة حالته هنا."
                : "Activation request sent. Track its status here.",
            );
            void readContext();
          }}
        />
      )}
    </>
  );
}
