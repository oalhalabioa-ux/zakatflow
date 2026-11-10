"use client";
import { useState, type FormEvent } from "react";
import type { ActivationRequest } from "@/lib/subscriptions/requests";
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
  request,
  choices,
  onPlanChange,
}: {
  plan: Plan | ActivationRequest["quote"] | null;
  request?: ActivationRequest;
  organizationId: string;
  organizationName: string;
  locale: string;
  name: string;
  email: string;
  onClose: () => void;
  onSaved: () => void;
  choices?: Plan[];
  onPlanChange?: (id: string) => void;
}) {
  const ar = locale === "ar";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !plan) return;
    const f = new FormData(e.currentTarget);
    const phone = String(f.get("phone") ?? "").trim();
    if (choices && !phone) {
      setError(ar ? "أدخل رقم التواصل." : "Enter a contact phone.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/subscriptions/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: request ? "resubmit" : "submit",
          organization_id: organizationId,
          ...(request
            ? { request_id: request.id, revision: request.revision }
            : { plan_id: plan.id }),
          phone,
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
  if (choices) return (
    <section className="yb-billing-panel billing-activation" aria-label={ar ? "طلب تفعيل الاشتراك" : "Request subscription activation"}>
      <h2>{ar ? "طلب تفعيل الاشتراك" : "Request subscription activation"}</h2>
      <form className="billing-activation-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>{ar ? "الباقة المطلوبة" : "Requested plan"}
            <select required value={plan?.id ?? ""} onChange={e => onPlanChange?.(e.target.value)}>
              <option value="">{ar ? "اختر الباقة" : "Select a plan"}</option>
              {choices.map(p => <option key={p.id} value={p.id}>{ar ? p.name_ar : p.name_en}</option>)}
            </select>
          </label>
          <label>{ar ? "اسم المسؤول" : "Applicant name"}<input readOnly value={name || email} /></label>
          <label>{ar ? "البريد الإلكتروني" : "Email"}<input readOnly dir="ltr" value={email} /></label>
          <label>{ar ? "رقم التواصل" : "Contact phone"}<input name="phone" type="tel" required maxLength={50} dir="ltr" autoComplete="tel" /></label>
          <label className="billing-wide">{ar ? "ملاحظات الطلب" : "Request notes"}<textarea name="notes" rows={3} maxLength={2000} /></label>
          <label className="billing-wide billing-review"><input type="checkbox" required key={plan?.id ?? ""} />{ar ? "أقرّ بمراجعة تفاصيل الباقة" : "I have reviewed the plan details"}</label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer className="billing-form-actions">
          <p className="yb-notice">{ar ? "لا تُطلب بطاقة لإرسال طلب التفعيل." : "No card is required to request activation."}</p>
          <button className="billing-primary" disabled={busy}>{busy ? (ar ? "جارٍ الإرسال…" : "Sending…") : (ar ? "إرسال طلب التفعيل" : "Send activation request")}</button>
          <button type="button" disabled={busy} onClick={e => { e.currentTarget.form?.reset(); setError(""); onClose(); }}>{ar ? "إلغاء" : "Cancel"}</button>
        </footer>
      </form>
    </section>
  );
  if (!plan) return null;
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
            defaultValue={request?.phone}
            type="tel"
            dir="ltr"
            maxLength={50}
            autoComplete="tel"
          />
        </label>
        <label className="form-wide">
          {ar ? "ملاحظات الطلب" : "Request notes"}
          <textarea
            name="notes"
            defaultValue={request?.notes}
            maxLength={2000}
            rows={3}
          />
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
