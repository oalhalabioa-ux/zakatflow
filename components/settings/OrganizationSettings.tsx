"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SystemSettings from "./SystemSettings";
import TopbarOrganizationControls from "../TopbarOrganizationControls";
import WorkspaceOrganizationPicker from "../WorkspaceOrganizationPicker";
import FiscalYearManagement from "./FiscalYearManagement";
import {
  rememberedOrganization,
  preferredOrganization,
} from "@/lib/workspace-organization";
import type { Organization } from "@/services/organizations";
import { supabaseBrowser } from "@/lib/supabase/browser";
export default function OrganizationSettings({
  locale,
  system = false,
  financial,
}: {
  locale: string;
  system?: boolean;
  financial?: "overview" | "years";
}) {
  const ar = locale === "ar",
    [items, setItems] = useState<Organization[]>([]),
    [id, setId] = useState(""),
    [owner, setOwner] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState({ name: "", legal_name: "" });
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
        const explicit = new URLSearchParams(location.search).get(
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
  }, [ar]);
  useEffect(() => {
    const read = () => {
      const selected =
        new URLSearchParams(location.search).get("organization") ??
        rememberedOrganization();
      if (items.some((o) => o.id === selected)) setId(selected!);
    };
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [items]);
  const selected = items.find((o) => o.id === id),
    canEdit = !!selected && selected.owner_user_id === owner;
  useEffect(() => {
    generation.current++;
    setDraft({
      name: selected?.name ?? "",
      legal_name: selected?.legal_name ?? "",
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
        }),
      });
      if (!r.ok) throw Error();
      const updated = await r.json();
      setItems((current) =>
        current.map((o) => (o.id === target ? updated : o)),
      );
      if (version === generation.current)
        setMessage(
          ar ? "تم حفظ بيانات المؤسسة." : "Organization details saved.",
        );
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
      <TopbarOrganizationControls>
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
              (draft.name !== selected.name || draft.legal_name !== (selected.legal_name ?? ""));
            return !dirty || window.confirm(ar ? "تجاهل التغييرات غير المحفوظة؟" : "Discard unsaved changes?");
          }}
        />
      </TopbarOrganizationControls>
      {loading ? (
        <p role="status">
          {ar ? "جارٍ تحميل المؤسسة…" : "Loading organization…"}
        </p>
      ) : error && !selected ? (
        <p role="alert">{error}</p>
      ) : !selected ? (
        <section className="settings-card">
          <h2>{ar ? "لا توجد مؤسسة متاحة" : "No organization available"}</h2>
          <Link href={`/${locale}/organizations`}>
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
        <section className="settings-card">
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
              <dl className="settings-facts">
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
              </dl>
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
              <Link href={`/${locale}/organizations`}>
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
