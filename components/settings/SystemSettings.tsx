"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { vatProfileSchema } from "@/lib/validation/schemas";
import { VatEInvoiceSetup } from "@/components/vat-einvoice-setup";
import SubscriptionModal from "@/components/subscriptions/SubscriptionModal";
import "@/components/subscriptions/subscriptions.css";
type Profile = {
  registration_status: string;
  tax_registration_number?: string | null;
  registered_name?: string | null;
  [key: string]: unknown;
};
const addressFields = [
  ["seller_street", "الشارع", "Street"],
  ["seller_building_number", "رقم المبنى", "Building number"],
  ["seller_district", "الحي", "District"],
  ["seller_additional_number", "الرقم الإضافي", "Additional number"],
  ["seller_city", "المدينة", "City"],
  ["seller_postal_code", "الرمز البريدي", "Postal code"],
];
export default function SystemSettings({
  id,
  name,
  currency,
  locale,
}: {
  id: string;
  name: string;
  currency: string;
  locale: string;
}) {
  const ar = locale === "ar",
    [profile, setProfile] = useState<Profile | null>(null),
    [editable, setEditable] = useState(false),
    [tab, setTab] = useState("registration"),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/vat/settings?organization_id=" + id, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((b) => {
        setProfile(b.profile);
        setEditable(b.can_edit);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            ar
              ? "تعذر تحميل إعدادات الفوترة."
              : "Unable to load invoicing settings.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [id, ar]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget),
      draft: Record<string, unknown> = {
        organization_id: id,
        registration_status: f.get("registration_status"),
        filing_frequency: f.get("filing_frequency"),
        period_start_month: Number(f.get("period_start_month")),
        standard_rate: 15,
      };
    for (const key of [
      "tax_registration_number",
      "registration_date",
      "registered_name",
      ...addressFields.map((x) => x[0]),
    ])
      draft[key] = String(f.get(key) || "").trim() || null;
    const parsed = vatProfileSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        ar
          ? "تحقق من الرقم الضريبي (15 رقماً يبدأ وينتهي بـ3) وبيانات العنوان الوطني."
          : "Check the VAT number (15 digits starting and ending in 3) and national address.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/vat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_profile", ...parsed.data }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setProfile(parsed.data);
      setMessage(ar ? "تم حفظ إعدادات الفوترة." : "Invoicing settings saved.");
      setOpen(false);
    } catch {
      setError(
        ar
          ? "تعذر الحفظ. تحقق من صلاحياتك وحالة الاشتراك."
          : "Unable to save. Check permissions and subscription status.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="system-settings subscription-panel">
      <div className="system-card-grid">
        <article className="console-card">
          <span className="system-card-icon" aria-hidden>
            ▣
          </span>
          <h3>{ar ? "الفوترة الإلكترونية وزاتكا" : "E-invoicing & ZATCA"}</h3>
          <p>
            {ar
              ? "إدارة التسجيل الضريبي والعنوان ووحدة الفوترة من نافذة واحدة."
              : "Manage tax registration, address and invoice unit in one place."}
          </p>
          <button
            disabled={loading || !!error}
            onClick={() => {
              setTab("registration");
              setOpen(true);
            }}
          >
            {ar ? "إعداد الفوترة" : "Configure invoicing"}
          </button>
        </article>
        <article className="console-card">
          <span className="system-card-icon" aria-hidden>
            ✓
          </span>
          <h3>{ar ? "التسجيل الضريبي" : "Tax registration"}</h3>
          <p>
            {loading
              ? ar
                ? "جارٍ التحميل…"
                : "Loading…"
              : profile?.registration_status === "REGISTERED"
                ? ar
                  ? "مسجل"
                  : "Registered"
                : ar
                  ? "غير مسجل أو غير مكتمل"
                  : "Unregistered or incomplete"}
          </p>
          <p dir="ltr">{profile?.tax_registration_number || "—"}</p>
          <button
            disabled={loading || !!error}
            onClick={() => {
              setTab("registration");
              setOpen(true);
            }}
          >
            {ar ? "عرض وتعديل البيانات" : "View and edit"}
          </button>
        </article>
        <article className="console-card">
          <span className="system-card-icon" aria-hidden>
            ▦
          </span>
          <h3>{ar ? "هوية المؤسسة" : "Organization identity"}</h3>
          <p>{name}</p>
          <Link href={`/${locale}/settings?organization=${id}`}>
            {ar ? "إدارة بيانات المؤسسة" : "Manage organization details"}
          </Link>
        </article>
        <article className="console-card">
          <span className="system-card-icon" aria-hidden>
            ◈
          </span>
          <h3>{ar ? "العملة الأساسية" : "Base currency"}</h3>
          <strong>{currency}</strong>
          <p>
            {ar
              ? "العملة المعتمدة لعمليات المؤسسة وتقاريرها."
              : "The currency used for organization transactions and reporting."}
          </p>
        </article>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {open && (
        <SubscriptionModal
          title={
            ar
              ? "إعدادات الفوترة الإلكترونية وزاتكا"
              : "E-invoicing & ZATCA settings"
          }
          onClose={() => {
            setOpen(false);
            setError("");
          }}
          busy={busy}
        >
          <nav className="console-tabs">
            {[
              ["registration", ar ? "التسجيل الضريبي" : "Registration"],
              ["address", ar ? "العنوان الوطني" : "National address"],
              ["unit", ar ? "وحدة الفوترة" : "Invoice unit"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {error && <p role="alert">{error}</p>}
          {tab === "unit" ? (
            <VatEInvoiceSetup
              organizationId={id}
              organizationName={name}
              vatNumber={profile?.tax_registration_number || ""}
              registered={profile?.registration_status === "REGISTERED"}
              ar={ar}
              onEditRegistration={() => setTab("registration")}
            />
          ) : (
            <form className="request-form" onSubmit={save}>
              <fieldset
                disabled={!editable || busy}
                className="vat-profile-fields"
              >
                <div className="request-form" hidden={tab !== "registration"}>
                  <label>
                    {ar ? "حالة التسجيل" : "Registration status"}
                    <select
                      name="registration_status"
                      defaultValue={
                        profile?.registration_status || "NOT_REGISTERED"
                      }
                    >
                      {[
                        ["NOT_REGISTERED", "غير مسجل", "Not registered"],
                        ["REGISTERED", "مسجل", "Registered"],
                        ["PENDING", "قيد التسجيل", "Pending"],
                        ["DEREGISTERED", "ملغى", "Deregistered"],
                      ].map(([v, a, en]) => (
                        <option key={v} value={v}>
                          {ar ? a : en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {ar ? "الرقم الضريبي" : "VAT number"}
                    <input
                      name="tax_registration_number"
                      defaultValue={String(
                        profile?.tax_registration_number || "",
                      )}
                      maxLength={15}
                      inputMode="numeric"
                      dir="ltr"
                    />
                  </label>
                  <label>
                    {ar ? "الاسم المسجل" : "Registered name"}
                    <input
                      name="registered_name"
                      defaultValue={String(profile?.registered_name || name)}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    {ar ? "تاريخ التسجيل" : "Registration date"}
                    <input
                      type="date"
                      name="registration_date"
                      defaultValue={String(profile?.registration_date || "")}
                    />
                  </label>
                  <label>
                    {ar ? "دورية الإقرار" : "Filing frequency"}
                    <select
                      name="filing_frequency"
                      defaultValue={String(
                        profile?.filing_frequency || "QUARTERLY",
                      )}
                    >
                      <option value="MONTHLY">{ar ? "شهري" : "Monthly"}</option>
                      <option value="QUARTERLY">
                        {ar ? "ربع سنوي" : "Quarterly"}
                      </option>
                    </select>
                  </label>
                  <label>
                    {ar
                      ? "شهر بداية السنة الضريبية"
                      : "Tax year starting month"}
                    <input
                      type="number"
                      name="period_start_month"
                      min={1}
                      max={12}
                      defaultValue={Number(profile?.period_start_month || 1)}
                    />
                  </label>
                </div>
                <div className="request-form" hidden={tab !== "address"}>
                  {addressFields.map(([key, a, en]) => (
                    <label key={key}>
                      {ar ? a : en}
                      <input
                        name={key}
                        defaultValue={String(profile?.[key] || "")}
                        maxLength={
                          key === "seller_postal_code"
                            ? 5
                            : key.includes("number")
                              ? 4
                              : 250
                        }
                        dir={
                          key.includes("number") || key === "seller_postal_code"
                            ? "ltr"
                            : undefined
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="form-wide console-notice">
                {ar
                  ? "عند التسجيل يجب إكمال الرقم الضريبي والعنوان الوطني. البيانات تستخدم سجل الفوترة الحالي للمؤسسة."
                  : "Registered businesses must complete their VAT number and national address. Uses the existing organization invoicing record."}
              </p>
              <footer className="form-wide console-actions">
                <button className="primary" disabled={!editable || busy}>
                  {ar ? "حفظ الإعدادات" : "Save settings"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTab(tab === "registration" ? "address" : "registration")
                  }
                >
                  {tab === "registration"
                    ? ar
                      ? "العنوان الوطني"
                      : "National address"
                    : ar
                      ? "التسجيل الضريبي"
                      : "Registration"}
                </button>
              </footer>
            </form>
          )}
        </SubscriptionModal>
      )}
    </section>
  );
}
