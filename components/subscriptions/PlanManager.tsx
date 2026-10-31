"use client";
import OwnerMetrics from "@/app/admin/OwnerMetrics";
import SubscriptionModal from "./SubscriptionModal";
import {OwnerActionIcon} from "./OwnerSubscriptionVisuals";
import { adminSubscriptionError } from "@/lib/subscriptions/admin-errors";
import { useState, type FormEvent } from "react";
import {
  MODULES,
  FEATURES,
  capabilityLabel,
  money,
  type Plan,
} from "@/lib/subscriptions/catalog";
export default function PlanManager({
  locale,
  plans,
  onSaved,
}: {
  locale: string;
  plans: Plan[];
  onSaved: () => Promise<void> | void;
}) {
  const ar = locale === "ar",
    [edit, setEdit] = useState<Plan | null>(null),
    [version, setVersion] = useState(0),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    const f = new FormData(event.currentTarget);
    const body = {
      ...Object.fromEntries(f),
      ...(edit ? { id: edit.id, revision: edit.revision } : {}),
      features: f.getAll("features"),
      price: Number(f.get("price")),
      max_users: Number(f.get("max_users")),
      is_active: f.has("is_active"),
      is_published: f.has("is_published"),
      is_proposed: f.has("is_proposed"),
    };
    try {
      const r = await fetch("/api/admin/trials/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setEdit(null);
      setOpen(false);
      setVersion((v) => v + 1);
      await onSaved();
      setMessage(
        ar
          ? "تم حفظ الباقة وتسجيل التغيير بنجاح."
          : "Plan saved and change audited.",
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
  return (
    <section className="plan-manager">
      <div className="owner-plan-heading">
        <h3>{ar ? "الباقات والتسعير" : "Plans and pricing"}</h3>
        <button
          className="primary"
          onClick={() => {
            setEdit(null);
            setError("");
            setOpen(true);
          }}
        >
          <OwnerActionIcon name="add"/> {ar ? "＋ إضافة باقة جديدة" : "＋ Add plan"}
        </button>
      </div>
      <OwnerMetrics
        locale={locale}
        items={[
          {
            label: ar ? "إجمالي الباقات" : "Catalog plans",
            value: plans.length,
            icon: "layers",
            note: ar
              ? "يشمل التجربة والباقات الخاصة"
              : "Includes trial and private plans",
          },
          {
            label: ar ? "باقات مفعّلة" : "Enabled plans",
            value: plans.filter((plan) => plan.is_active).length,
            icon: "card",
            tone: "success",
            note: ar
              ? "متاحة للإدارة بحسب إعدادات الباقة"
              : "Available according to plan settings",
          },
          {
            label: ar ? "باقات منشورة ومفعّلة" : "Published and enabled",
            value: plans.filter((plan) => plan.is_active && plan.is_published)
              .length,
            icon: "building",
            note: ar
              ? "تظهر ضمن دليل الباقات المتاحة"
              : "Visible in the available plan catalog",
          },
        ]}
      />
      {message && (
        <p className="owner-feedback" data-tone="success" role="status">
          {message}
        </p>
      )}
      <p>
        {ar
          ? "تغييرات الباقة تسري على التفعيلات القادمة. الاشتراكات القائمة تحتفظ بمميزاتها وسعرها المسجل، ويمكن تغيير باقتها بتفعيل إداري صريح. القراءة والتصدير والصلاحيات الأساسية محفوظة في جميع الباقات."
          : "Plan changes apply to future activations. Existing subscriptions retain their recorded capabilities and quote until explicitly reactivated by the owner. Reading, export and basic permissions remain available."}
      </p>
      <div className="subscription-table-wrap">
        <table>
          <thead>
            <tr>
              {(ar
                ? [
                    "الباقة",
                    "السعر",
                    "المستخدمون",
                    "النشر",
                    "الموديولات والمميزات",
                    "الإدارة",
                  ]
                : [
                    "Plan",
                    "Price",
                    "Users",
                    "Visibility",
                    "Modules and features",
                    "Manage",
                  ]
              ).map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans
              .filter((p) => p.code !== "trial_30d")
              .map((p) => (
                <tr key={p.id}>
                  <td data-label={ar ? "الباقة" : "Plan"}>
                    {ar ? p.name_ar : p.name_en}
                  </td>
                  <td data-label={ar ? "السعر" : "Price"}>
                    {money(p.price_amount, p.currency, locale)} /{" "}
                    {p.billing_interval === "monthly"
                      ? ar
                        ? "شهر"
                        : "month"
                      : ar
                        ? "سنة"
                        : "year"}
                  </td>
                  <td data-label={ar ? "المستخدمون" : "Users"}>
                    {p.max_users ?? "—"}
                  </td>
                  <td data-label={ar ? "النشر" : "Visibility"}>
                    {p.is_published && p.is_active
                      ? ar
                        ? "منشورة"
                        : "Published"
                      : ar
                        ? "خاصة / غير مفعلة"
                        : "Private / inactive"}
                    {p.is_proposed && (ar ? " · مقترحة" : " · Proposed")}
                  </td>
                  <td data-label={ar ? "المميزات" : "Features"}>
                    {p.features.map((k) => capabilityLabel(k, ar)).join("، ")}
                  </td>
                  <td data-label={ar ? "الإدارة" : "Manage"}>
                    <button
                      onClick={() => {
                        setEdit(p);
                        setOpen(true);
                        setError("");
                      }}
                    >
                      <OwnerActionIcon name="edit"/> {ar ? "تعديل" : "Edit"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {open && (
        <SubscriptionModal
          className="owner-plan-modal"
          title={
            edit
              ? ar
                ? "تعديل الباقة"
                : "Edit plan"
              : ar
                ? "إضافة باقة جديدة"
                : "Add plan"
          }
          onClose={() => setOpen(false)}
          busy={busy}
        >
          <form key={`${edit?.id ?? "new"}-${version}`} onSubmit={save}>
            <fieldset disabled={busy} className="plan-editor">
              <legend>{ar ? "تعريف الباقة" : "Plan definition"}</legend>
              <div className="owner-plan-grid">
                <section
                  className="owner-plan-information"
                  aria-labelledby="plan-information-title"
                >
                  <h3 id="plan-information-title">
                    {ar
                      ? "معلومات الباقة والتسعير"
                      : "Plan information and pricing"}
                  </h3>
                  <div className="owner-plan-fields">
                    <label>
                      {ar ? "الاسم العربي" : "Arabic name"}
                      <input
                        name="name_ar"
                        minLength={2}
                        maxLength={120}
                        defaultValue={edit?.name_ar}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "الاسم الإنجليزي" : "English name"}
                      <input
                        name="name_en"
                        minLength={2}
                        maxLength={120}
                        defaultValue={edit?.name_en}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "السعر للدورة كاملة" : "Full interval price"}
                      <input
                        name="price"
                        type="number"
                        min="0"
                        max="100000000"
                        step="0.01"
                        defaultValue={edit?.price_amount}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "العملة" : "Currency"}
                      <input
                        name="currency"
                        pattern="[A-Z]{3}"
                        defaultValue={edit?.currency ?? "SAR"}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "الدورة" : "Interval"}
                      <select
                        name="interval"
                        defaultValue={edit?.billing_interval ?? "monthly"}
                      >
                        <option value="monthly">
                          {ar ? "شهرية" : "Monthly"}
                        </option>
                        <option value="yearly">
                          {ar ? "سنوية" : "Yearly"}
                        </option>
                      </select>
                    </label>
                    <label>
                      {ar ? "حد المستخدمين النشطين" : "Active user limit"}
                      <input
                        name="max_users"
                        type="number"
                        min="1"
                        max="100000"
                        defaultValue={edit?.max_users ?? 5}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "رمز الباقة الثابت" : "Immutable code"}
                      <input
                        name="code"
                        pattern="[a-z0-9_-]{2,40}"
                        defaultValue={edit?.code}
                        readOnly={!!edit}
                        required
                      />
                    </label>
                    <label>
                      {ar
                        ? "مجموعة الباقة (للشهري والسنوي)"
                        : "Plan family (monthly/yearly)"}
                      <input
                        name="family"
                        pattern="[a-z0-9_-]{2,40}"
                        defaultValue={edit?.family ?? "custom"}
                        required
                      />
                    </label>
                    <label>
                      {ar ? "الوصف العربي" : "Arabic description"}
                      <textarea
                        name="description_ar"
                        maxLength={500}
                        defaultValue={edit?.description_ar}
                      />
                    </label>
                    <label>
                      {ar ? "الوصف الإنجليزي" : "English description"}
                      <textarea
                        name="description_en"
                        maxLength={500}
                        defaultValue={edit?.description_en}
                      />
                    </label>
                  </div>
                </section>
                <section
                  className="owner-plan-options"
                  aria-labelledby="plan-options-title"
                >
                  <h3 id="plan-options-title">
                    {ar
                      ? "الموديولات والمميزات المتاحة"
                      : "Available modules and features"}
                  </h3>
                  <p>
                    {ar
                      ? "القراءة والتصدير محفوظان. حدد إمكانات الكتابة التي تشملها الباقة."
                      : "Reading and export remain available. Select the writing capabilities included in this plan."}
                  </p>
                  <fieldset className="plan-capabilities">
                    <legend>
                      {ar
                        ? "الموديولات والمميزات المتاحة للكتابة"
                        : "Modules and features available for writing"}
                    </legend>
                    {MODULES.map((m) => (
                      <label key={m.key} className="plan-check">
                        <input
                          type="checkbox"
                          name="features"
                          value={"module:" + m.key}
                          defaultChecked={
                            edit
                              ? edit.features.includes("core") ||
                                edit.features.includes("module:" + m.key)
                              : true
                          }
                          disabled={m.core}
                        />
                        {m.core && (
                          <input
                            type="hidden"
                            name="features"
                            value={"module:" + m.key}
                          />
                        )}
                        <span>
                          {ar ? m.ar : m.en}
                          {m.core &&
                            (ar ? " · أساس مشترك" : " · Shared foundation")}
                        </span>
                      </label>
                    ))}
                    {FEATURES.map((m) => (
                      <label className="plan-check" key={m.key}>
                        <input
                          type="checkbox"
                          name="features"
                          value={"feature:" + m.key}
                          defaultChecked={
                            edit
                              ? edit.features.includes("core") ||
                                edit.features.includes("feature:" + m.key)
                              : false
                          }
                        />
                        {ar ? m.ar : m.en}
                      </label>
                    ))}
                  </fieldset>
                </section>
              </div>
              <div className="owner-plan-publication">
                {(["is_active", "is_published", "is_proposed"] as const).map(
                  (k, i) => (
                    <label className="plan-check" key={k}>
                      <input
                        type="checkbox"
                        name={k}
                        defaultChecked={edit ? edit[k] : k !== "is_published"}
                      />
                      {
                        (ar
                          ? [
                              "مفعلة للتفعيل اليدوي",
                              "منشورة للمستخدمين",
                              "السعر مقترح",
                            ]
                          : [
                              "Available for activation",
                              "Published to users",
                              "Proposed price",
                            ])[i]
                      }
                    </label>
                  ),
                )}
              </div>
              <label>
                {ar ? "سبب التغيير" : "Reason"}
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={1000}
                  required
                />
              </label>
              <div className="owner-plan-actions">
                <button className="primary" disabled={busy}>
                  <OwnerActionIcon name="save"/> {busy
                    ? ar
                      ? "جارٍ الحفظ…"
                      : "Saving…"
                    : ar
                      ? "حفظ وتسجيل التغيير"
                      : "Save and audit"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setEdit(null);
                    setVersion((v) => v + 1);
                  }}
                >
                  <OwnerActionIcon name="cancel"/> {ar ? "إلغاء" : "Cancel"}
                </button>
              </div>
              {error && (
                <p className="owner-feedback" data-tone="error" role="alert">
                  {error}
                </p>
              )}
            </fieldset>
          </form>
        </SubscriptionModal>
      )}
    </section>
  );
}
