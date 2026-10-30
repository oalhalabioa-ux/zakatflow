"use client";
import { useState, type FormEvent } from "react";
import { rememberOrganization } from "@/lib/workspace-organization";
import { rememberWorkspaceScope } from "@/lib/topbar-navigation";
import "./subscriptions.css";
export default function OrganizationOnboarding({ locale }: { locale: string }) {
  const ar = locale === "ar",
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = new FormData(e.currentTarget);
      const r = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.get("name"),
          base_currency: fields.get("currency"),
          entity_type: "BUSINESS",
          organization_kind: "HOLDING",
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      rememberOrganization(b.id);
      rememberWorkspaceScope("ORGANIZATION");
      location.assign(
        `/${locale}/dashboard?scope=ORGANIZATION&organization=${b.id}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "REQUEST_FAILED");
      setBusy(false);
    }
  }
  return (
    <main className="subscription-panel" dir={ar ? "rtl" : "ltr"}>
      <h1>
        {ar
          ? "أنشئ مؤسستك وابدأ تجربتك"
          : "Create your organization and start your trial"}
      </h1>
      <p>
        {ar
          ? "30 يوماً مجاناً، حتى 5 مستخدمين بمن فيهم المالك، وجميع الموديولات الأساسية. دون بطاقة أو خصم أو تجديد تلقائي."
          : "30 days free, up to 5 active users including the owner, and all core modules. No card, charge or automatic renewal."}
      </p>
      <p>
        {ar
          ? "بعد انتهاء التجربة تبقى بياناتك متاحة للقراءة والتصدير وفق صلاحياتك. إذا وصلتك دعوة، افتح رابطها للانضمام إلى المؤسسة القائمة."
          : "After the trial, your data stays available to read and export within your permissions. If you received an invitation, open its link to join the existing organization."}
      </p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={create}>
        <label>
          {ar ? "اسم المؤسسة" : "Organization name"}
          <input
            name="name"
            minLength={2}
            maxLength={150}
            autoComplete="organization"
            required
          />
        </label>
        <label>
          {ar ? "العملة الأساسية" : "Base currency"}
          <select name="currency" defaultValue="SAR">
            {[
              "SAR",
              "USD",
              "AED",
              "QAR",
              "KWD",
              "BHD",
              "OMR",
              "LBP",
              "SYP",
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button disabled={busy}>
          {ar
            ? "إنشاء المؤسسة وبدء التجربة"
            : "Create organization and start trial"}
        </button>
      </form>
    </main>
  );
}
