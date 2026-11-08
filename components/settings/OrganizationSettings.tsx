"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SystemSettings from "./SystemSettings";
import OrganizationSubnav from "./OrganizationSubnav";
import TopbarOrganizationControls from "../TopbarOrganizationControls";
import WorkspaceOrganizationPicker from "../WorkspaceOrganizationPicker";
import FiscalYearManagement from "./FiscalYearManagement";
import {
  rememberedOrganization,
  preferredOrganization,
} from "@/lib/workspace-organization";
import {COUNTRY_CODES,countryName} from '@/lib/countries';
import type { Organization } from "@/services/organizations";
import { supabaseBrowser } from "@/lib/supabase/browser";
export default function OrganizationSettings({
  locale,
  system = false,
  financial,
  preferredOrg,
  inline = false,
  identityOnly = false,
  onSaved,
}: {
  locale: string;
  system?: boolean;
  financial?: "overview" | "years";
  preferredOrg?: string; inline?: boolean; identityOnly?: boolean; onSaved?:()=>void;
}) {
  const ar = locale === "ar",
    [items, setItems] = useState<Organization[]>([]),
    [id, setId] = useState(""),
    [owner, setOwner] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState({ name: "", legal_name: "", country_code: "", commercial_registration_number: "", registered_address: "", activity: "", contact_email: "", contact_phone: "", registered_city: "", registered_region: "", registered_postal_code: "", registration_authority: "", registration_expires_on: "" });
  const generation = useRef(0);
  const fiscalEdit = useRef({ dirty: false, busy: false });
  const reportFiscalEdit = useRef((dirty: boolean, busy: boolean) => { fiscalEdit.current = { dirty, busy }; }).current;
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [r, a] = await Promise.all([
          fetch("/api/organizations", { cache: "no-store" }),
          supabaseBrowser().auth.getUser(),
        ]);
        if (!r.ok) throw Error();
        const rows = (await r.json()) as Organization[];
        if (!live) return;
        setItems(rows);
        setOwner(a.data.user?.id ?? "");
        const explicit = preferredOrg || new URLSearchParams(location.search).get(
          "organization",
        );
        if (explicit && !rows.some((o) => o.id === explicit)) {
          setError(
            ar
              ? "المؤسسة المطلوبة غير متاحة لحسابك."
              : "The requested organization is not available to your account.",
          );
          return;
        }
        const requested = explicit ?? rememberedOrganization();
        setId(preferredOrganization(rows, requested)?.id ?? "");
      } catch {
        if (live)
          setError(
            ar
              ? "تعذر تحميل المؤسسات. أعد المحاولة."
              : "Unable to load organizations. Please retry.",
          );
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [ar, preferredOrg]);
  useEffect(() => {
    const read = () => {
      const selected =
        preferredOrg ?? new URLSearchParams(location.search).get("organization") ??
        rememberedOrganization();
      if (items.some((o) => o.id === selected)) setId(selected!);
    };
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [items,preferredOrg]);
  const selected = items.find((o) => o.id === id),
    canEdit = !!selected && selected.owner_user_id === owner;
  useEffect(() => {
    generation.current++;
    setDraft({
      name: selected?.name ?? "",
      legal_name: selected?.legal_name ?? "",
      country_code: selected?.country_code ?? "",
      commercial_registration_number: selected?.commercial_registration_number ?? "",
      registered_address: selected?.registered_address ?? "",
      activity: selected?.activity ?? "",
      contact_email: selected?.contact_email ?? "",
      contact_phone: selected?.contact_phone ?? "",
      registered_city: selected?.registered_city ?? "",
      registered_region: selected?.registered_region ?? "",
      registered_postal_code: selected?.registered_postal_code ?? "",
      registration_authority: selected?.registration_authority ?? "",
      registration_expires_on: selected?.registration_expires_on ?? "",

    });
    setMessage("");
    setError("");
  }, [id]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !canEdit || busy) return;
    const version = generation.current,
      target = selected.id;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: target,
          name: draft.name.trim(),
          legal_name: draft.legal_name.trim(),
          country_code: draft.country_code.trim().toUpperCase(),
          commercial_registration_number: draft.commercial_registration_number.trim(),
          registered_address: draft.registered_address.trim(),
          activity: draft.activity.trim(),
          contact_email: draft.contact_email.trim(),
          contact_phone: draft.contact_phone.trim(),
          registered_city: draft.registered_city.trim(),
          registered_region: draft.registered_region.trim(),
          registered_postal_code: draft.registered_postal_code.trim(),
          registration_authority: draft.registration_authority.trim(),
          registration_expires_on: draft.registration_expires_on.trim(),

        }),
      });
      if (!r.ok) throw Error();
      const updated = await r.json();
      setItems((current) =>
        current.map((o) => (o.id === target ? updated : o)),
      );
      if (version === generation.current &&
          window.parent !== window &&
          new URLSearchParams(window.location.search).get("setupEmbed") === "1") {
        window.parent.postMessage(
          { type: "yaqeen:setup-source-saved", organizationId: target },
          window.location.origin,
        );
      }
      if (version === generation.current) {
        onSaved?.();
        setMessage(
          ar ? "تم حفظ بيانات المؤسسة." : "Organization details saved.",
        );
      }
    } catch {
      if (version === generation.current)
        setError(
          ar
            ? "تعذر الحفظ. تحقق من صلاحياتك وحالة اشتراك المؤسسة."
            : "Unable to save. Check your permissions and organization subscription.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!inline&&<TopbarOrganizationControls>
        <WorkspaceOrganizationPicker
          ar={ar}
          label={ar ? "المؤسسة المختارة" : "Selected organization"}
          organizations={items}
          value={id}
          onChange={setId}
          disabled={busy || loading}
          restore={false}
          beforeChange={() => {
            if (fiscalEdit.current.busy) return false;
            const dirty = financial ? fiscalEdit.current.dirty : !system && selected &&
              (draft.name !== selected.name || draft.legal_name !== (selected.legal_name ?? "") ||
               draft.country_code !== (selected.country_code ?? "") ||
               draft.commercial_registration_number !== (selected.commercial_registration_number ?? "") ||
               draft.registered_address !== (selected.registered_address ?? "") ||
               draft.activity !== (selected.activity ?? "") ||
               draft.contact_email !== (selected.contact_email ?? "") ||
               draft.contact_phone !== (selected.contact_phone ?? "") ||
               draft.registered_city !== (selected.registered_city ?? "") ||
               draft.registered_region !== (selected.registered_region ?? "") ||
               draft.registered_postal_code !== (selected.registered_postal_code ?? "") ||
               draft.registration_authority !== (selected.registration_authority ?? "") ||
               draft.registration_expires_on !== (selected.registration_expires_on ?? ""));
            return !dirty || window.confirm(ar ? "تجاهل التغييرات غير المحفوظة؟" : "Discard unsaved changes?");
          }}
        />
      </TopbarOrganizationControls>}
      {!inline&&!system&&!financial&&selected&&<OrganizationSubnav locale={locale} organization={id} active="details"/>}
      {loading ? (
        <p role="status">
          {ar ? "جارٍ تحميل المؤسسة…" : "Loading organization…"}
        </p>
      ) : error && !selected ? (
        <p role="alert">{error}</p>
      ) : !selected ? (
        <section className="settings-card">
          <h2>{ar ? "لا توجد مؤسسة متاحة" : "No organization available"}</h2>
          <Link href={`/${locale}/organizations?organization=${encodeURIComponent(id)}`}>
            {ar ? "فتح الهيكل المؤسسي" : "Open organization structure"}
          </Link>
        </section>
      ) : financial ? (
        <section className="settings-card">
          <header><h2>{ar ? "الإعدادات المالية والمحاسبية" : "Financial & accounting settings"}</h2><p>{selected.name}</p></header>
          <section className="financial-settings-journey-entry">
            <div>
              <strong>{ar?'رحلة إعداد المؤسسة':'Organization setup journey'}</strong>
              <p>{ar?'جميع مراحل التهيئة والجاهزية المالية في تبويب واحد. يمكنك متابعة النواقص أو تأجيل المراحل المستقلة دون اعتبارها معتمدة.':
                'All setup stages and verified readiness in one tab. You can revisit incomplete work or defer independent tasks without approving them.'}</p>
            </div>
            <Link className="btn" href={`/${locale}/settings/financial/setup?organization=${encodeURIComponent(id)}`}>
              {ar?'فتح رحلة الإعداد':'Open setup journey'}
            </Link>
          </section>
          <details className="financial-settings-tools">
            <summary>{ar?'إدارة الإعدادات المالية التفصيلية':'Manage detailed financial settings'}</summary>
            <p>{ar?'هذه صفحات الإدارة الأصلية بعد التهيئة، وليست خطوات إضافية أو أدلة حسابات مكررة.':
              'These are the original management pages, not duplicate setup stages or charts.'}</p>
            <nav className="financial-settings-shortcuts" aria-label={ar?'الأدوات المالية التفصيلية':'Detailed finance tools'}>
              <Link href={`/${locale}/settings/financial/fiscal-years?organization=${encodeURIComponent(id)}`}>{ar?'السنوات المالية':'Fiscal years'}</Link>
              <Link href={`/${locale}/chart-of-accounts?organization=${encodeURIComponent(id)}`}>{ar?'دليل الحسابات':'Chart of accounts'}</Link>
              <Link href={`/${locale}/financial-reporting-policy?organization=${encodeURIComponent(id)}`}>{ar?'قواعد الترحيل':'Posting rules'}</Link>
              <Link href={`/${locale}/opening-balances?organization=${encodeURIComponent(id)}`}>{ar?'الأرصدة الافتتاحية':'Opening balances'}</Link>
            </nav>
          </details>
          {financial==='years' ? <FiscalYearManagement key={id} organization={id} locale={locale} onEditState={reportFiscalEdit} /> : <div className="settings-hint"><p>{ar?'لتنفيذ الإعداد المتسلسل استخدم تبويب «رحلة الإعداد». أما الصفحات التفصيلية أعلاه فهي لإدارة السجلات الأصلية بعد التهيئة.':'Use the separate Setup Journey tab for guided setup. The detailed pages above manage existing records after configuration.'}</p></div>}
        </section>
      ) : (
        <section className={"settings-card organization-details-card"+(identityOnly?" identity-only":"")}>
          <header>
            <h2>
              {system
                ? ar
                  ? "إعدادات النظام للمؤسسة"
                  : "Organization system settings"
                : ar
                  ? "بيانات المؤسسة"
                  : "Organization details"}
            </h2>
            <p>{selected.name}</p>
          </header>
          {system ? (
            <SystemSettings
              key={id}
              id={id}
              name={selected.name}
              currency={selected.base_currency}
              locale={locale}
            />
          ) : (
            <form onSubmit={save} className="settings-form">
              <label>
                {ar ? "اسم المؤسسة" : "Organization name"}
                <input
                  required
                  maxLength={160}
                  value={draft.name}
                  disabled={!canEdit || busy}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                {ar ? "الاسم القانوني" : "Legal name"}
                <input
                  maxLength={200}
                  value={draft.legal_name}
                  disabled={!canEdit || busy}
                  onChange={(e) =>
                    setDraft({ ...draft, legal_name: e.target.value })
                  }
                />
              </label>
              {!identityOnly&&<>
              <label>{ar?'النشاط الرئيسي':'Main activity'}<input maxLength={120} value={draft.activity} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,activity:e.target.value})}/></label>
              <label>{ar?'البريد الرسمي':'Official email'}<input type="email" maxLength={254} dir="ltr" value={draft.contact_email} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,contact_email:e.target.value})}/></label>
              <label>{ar?'رقم الهاتف':'Phone number'}<input type="tel" maxLength={40} dir="ltr" value={draft.contact_phone} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,contact_phone:e.target.value})}/></label>
              </>}
              <label>
                {ar ? "الدولة" : "Country"}
                <select aria-label={ar?"الدولة":"Country"} required value={draft.country_code} disabled={!canEdit||busy}
                  onChange={e=>setDraft({...draft,country_code:e.target.value})}>
                  <option value="">{ar?'اختر دولة التسجيل':'Select country'}</option>
                  {COUNTRY_CODES.map(code=><option key={code} value={code}>{countryName(code,locale)}</option>)}
                </select>
              </label>
              <div className="organization-legal-fields" hidden={!identityOnly}>
              <label>
                {ar ? "رقم السجل التجاري أو التسجيل النظامي" : "Commercial or statutory registration number"}
                <input
                  maxLength={80}
                  value={draft.commercial_registration_number}
                  disabled={!canEdit || busy}
                  onChange={(e) => setDraft({ ...draft, commercial_registration_number: e.target.value })}
                />
              </label>
              <label>
                {ar ? "العنوان القانوني المسجل" : "Registered legal address"}
                <textarea
                  rows={3}
                  maxLength={500}
                  value={draft.registered_address}
                  disabled={!canEdit || busy}
                  onChange={(e) => setDraft({ ...draft, registered_address: e.target.value })}
                />
              </label>
              <label>{ar?'المدينة':'City'}<input maxLength={120} value={draft.registered_city} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,registered_city:e.target.value})}/></label>
              <label>{ar?'المنطقة':'Region'}<input maxLength={120} value={draft.registered_region} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,registered_region:e.target.value})}/></label>
              <label>{ar?'الرمز البريدي':'Postal code'}<input maxLength={20} value={draft.registered_postal_code} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,registered_postal_code:e.target.value})}/></label>
              <label>{ar?'جهة إصدار السجل':'Registration authority'}<input maxLength={160} value={draft.registration_authority} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,registration_authority:e.target.value})}/></label>
              <label>{ar?'تاريخ انتهاء السجل':'Registration expiry'}<input type="date" value={draft.registration_expires_on} disabled={!canEdit||busy} onChange={e=>setDraft({...draft,registration_expires_on:e.target.value})}/></label>
              </div>
              <p className="settings-hint">{ar ?
                "هذه بيانات هوية المؤسسة النظامية. عنوان البائع والرقم الضريبي الخاصان بالفواتير يُداران بصورة مستقلة في إعدادات الضرائب، ولا يعني الحفظ اعتمادًا نظاميًا تلقائيًا." :
                "These are the organization's registered identity details. The invoice seller address and tax number are managed separately; saving does not certify statutory compliance."}</p>
              {!identityOnly&&<dl className="settings-facts">
                <div>
                  <dt>{ar ? "العملة الأساسية" : "Base currency"}</dt>
                  <dd>{selected.base_currency}</dd>
                </div>
                <div>
                  <dt>{ar ? "الهيكل المؤسسي" : "Organization structure"}</dt>
                  <dd>
                    {selected.parent_organization_id
                      ? ar
                        ? "مؤسسة تابعة"
                        : "Subsidiary"
                      : ar
                        ? "مؤسسة رئيسية"
                        : "Parent organization"}
                  </dd>
                </div>
              </dl>}
              {canEdit ? (
                <button className="btn" disabled={busy || !draft.name.trim()}>
                  {busy
                    ? ar
                      ? "جارٍ الحفظ…"
                      : "Saving…"
                    : ar
                      ? "حفظ التغييرات"
                      : "Save changes"}
                </button>
              ) : (
                <p className="settings-hint">
                  {ar
                    ? "عرض البيانات متاح؛ تعديلها من صلاحيات مالك المؤسسة."
                    : "Details are visible; editing is available to the organization owner."}
                </p>
              )}
              <Link href={`/${locale}/organizations?organization=${encodeURIComponent(id)}`}>
                {ar ? "إدارة الهيكل المؤسسي" : "Manage organization structure"}
              </Link>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
        </section>
      )}

    </>
  );
}
