"use client";
import { useState, type FormEvent } from "react";
import type { Plan } from "@/lib/subscriptions/catalog";
import { money } from "@/lib/subscriptions/catalog";
import SubscriptionModal from "./SubscriptionModal";
export default function ActivationRequestForm({
  plan,
  organizationId,
  organizationName,
  locale,
  name,
  email,
  onClose,
  onSaved,
}: {
  plan: Plan;
  organizationId: string;
  organizationName: string;
  locale: string;
  name: string;
  email: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ar = locale === "ar";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/subscriptions/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          organization_id: organizationId,
          plan_id: plan.id,
          phone: f.get("phone"),
          notes: f.get("notes"),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      onSaved();
    } catch (e) {
      setError(
        ar
          ? "تعذر إرسال الطلب. قد يوجد طلب مفتوح أو تغيرت الباقة. حدّث الصفحة وأعد المحاولة."
          : e instanceof Error
            ? e.message
            : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SubscriptionModal
      title={ar ? "طلب تفعيل باقة" : "Request plan activation"}
      onClose={onClose}
      busy={busy}
    >
      <p className="console-muted">
        {ar
          ? "أرسل طلبك إلى إدارة يقين الأعمال للمراجعة والتفعيل اليدوي."
          : "Send your request to Yaqeen Business for review and manual activation."}
      </p>
      <div className="quote-strip">
        <strong>{ar ? plan.name_ar : plan.name_en}</strong>
        <span>
          {money(plan.price_amount, plan.currency, locale)} /{" "}
          {plan.billing_interval === "monthly"
            ? ar
              ? "شهر"
              : "month"
            : ar
              ? "سنة"
              : "year"}
        </span>
        <span>
          {plan.max_users} {ar ? "مستخدمين" : "users"}
        </span>
      </div>
      <form className="request-form" onSubmit={submit}>
        <label>
          {ar ? "المؤسسة" : "Organization"}
          <input value={organizationName} readOnly />
        </label>
        <label>
          {ar ? "الباقة المختارة" : "Selected plan"}
          <input value={ar ? plan.name_ar : plan.name_en} readOnly />
        </label>
        <label>
          {ar ? "دورة الاشتراك" : "Billing interval"}
          <input
            readOnly
            value={
              plan.billing_interval === "monthly"
                ? ar
                  ? "شهري"
                  : "Monthly"
                : ar
                  ? "سنوي"
                  : "Yearly"
            }
          />
        </label>
        <label>
          {ar ? "العملة" : "Currency"}
          <input value={plan.currency} readOnly />
        </label>
        <label>
          {ar ? "مقدم الطلب" : "Applicant"}
          <input value={name || email} readOnly />
        </label>
        <label>
          {ar ? "البريد الإلكتروني" : "Email"}
          <input dir="ltr" value={email} readOnly />
        </label>
        <label className="form-wide">
          {ar ? "رقم التواصل" : "Contact phone"}
          <input
            name="phone"
            type="tel"
            dir="ltr"
            maxLength={50}
            autoComplete="tel"
          />
        </label>
        <label className="form-wide">
          {ar ? "ملاحظات الطلب" : "Request notes"}
          <textarea name="notes" maxLength={2000} rows={3} />
        </label>
        <fieldset className="form-wide payment-choices">
          <legend>{ar ? "طريقة التفعيل" : "Activation method"}</legend>
          <label>
            <input type="radio" checked readOnly />
            {ar
              ? "تفعيل يدوي عبر إدارة المنصة"
              : "Manual activation by platform administration"}
          </label>
          <label>
            <input type="radio" disabled />
            {ar
              ? "الدفع بالبطاقة — غير متاح حالياً"
              : "Card payment — temporarily unavailable"}
          </label>
        </fieldset>
        <div className="form-wide quote-total">
          <span>
            {ar
              ? "قيمة الباقة قبل الضرائب"
              : "Plan price before applicable taxes"}
          </span>
          <strong>{money(plan.price_amount, plan.currency, locale)}</strong>
        </div>
        <p className="form-wide console-notice">
          {ar
            ? "إرسال الطلب لا يفعّل الباقة ولا يسجل عملية دفع. لا خصم ولا تجديد تلقائي. تبقى صلاحياتك الحالية حتى موافقة الإدارة."
            : "Submitting does not activate the plan or record payment. No automatic charge or renewal. Existing access remains until approval."}
        </p>
        {error && (
          <p role="alert" className="form-wide">
            {error}
          </p>
        )}
        <footer className="form-wide console-actions">
          <button className="primary" disabled={busy}>
            {busy
              ? ar
                ? "جارٍ الإرسال…"
                : "Sending…"
              : ar
                ? "إرسال طلب التفعيل"
                : "Send activation request"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            {ar ? "إلغاء" : "Cancel"}
          </button>
        </footer>
      </form>
    </SubscriptionModal>
  );
}
