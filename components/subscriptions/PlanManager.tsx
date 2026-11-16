"use client";
import OwnerMetrics from "@/app/admin/OwnerMetrics";
import SubscriptionModal from "./SubscriptionModal";
import PlanEditor from "./PlanEditor";
import {OwnerActionIcon} from "./OwnerSubscriptionVisuals";
import { adminSubscriptionError } from "@/lib/subscriptions/admin-errors";
import { useState, type FormEvent } from "react";
import {
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
          <PlanEditor key={`${edit?.id ?? "new"}-${version}`} plan={edit} locale={locale} busy={busy} error={error} onSave={save} onCancel={() => {setOpen(false);setEdit(null);setVersion(v=>v+1);}} />
        </SubscriptionModal>
      )}
    </section>
  );
}
