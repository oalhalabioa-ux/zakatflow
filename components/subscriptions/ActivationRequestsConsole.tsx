"use client";
import OwnerMetrics from "@/app/admin/OwnerMetrics";
import { useOwnerRegisterQuery } from "./useOwnerRegisterQuery";
import { useCallback, useEffect, useState, useRef, useId, type FormEvent } from "react";
import {
  ConsoleIcon,
  OwnerActionIcon,
  OwnerStatusBadge,
  showOwnerDetail,
} from "./OwnerSubscriptionVisuals";
import { adminSubscriptionError } from "@/lib/subscriptions/admin-errors";
import { money } from "@/lib/subscriptions/catalog";
import { displaySubscriptionDate } from "@/lib/subscriptions/model";
import {
  openRequest,
  requestLabel,
  type ActivationRequest,
} from "@/lib/subscriptions/requests";
type Payment = {
  provider: string;
  environment: "test" | "production";
  enabled: false;
  revision: number;
};
export default function ActivationRequestsConsole({
  locale,
  paymentOnly = false,
  onChanged,
  onOpenPayment,
}: {
  locale: string;
  paymentOnly?: boolean;
  onChanged: () => void;
  onOpenPayment?: () => void;
}) {
  const formId = useId();
  const { search, status, offset, setSearch, setStatus, setOffset } =
    useOwnerRegisterQuery("req");
  const ar = locale === "ar",
    [rows, setRows] = useState<ActivationRequest[]>([]),
    [selected, setSelected] = useState<ActivationRequest | null>(null),
    [payment, setPayment] = useState<Payment | null>(null),
    [count, setCount] = useState<number | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const r = await fetch(
          "/api/admin/subscriptions/requests?" +
            new URLSearchParams({ search, status, offset: String(offset) }),
          { cache: "no-store", signal },
        );
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setRows(b.rows);
        setCount(b.pending_count);
        setPayment(b.payment);
        setSelected((current) =>
          current
            ? (b.rows.find((v: ActivationRequest) => v.id === current.id) ??
              b.rows[0] ??
              null)
            : (b.rows[0] ?? null),
        );
        setError("");
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setCount(null);
        setError(
          ar
            ? "تعذر تحميل الطلبات. أعد المحاولة."
            : "Unable to load requests. Please retry.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [search, status, offset, ar],
  );
  const firstRequestLoad = useRef(true);
  useEffect(() => {
    const c = new AbortController();
    const delay = firstRequestLoad.current ? 0 : 200;
    firstRequestLoad.current = false;
    const t = setTimeout(() => void load(c.signal), delay);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [load]);
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const f = new FormData(e.currentTarget),
      action =
        ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
          ?.value || "approve";
    if (action === "approve" && !f.get("until")) {
      setError(
        ar
          ? "حدد تاريخ انتهاء الاشتراك قبل الموافقة."
          : "Choose a subscription end date before approval.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/subscriptions/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: selected.id,
          revision: selected.revision,
          action,
          reason: f.get("reason"),
          ...(action === "approve"
            ? { until: new Date(String(f.get("until"))).toISOString() }
            : {}),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setSelected(b);
      setMessage(
        ar
          ? "تم حفظ القرار وتسجيله في سجل التدقيق."
          : "Decision saved and audited.",
      );
      await load();
      onChanged();
    } catch (e) {
      setError(
        adminSubscriptionError(
          e instanceof Error ? e.message : "REQUEST_FAILED",
          ar,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function savePayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!payment || busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/subscriptions/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: f.get("provider"),
          environment: f.get("environment"),
          revision: payment.revision,
          reason: f.get("reason"),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setPayment(b);
      setMessage(
        ar
          ? "حُفظت إعدادات التجهيز. الدفع بالبطاقة ما زال متوقفاً."
          : "Readiness saved. Card payments remain disabled.",
      );
    } catch (e) {
      setError(
        adminSubscriptionError(
          e instanceof Error ? e.message : "REQUEST_FAILED",
          ar,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const paymentCard = (
    <section className="console-card owner-payment-card">
      <header className="console-heading">
        <h3>
          <ConsoleIcon name="card" />
          {ar ? "إعدادات الدفع بالبطاقة" : "Card payment readiness"}
        </h3>
        <OwnerStatusBadge status="suspended">
          {ar ? "متوقف مؤقتاً" : "Temporarily disabled"}
        </OwnerStatusBadge>
      </header>
      <p className="owner-payment-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={ar ? "تفعيل الدفع بالبطاقة" : "Enable card payments"}
          checked={false}
          disabled
        />
        {ar ? "الدفع الحقيقي غير مفعّل" : "Live card processing is disabled"}
      </p>
      <dl className="owner-payment-metadata">
        <div>
          <dt>{ar ? "بوابة الدفع" : "Payment provider"}</dt>
          <dd>{payment?.provider || (ar ? "لم تُحدد" : "Not configured")}</dd>
        </div>
        <div>
          <dt>{ar ? "بيئة التشغيل" : "Environment"}</dt>
          <dd>
            {payment?.environment === "production"
              ? ar
                ? "إنتاج — غير متصل"
                : "Production — disconnected"
              : ar
                ? "تجريبية"
                : "Test"}
          </dd>
        </div>
        <div>
          <dt>{ar ? "بيانات الربط" : "Credentials"}</dt>
          <dd>{ar ? "غير مضافة" : "Not configured"}</dd>
        </div>
      </dl>
      <p className="owner-detail-note">
        <ConsoleIcon name="info" />
        {ar
          ? "لن تُرسل معاملات إلى أي بوابة قبل الربط واعتماد التفعيل."
          : "No transactions are sent to a provider before integration and approval."}
      </p>
      {!paymentOnly && (
        <button className="owner-row-action" onClick={onOpenPayment}>
          <OwnerActionIcon name="settings"/> {ar ? "تجهيز الإعدادات" : "Configure readiness"}
        </button>
      )}
      {paymentOnly && payment && (
        <form onSubmit={savePayment} className="request-form">
          <label>
            {ar
              ? "اسم المزود المخطط — دون مفاتيح"
              : "Planned provider — no credentials"}
            <input
              name="provider"
              maxLength={80}
              defaultValue={payment.provider}
            />
          </label>
          <label>
            {ar ? "بيئة الربط المخططة" : "Planned environment"}
            <select name="environment" defaultValue={payment.environment}>
              <option value="test">{ar ? "اختبار" : "Test"}</option>
              <option value="production">
                {ar ? "إنتاج — يبقى متوقفاً" : "Production — remains disabled"}
              </option>
            </select>
          </label>
          <label className="form-wide">
            {ar ? "سبب التعديل" : "Reason"}
            <textarea name="reason" required minLength={5} maxLength={1000} />
          </label>
          <button className="primary" disabled={busy}>
            <OwnerActionIcon name="save"/> {ar ? "حفظ إعدادات التجهيز" : "Save readiness"}
          </button>
        </form>
      )}
    </section>
  );
  return (
    <section className="activation-console">
      {!paymentOnly && (
        <OwnerMetrics
          locale={locale}
          items={[
            {
              label: ar ? "طلبات مفتوحة" : "Open requests",
              value: count,
              icon: "requests",
              tone: "warning",
              note: ar
                ? "جميع الطلبات المفتوحة في المنصة"
                : "All open requests across the platform",
            },
            {
              label: ar ? "طلبات معروضة" : "Displayed requests",
              value: loading || count === null ? null : rows.length,
              icon: "layers",
              note: ar
                ? "حسب الفلاتر والصفحة الحالية"
                : "Current filters and page",
            },
          ]}
        />
      )}

      {loading && (
        <p className="owner-loading-note" role="status">
          {ar ? "جارٍ تحميل الطلبات…" : "Loading requests…"}
        </p>
      )}
      {error && (
        <p className="owner-feedback" role="alert">
          {error}{" "}
          <button onClick={() => void load()}>
            <OwnerActionIcon name="refresh"/> {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </p>
      )}
      {message && (
        <p className="owner-feedback success" role="status">
          {message}
        </p>
      )}
      {paymentOnly ? (
        paymentCard
      ) : (
        <div className="console-split owner-requests-split">
          <div className="console-detail owner-requests-register">
            <section className="console-card">
              <form
                className="owner-console-filters"
                onSubmit={(e) => e.preventDefault()}
              >
                <label className="owner-search">
                  <span className="sr-only">{ar ? "البحث" : "Search"}</span>
                  <ConsoleIcon name="search" />
                  <input
                    placeholder={
                      ar
                        ? "ابحث بالمؤسسة أو رقم الطلب"
                        : "Search organization or request number"
                    }
                    value={search}
                    disabled={busy}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">{ar ? "الحالة" : "Status"}</span>
                  <select
                    value={status}
                    disabled={busy}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">
                      {ar ? "كل الحالات" : "All statuses"}
                    </option>
                    {(
                      [
                        "pending",
                        "reviewing",
                        "needs_info",
                        "approved",
                        "rejected",
                        "cancelled",
                      ] as const
                    ).map((s) => (
                      <option key={s} value={s}>
                        {requestLabel(s, ar)}
                      </option>
                    ))}
                  </select>
                </label>
              </form>
              <div className="subscription-table-wrap">
                <table className="owner-requests-table">
                  <thead>
                    <tr>
                      {(ar
                        ? ["رقم الطلب", "المؤسسة والمسؤول", "الباقة", "الحالة"]
                        : [
                            "Request",
                            "Organization & applicant",
                            "Plan",
                            "Status",
                          ]
                      ).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        aria-selected={selected?.id === r.id}
                        onClick={() => {
                          if (!busy) {
                            setSelected(r);
                            showOwnerDetail("owner-activation-details");
                          }
                        }}
                      >
                        <td data-label={ar ? "رقم الطلب" : "Request"}>
                          <button
                            className="request-reference"
                            aria-label={ar ? "عرض الطلب" : "View request"}
                            disabled={busy}
                            onClick={() => {
                              setSelected(r);
                              setError("");
                            }}
                          >
                            <bdi dir="ltr">
                              REQ-{String(r.request_number).padStart(4, "0")}
                            </bdi>
                          </button>
                        </td>
                        <td
                          data-label={
                            ar ? "المؤسسة والمسؤول" : "Organization & applicant"
                          }
                        >
                          <strong>{r.organization_name}</strong>
                          <bdi
                            className="owner-contact"
                            dir="ltr"
                            title={r.requester_email}
                          >
                            {r.requester_email}
                          </bdi>
                        </td>
                        <td data-label={ar ? "الباقة" : "Plan"}>
                          {ar ? r.quote.name_ar : r.quote.name_en}
                          <small>
                            {money(
                              r.quote.price_amount,
                              r.quote.currency,
                              locale,
                            )}{" "}
                            /{" "}
                            {r.quote.billing_interval === "yearly"
                              ? ar
                                ? "سنة"
                                : "year"
                              : ar
                                ? "شهر"
                                : "month"}
                          </small>
                        </td>
                        <td data-label={ar ? "الحالة" : "Status"}>
                          <OwnerStatusBadge status={r.status}>
                            {requestLabel(r.status, ar)}
                          </OwnerStatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <p className="owner-empty">
                  {ar ? "لا توجد طلبات مطابقة." : "No matching requests."}
                </p>
              )}
              <footer className="owner-table-footer">
                <small>
                  {count} {ar ? "طلبات مفتوحة" : "open requests"}
                </small>
                <div className="owner-pagination-controls">
                  <button
                    disabled={offset === 0 || busy}
                    onClick={() => setOffset((x) => Math.max(0, x - 50))}
                  >
                    <OwnerActionIcon name="previous"/> {ar ? "السابق" : "Previous"}
                  </button>
                  <button
                    disabled={rows.length < 50 || busy}
                    onClick={() => setOffset((x) => x + 50)}
                  >
                    <OwnerActionIcon name="next"/> {ar ? "التالي" : "Next"}
                  </button>
                </div>
              </footer>
            </section>
            {paymentCard}
          </div>
          <aside
            className="console-card owner-request-detail"
            id="owner-activation-details"
            tabIndex={-1}
            aria-label={
              ar ? "تفاصيل طلب التفعيل" : "Activation request details"
            }
          >
            {selected ? (
              <>
                <header className="owner-request-heading">
                  <h2>{ar ? "تفاصيل الطلب" : "Request details"}</h2>
                  <strong dir="ltr">
                    REQ-{String(selected.request_number).padStart(4, "0")}
                  </strong>
                </header>
                <dl className="owner-detail-facts">
                  <div>
                    <dt>{ar ? "المؤسسة" : "Organization"}</dt>
                    <dd>{selected.organization_name}</dd>
                  </div>
                  <div>
                    <dt>{ar ? "مقدم الطلب" : "Applicant"}</dt>
                    <dd>
                      {selected.requester_name || selected.requester_email}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "الباقة" : "Plan"}</dt>
                    <dd>
                      {ar ? selected.quote.name_ar : selected.quote.name_en}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "الدورة" : "Interval"}</dt>
                    <dd>
                      {selected.quote.billing_interval === "monthly"
                        ? ar
                          ? "شهري"
                          : "Monthly"
                        : ar
                          ? "سنوي"
                          : "Yearly"}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "المستخدمون" : "Users"}</dt>
                    <dd>{selected.quote.max_users}</dd>
                  </div>
                  <div>
                    <dt>{ar ? "السعر المقترح" : "Quoted price"}</dt>
                    <dd>
                      {money(
                        selected.quote.price_amount,
                        selected.quote.currency,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "تاريخ الطلب" : "Requested on"}</dt>
                    <dd>
                      {displaySubscriptionDate(selected.created_at, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "الحالة" : "Status"}</dt>
                    <dd>
                      <OwnerStatusBadge status={selected.status}>
                        {requestLabel(selected.status, ar)}
                      </OwnerStatusBadge>
                    </dd>
                  </div>
                </dl>
                <details className="owner-request-contact">
                  <summary>
                    {ar
                      ? "التواصل وملاحظات العميل"
                      : "Contact and customer notes"}
                  </summary>
                  <p>
                    <bdi dir="ltr">{selected.requester_email}</bdi>
                  </p>
                  <p dir="ltr">{selected.phone}</p>
                  <p>
                    {selected.notes || (ar ? "لا توجد ملاحظات." : "No notes.")}
                  </p>
                </details>
                {selected.reason && (
                  <p
                    className="owner-feedback owner-decision-note"
                    data-tone={
                      selected.status === "approved"
                        ? "success"
                        : selected.status === "rejected"
                          ? "error"
                          : "info"
                    }
                  >
                    {selected.reason}
                  </p>
                )}
                {openRequest(selected) && (
                  <form
                    id={formId}
                    key={selected.id + selected.revision}
                    className="request-form owner-decision-form"
                    onSubmit={review}
                  >
                    <label className="form-wide">
                      {ar ? "تاريخ نهاية الاشتراك" : "Subscription end date"}
                      <span className="sr-only">
                        {ar
                          ? "تاريخ الانتهاء عند الموافقة — بتوقيت جهازك"
                          : "End date for approval — device timezone"}
                      </span>
                      <input
                        aria-label={
                          ar
                            ? "تاريخ الانتهاء عند الموافقة — بتوقيت جهازك"
                            : "End date for approval — device timezone"
                        }
                        name="until"
                        type="datetime-local"
                      />
                    </label>
                    <label className="form-wide">
                      {ar
                        ? "سبب القرار الإداري"
                        : "Administrative decision reason"}
                      <span className="owner-required" aria-hidden>
                        *
                      </span>
                      <textarea
                        aria-label={
                          ar
                            ? "سبب القرار — يظهر للعميل"
                            : "Decision reason — visible to customer"
                        }
                        name="reason"
                        required
                        minLength={5}
                        maxLength={1000}
                        rows={3}
                        placeholder={
                          ar
                            ? "أدخل سبب القرار — يظهر للعميل"
                            : "Enter the decision reason — visible to customer"
                        }
                      />
                    </label>
                    <footer className="form-wide owner-decision-actions">
                      <button
                        className="primary"
                        name="action"
                        value="approve"
                        disabled={busy}
                      >
                        <OwnerActionIcon name="approve"/> {ar
                          ? "اعتماد وتفعيل يدوياً"
                          : "Approve and activate manually"}
                      </button>
                      <button name="action" value="needs_info" disabled={busy}>
                        <OwnerActionIcon name="info"/> {ar ? "طلب معلومات" : "Request information"}
                      </button>
                      <button
                        className="danger"
                        name="action"
                        value="reject"
                        disabled={busy}
                      >
                        <OwnerActionIcon name="reject"/> {ar ? "رفض الطلب" : "Reject request"}
                      </button>
                    </footer>
                    <p className="owner-detail-note form-wide">
                      <ConsoleIcon name="info" />
                      {ar
                        ? "التفعيل اليدوي لا ينشئ إيصال دفع أو خصماً مالياً."
                        : "Manual activation does not create a payment receipt or charge."}
                    </p>
                    {selected.status === "pending" && (
                      <details className="form-wide owner-review-action">
                        <summary>
                          {ar ? "إجراء المراجعة" : "Review action"}
                        </summary>
                        <button name="action" value="review" disabled={busy}>
                          <OwnerActionIcon name="view"/> {ar ? "بدء المراجعة" : "Start review"}
                        </button>
                      </details>
                    )}
                  </form>
                )}
              </>
            ) : (
              <div className="owner-empty">
                <ConsoleIcon name="requests" />
                <h2>{ar ? "لا توجد تفاصيل للعرض" : "No request selected"}</h2>
                <p>
                  {ar
                    ? "اختر طلباً من القائمة."
                    : "Choose a request from the list."}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
