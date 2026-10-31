"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
}: {
  locale: string;
  paymentOnly?: boolean;
  onChanged: () => void;
}) {
  const ar = locale === "ar",
    [rows, setRows] = useState<ActivationRequest[]>([]),
    [selected, setSelected] = useState<ActivationRequest | null>(null),
    [payment, setPayment] = useState<Payment | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [count, setCount] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
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
              null)
            : null,
        );
        setError("");
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(
          ar
            ? "تعذر تحميل الطلبات. أعد المحاولة."
            : "Unable to load requests. Please retry.",
        );
      }
    },
    [search, status, offset, ar],
  );
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => void load(c.signal), 200);
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
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
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
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  const paymentCard = (
    <section className="console-card">
      <header className="console-heading">
        <h3>{ar ? "إعدادات الدفع بالبطاقة" : "Card payment readiness"}</h3>
        <span className="plan-badge">{ar ? "متوقف" : "Disabled"}</span>
      </header>
      <p>
        {ar
          ? "التفعيل اليدوي متاح. لا توجد معالجة بطاقات أو مفاتيح دفع مخزنة."
          : "Manual activation is available. No card processing or stored payment credentials."}
      </p>
      <dl className="console-facts">
        <div>
          <dt>{ar ? "مزود الدفع" : "Provider"}</dt>
          <dd>{payment?.provider || (ar ? "غير محدد" : "Not configured")}</dd>
        </div>
        <div>
          <dt>{ar ? "البيئة" : "Environment"}</dt>
          <dd>
            {payment?.environment === "production"
              ? ar
                ? "إنتاج — غير متصل"
                : "Production — disconnected"
              : ar
                ? "اختبار"
                : "Test"}
          </dd>
        </div>
        <div>
          <dt>{ar ? "حالة الربط" : "Integration"}</dt>
          <dd>
            {ar
              ? "يتطلب ربطاً واعتماداً لاحقاً"
              : "Integration and approval required"}
          </dd>
        </div>
      </dl>
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
          <button disabled={busy}>
            {ar ? "حفظ إعدادات التجهيز" : "Save readiness"}
          </button>
        </form>
      )}
    </section>
  );
  return (
    <section className="activation-console">
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => void load()}>
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {paymentOnly ? (
        paymentCard
      ) : (
        <>
          <header className="console-heading">
            <h2>
              {ar ? "طلبات تفعيل الاشتراك" : "Subscription activation requests"}
            </h2>
            <span className="plan-badge">
              {count} {ar ? "طلبات مفتوحة" : "open requests"}
            </span>
          </header>
          <div className="console-filters">
            <label>
              {ar ? "البحث" : "Search"}
              <input
                value={search}
                placeholder={
                  ar
                    ? "المؤسسة أو البريد أو رقم الطلب"
                    : "Organization, email or request number"
                }
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              {ar ? "الحالة" : "Status"}
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">{ar ? "جميع الحالات" : "All statuses"}</option>
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
          </div>
          <div className="console-split">
            <div className="console-detail">
              <section className="console-card">
                <div className="subscription-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(ar
                          ? [
                              "الطلب",
                              "المؤسسة والمسؤول",
                              "الباقة",
                              "الحالة",
                              "الإجراء",
                            ]
                          : [
                              "Request",
                              "Organization & applicant",
                              "Plan",
                              "Status",
                              "Action",
                            ]
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} aria-selected={selected?.id === r.id}>
                          <td>
                            #{r.request_number}
                            <small>
                              {displaySubscriptionDate(r.created_at, locale)}
                            </small>
                          </td>
                          <td>
                            <strong>{r.organization_name}</strong>
                            <small dir="ltr">{r.requester_email}</small>
                          </td>
                          <td>
                            {ar ? r.quote.name_ar : r.quote.name_en}
                            <small>
                              {money(
                                r.quote.price_amount,
                                r.quote.currency,
                                locale,
                              )}
                            </small>
                          </td>
                          <td>
                            <span className="plan-badge">
                              {requestLabel(r.status, ar)}
                            </span>
                          </td>
                          <td>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setSelected(r);
                                setError("");
                              }}
                            >
                              {ar ? "عرض الطلب" : "View request"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && (
                  <p>
                    {ar ? "لا توجد طلبات مطابقة." : "No matching requests."}
                  </p>
                )}
                <div className="console-actions">
                  <button
                    disabled={offset === 0 || busy}
                    onClick={() => setOffset((x) => Math.max(0, x - 50))}
                  >
                    {ar ? "السابق" : "Previous"}
                  </button>
                  <button
                    disabled={rows.length < 50 || busy}
                    onClick={() => setOffset((x) => x + 50)}
                  >
                    {ar ? "التالي" : "Next"}
                  </button>
                </div>
              </section>
              {paymentCard}
            </div>
            <aside className="console-detail">
              {selected ? (
                <section
                  className="console-card"
                  key={selected.id + selected.revision}
                >
                  <header className="console-heading">
                    <h3>
                      {ar ? "تفاصيل الطلب" : "Request details"} #
                      {selected.request_number}
                    </h3>
                    <span className="plan-badge">
                      {requestLabel(selected.status, ar)}
                    </span>
                  </header>
                  <h3>{selected.organization_name}</h3>
                  <p>{selected.requester_name}</p>
                  <p dir="ltr">
                    {selected.requester_email}
                    <br />
                    {selected.phone}
                  </p>
                  <div className="quote-strip">
                    <strong>
                      {ar ? selected.quote.name_ar : selected.quote.name_en}
                    </strong>
                    <span>
                      {money(
                        selected.quote.price_amount,
                        selected.quote.currency,
                        locale,
                      )}{" "}
                      ·{" "}
                      {selected.quote.billing_interval === "monthly"
                        ? ar
                          ? "شهري"
                          : "Monthly"
                        : ar
                          ? "سنوي"
                          : "Yearly"}
                    </span>
                    <span>
                      {selected.quote.max_users} {ar ? "مستخدمين" : "users"}
                    </span>
                  </div>
                  <p className="request-notes">
                    {selected.notes || (ar ? "لا توجد ملاحظات." : "No notes.")}
                  </p>
                  {selected.reason && <p>{selected.reason}</p>}
                  {openRequest(selected) && (
                    <form className="request-form" onSubmit={review}>
                      <label className="form-wide">
                        {ar
                          ? "تاريخ الانتهاء عند الموافقة — بتوقيت جهازك"
                          : "End date for approval — device timezone"}
                        <input name="until" type="datetime-local" />
                      </label>
                      <label className="form-wide">
                        {ar
                          ? "سبب القرار — يظهر للعميل"
                          : "Decision reason — visible to customer"}
                        <textarea
                          name="reason"
                          required
                          minLength={5}
                          maxLength={1000}
                          rows={3}
                        />
                      </label>
                      <p className="console-notice form-wide">
                        {ar
                          ? "الموافقة تفعّل السعر والمميزات المحفوظة في الطلب، ولا تسجل تحصيلاً مالياً. تغيير الباقة أو الاشتراك بعد إرسال الطلب يستلزم طلباً جديداً."
                          : "Approval activates the saved quote without recording payment. A changed plan or subscription requires a new request."}
                      </p>
                      <footer className="form-wide console-actions decision-actions">
                        <button
                          className="primary"
                          name="action"
                          value="approve"
                          disabled={busy}
                        >
                          {ar
                            ? "اعتماد وتفعيل يدوياً"
                            : "Approve and activate manually"}
                        </button>
                        <button
                          name="action"
                          value="needs_info"
                          disabled={busy}
                        >
                          {ar ? "طلب معلومات" : "Request information"}
                        </button>
                        <button
                          className="danger"
                          name="action"
                          value="reject"
                          disabled={busy}
                        >
                          {ar ? "رفض الطلب" : "Reject request"}
                        </button>
                        {selected.status === "pending" && (
                          <button name="action" value="review" disabled={busy}>
                            {ar ? "بدء المراجعة" : "Start review"}
                          </button>
                        )}
                      </footer>
                    </form>
                  )}
                </section>
              ) : (
                <section className="console-card">
                  <h3>
                    {ar
                      ? "اختر طلباً لعرض التفاصيل"
                      : "Select a request to see details"}
                  </h3>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
