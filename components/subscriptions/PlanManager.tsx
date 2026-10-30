"use client";
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
  onSaved: () => Promise<void>;
}) {
  const ar = locale === "ar",
    [edit, setEdit] = useState<Plan | null>(null),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
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
      setVersion((v) => v + 1);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="plan-manager">
      <h3>{ar ? "الباقات والتسعير" : "Plans and pricing"}</h3>
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
                  <td>{ar ? p.name_ar : p.name_en}</td>
                  <td>
                    {money(p.price_amount, p.currency, locale)} /{" "}
                    {p.billing_interval === "monthly"
                      ? ar
                        ? "شهر"
                        : "month"
                      : ar
                        ? "سنة"
                        : "year"}
                  </td>
                  <td>{p.max_users ?? "—"}</td>
                  <td>
                    {p.is_published && p.is_active
                      ? ar
                        ? "منشورة"
                        : "Published"
                      : ar
                        ? "خاصة / غير مفعلة"
                        : "Private / inactive"}
                    {p.is_proposed && (ar ? " · مقترحة" : " · Proposed")}
                  </td>
                  <td>
                    {p.features.map((k) => capabilityLabel(k, ar)).join("، ")}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setEdit(p);
                        setError("");
                      }}
                    >
                      {ar ? "تعديل" : "Edit"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <details open={edit ? true : undefined}>
        <summary>
          {edit
            ? ar
              ? "تعديل الباقة"
              : "Edit plan"
            : ar
              ? "تفصيل باقة جديدة"
              : "Create a custom plan"}
        </summary>
        <form key={`${edit?.id ?? "new"}-${version}`} onSubmit={save}>
          <fieldset disabled={busy} className="plan-editor">
            <legend>{ar ? "تعريف الباقة" : "Plan definition"}</legend>
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
                <option value="monthly">{ar ? "شهرية" : "Monthly"}</option>
                <option value="yearly">{ar ? "سنوية" : "Yearly"}</option>
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
                    {m.core && (ar ? " · أساس مشترك" : " · Shared foundation")}
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
            <div>
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
              <textarea name="reason" minLength={5} maxLength={1000} required />
            </label>
            <div>
              <button disabled={busy}>
                {ar ? "حفظ وتسجيل التغيير" : "Save and audit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEdit(null);
                  setVersion((v) => v + 1);
                }}
              >
                {ar ? "باقة جديدة" : "New plan"}
              </button>
            </div>
            {error && (
              <p role="alert">
                {error === "PLAN_CONFLICT"
                  ? ar
                    ? "تغيرت الباقة. حدّث الصفحة قبل إعادة المحاولة."
                    : "The plan changed. Refresh before retrying."
                  : error}
              </p>
            )}
          </fieldset>
        </form>
      </details>
    </section>
  );
}
