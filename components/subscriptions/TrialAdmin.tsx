"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  displaySubscriptionDate,
  subscriptionLabel,
  type OrganizationSubscription,
} from "@/lib/subscriptions/model";
import "./subscriptions.css";
type Row = {
  id: string;
  name: string;
  owner_email: string;
  active_users: number;
  entitlement: OrganizationSubscription;
};
type Register = {
  rows: Row[];
  metrics: Record<string, number>;
  settings: { trial_days: number; revision: number };
  plans?: {
    id: string;
    name_ar: string;
    name_en?: string;
    is_active: boolean;
  }[];
};
export default function TrialAdmin({
  locale,
  plans,
}: {
  locale: string;
  plans: {
    id: string;
    name_ar: string;
    name_en?: string;
    is_active: boolean;
  }[];
}) {
  const ar = locale === "ar";
  const [register, setRegister] = useState<Register | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [audit, setAudit] = useState<unknown>(null),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "/api/admin/trials?" +
          new URLSearchParams({ search, status, offset: String(offset) }),
        { cache: "no-store" },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setRegister(b);
      setError("");
    } catch (e) {
      setRegister(null);
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    }
  }, [search, status, offset]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>, defaults = false) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form),
      action = defaults ? "defaults" : String(fields.get("action"));
    const body: Record<string, unknown> = {
      action,
      reason: fields.get("reason"),
      revision: defaults
        ? register?.settings.revision
        : selected?.entitlement.revision,
    };
    if (!defaults) body.organization_id = selected?.id;
    if (action === "defaults" || action === "extend")
      body.days = Number(fields.get("days"));
    if (action === "activate") {
      const until = String(fields.get("until"));
      if (!until) return;
      body.until = new Date(until).toISOString();
      body.plan_id = fields.get("plan_id");
      body.max_users = Number(fields.get("max_users"));
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/trials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setSelected(null);
      setAudit(null);
      setMessage(
        ar
          ? "تم حفظ التغيير وتسجيله في سجل التدقيق."
          : "Change saved and audited.",
      );
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  async function history(id: string) {
    setAudit(null);
    try {
      const r = await fetch("/api/admin/trials?audit=" + id, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setAudit(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    }
  }
  const currentPlans = register?.plans ?? plans;
  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    setBusy(true);
    try {
      const body = Object.fromEntries(fields);
      const r = await fetch("/api/admin/trials/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, price: Number(fields.get("price")) }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      form.reset();
      await load();
      setMessage(ar ? "تم إنشاء الخطة وتسجيلها." : "Plan created and audited.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    trial_total: ar ? "إجمالي المؤسسات التجريبية" : "Trial organizations",
    trialing: ar ? "التجارب النشطة" : "Active trials",
    expired: ar ? "التجارب المنتهية" : "Expired trials",
    converted: ar ? "تحولت إلى مدفوع" : "Converted to paid",
    ending_7: ar ? "تنتهي خلال 7 أيام" : "Ending within 7 days",
  };
  return (
    <section className="subscription-panel" dir={ar ? "rtl" : "ltr"}>
      <h2>
        {ar ? "الاشتراكات والفترات التجريبية" : "Subscriptions and free trials"}
      </h2>
      {error && (
        <p role="alert">
          {ar ? "تعذر إتمام الطلب: " : "Request failed: "}
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {register && (
        <>
          <div className="subscription-metrics">
            {Object.entries(labels).map(([key, label]) => (
              <article key={key}>
                {label}
                <strong>{register.metrics[key] ?? "—"}</strong>
              </article>
            ))}
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <label>
              {ar
                ? "البحث عن المؤسسة أو المسؤول"
                : "Search organization or owner"}
              <input
                value={search}
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
                <option value="">{ar ? "الجميع" : "All"}</option>
                {(
                  [
                    "trialing",
                    "active",
                    "expired",
                    "suspended",
                    "cancelled",
                    "legacy",
                    "unconfigured",
                  ] as const
                ).map((s) => (
                  <option value={s} key={s}>
                    {subscriptionLabel(s, ar)}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <div className="subscription-table-wrap">
            <table>
              <thead>
                <tr>
                  {(ar
                    ? [
                        "المؤسسة",
                        "المسؤول",
                        "الحالة",
                        "البداية",
                        "النهاية",
                        "الأيام المتبقية",
                        "المستخدمون",
                        "الخطة",
                        "الإجراءات",
                      ]
                    : [
                        "Organization",
                        "Owner",
                        "Status",
                        "Start",
                        "End",
                        "Days left",
                        "Users",
                        "Plan",
                        "Actions",
                      ]
                  ).map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {register.rows.map((row) => {
                  const s = row.entitlement;
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.owner_email}</td>
                      <td>{subscriptionLabel(s.status, ar)}</td>
                      <td>
                        {displaySubscriptionDate(
                          s.status === "active"
                            ? s.started_at
                            : s.trial_started_at,
                          locale,
                        )}
                      </td>
                      <td>
                        {displaySubscriptionDate(
                          s.status === "active"
                            ? s.current_period_end
                            : s.trial_ends_at,
                          locale,
                        )}
                      </td>
                      <td>{s.days_remaining ?? "—"}</td>
                      <td>
                        {row.active_users} / {s.max_users ?? "—"}
                      </td>
                      <td>
                        {currentPlans.find(
                          (p) =>
                            p.id ===
                            (
                              s as OrganizationSubscription & {
                                plan_id?: string;
                              }
                            ).plan_id,
                        )?.[ar ? "name_ar" : "name_en"] ?? "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={!s.id || busy}
                          onClick={() => {
                            setSelected(row);
                            setAudit(null);
                          }}
                        >
                          {ar ? "إدارة" : "Manage"}
                        </button>{" "}
                        <button type="button" onClick={() => history(row.id)}>
                          {ar ? "السجل" : "History"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!register.rows.length && (
              <p>{ar ? "لا توجد نتائج." : "No results."}</p>
            )}
          </div>
          <p>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((x) => Math.max(0, x - 50))}
            >
              {ar ? "السابق" : "Previous"}
            </button>{" "}
            <button
              type="button"
              disabled={register.rows.length < 50}
              onClick={() => setOffset((x) => x + 50)}
            >
              {ar ? "التالي" : "Next"}
            </button>
          </p>
          <details>
            <summary>
              {ar
                ? "إعداد التجربة للعملاء الجدد"
                : "Trial default for new organizations"}
            </summary>
            <p>
              {ar
                ? "تغيير المدة لا يغير التجارب الحالية."
                : "Changing this duration does not change existing trials."}
            </p>
            <form onSubmit={(e) => submit(e, true)}>
              <label>
                {ar ? "المدة بالأيام" : "Duration in days"}
                <input
                  name="days"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={register.settings.trial_days}
                  required
                />
              </label>
              <label>
                {ar ? "سبب التعديل" : "Reason"}
                <input name="reason" minLength={5} maxLength={1000} required />
              </label>
              <button disabled={busy}>
                {ar ? "حفظ المدة الافتراضية" : "Save default"}
              </button>
              <button type="button" onClick={() => history("settings")}>
                {ar ? "سجل الإعدادات" : "Settings history"}
              </button>
            </form>
          </details>
        </>
      )}
      <details>
        <summary>
          {ar
            ? "إعداد خطة للاشتراك اليدوي"
            : "Set up a plan for manual subscriptions"}
        </summary>
        <p>
          {ar
            ? "تعريف خطة لا يفعّل اشتراكات العملاء ولا ينفذ تحصيلاً مالياً."
            : "Creating a plan does not activate customer subscriptions or collect payments."}
        </p>
        <form onSubmit={createPlan}>
          <label>
            {ar ? "رمز الخطة" : "Plan code"}
            <input name="code" pattern="[a-z0-9_-]{2,40}" required />
          </label>
          <label>
            {ar ? "الاسم العربي" : "Arabic name"}
            <input name="name_ar" minLength={2} maxLength={120} required />
          </label>
          <label>
            {ar ? "الاسم الإنجليزي" : "English name"}
            <input name="name_en" minLength={2} maxLength={120} required />
          </label>
          <label>
            {ar ? "السعر المرجعي" : "Reference price"}
            <input
              name="price"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              required
            />
          </label>
          <label>
            {ar ? "العملة" : "Currency"}
            <input
              name="currency"
              pattern="[A-Z]{3}"
              defaultValue="SAR"
              required
            />
          </label>
          <label>
            {ar ? "الدورة" : "Interval"}
            <select name="interval">
              <option value="monthly">{ar ? "شهرية" : "Monthly"}</option>
              <option value="yearly">{ar ? "سنوية" : "Yearly"}</option>
            </select>
          </label>
          <label>
            {ar ? "السبب" : "Reason"}
            <input name="reason" minLength={5} maxLength={1000} required />
          </label>
          <button disabled={busy}>{ar ? "إنشاء الخطة" : "Create plan"}</button>
        </form>
      </details>
      {selected && (
        <section>
          <h3>{selected.name}</h3>
          <p>
            {ar
              ? "التفعيل اليدوي يغير صلاحية الاشتراك فقط، ولا يسجل دفعة أو ينفذ خصماً. تاريخ الانتهاء أدناه بتوقيت جهازك، ويحفظ بتوقيت UTC."
              : "Manual activation changes access only; it does not record a payment or charge a card. The end date uses your device timezone and is stored in UTC."}
          </p>
          <form onSubmit={submit}>
            <label>
              {ar ? "الإجراء" : "Action"}
              <select name="action" required>
                <option value="extend">
                  {ar ? "تمديد التجربة" : "Extend trial"}
                </option>
                <option value="activate">
                  {ar ? "تفعيل اشتراك يدوي" : "Activate manually"}
                </option>
                <option value="suspend">
                  {ar ? "تعليق الاشتراك" : "Suspend"}
                </option>
                <option value="resume">
                  {ar ? "رفع التعليق" : "Resume subscription"}
                </option>
              </select>
            </label>
            <label>
              {ar ? "أيام التمديد" : "Extension days"}
              <input
                name="days"
                type="number"
                min="1"
                max="365"
                defaultValue={7}
              />
            </label>
            <label>
              {ar ? "الخطة للتفعيل المدفوع" : "Plan for paid activation"}
              <select name="plan_id">
                <option value="">
                  {ar ? "اختر خطة مفعلة" : "Choose active plan"}
                </option>
                {currentPlans
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {ar ? p.name_ar : (p.name_en ?? p.name_ar)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {ar ? "انتهاء الاشتراك المدفوع" : "Paid subscription end"}
              <input name="until" type="datetime-local" />
            </label>
            <label>
              {ar ? "عدد المستخدمين للتفعيل المدفوع" : "Paid user limit"}
              <input
                name="max_users"
                type="number"
                min={selected.active_users}
                max={100000}
                defaultValue={Math.max(selected.active_users, 5)}
              />
            </label>
            <label>
              {ar ? "السبب الإداري" : "Administrative reason"}
              <textarea name="reason" minLength={5} maxLength={1000} required />
            </label>
            <button disabled={busy}>
              {ar ? "تنفيذ وحفظ في السجل" : "Apply and audit"}
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </button>
          </form>
        </section>
      )}
      {audit !== null && (
        <section>
          <h3>{ar ? "سجل التغييرات" : "Change history"}</h3>
          <pre>{JSON.stringify(audit, null, 2)}</pre>
        </section>
      )}
    </section>
  );
}
